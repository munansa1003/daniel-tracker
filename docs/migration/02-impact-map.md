# 02 — 원점(origin) 전환 영향 지도 + 컷오버 런북 초안

> 작성 2026-09-07 · 기준 커밋 main `aca23a2` · **코드 변경 없음** · 출처 등급은 `01-firebase-plan.md §0`과 동일.
> 전제: 이번 이전에서 **커스텀 도메인을 함께 붙여 원점이 딱 한 번 바뀐다**(`daniel-tracker.vercel.app` → `https://<커스텀 도메인>`).
> `<project>.web.app` 기본 도메인은 "두 번째 원점"이 되지 않도록 사용자에게 안내하지 않는다(승인 도메인엔 남겨 둠).

## 0. 이전이 아닌 것

- **Firestore 데이터 이전은 없다.** 프로덕션은 같은 Firebase 프로젝트(`daniel-tracker-cb781`)를 그대로 쓴다. `users/{uid}/data/*`·`members`·`invites`·규칙 전부 그대로.
- **Upstash KV도 그대로.** `import:*`·`push:*`·`share:*`·`rl:*` 키는 원점을 모른다(uid·토큰 키). 단 Vercel Marketplace 통합 여부는 **DR-14**(통합 삭제 = DB 삭제 위험 [스니펫]).
- Anthropic·identitytoolkit 호출은 서버→외부라 원점 무관.

## 1. 원점 전환 소비처 전수 표

위험도: **P0** = 앱 핵심 기능 정지 · **P1** = 주요 기능 1개 정지 또는 데이터 유실 가능 · **P2** = 체감 저하·수동 복구 필요 · **P3** = 문서·미관.
컷오버 단계: **전** = 컷오버 전에 끝낼 것 · **중** = 컷오버 당일 순서 안 · **후** = 병행 기간 중.

| # | 항목 | 파일:라인 | 무엇이 깨지나 | 사용자 체감 | 대응 | 단계 | 위험 |
|---|---|---|---|---|---|---|---|
| 1 | **PWA 설치본** | `vite.config.js:21` `start_url:'/'` · 빌드 산출 `manifest.webmanifest` `scope:'/'`(실측) | 설치된 PWA는 원점에 묶인다. 새 원점은 **새 앱**이고 옛 설치본은 그대로 vercel.app을 가리킨다. 코드는 상대 경로라 변경 불필요 | 홈 화면에 앱이 둘. 옛 앱은 Vercel이 살아 있는 동안 계속 동작(Firestore·Auth는 Firebase 직결이라 **Vercel이 죽어도 기록·동기화는 계속되고 AI·푸시·공유·자동 유입만 죽는다**) | [사람] 새 원점에서 "홈 화면에 추가" → 옛 앱 삭제. 앱 안에 원점 안내 배너(구현 세션, `location.hostname`이 `vercel.app`이면 표시) | 후 | P2 |
| 2 | **SW precache · 오프라인** | `vite.config.js:27-38` · `dist/sw.js` 17개 1,294KiB(실측) | 새 원점은 SW가 없는 상태로 시작 → 첫 방문은 온라인 필수, 이후 precache. 옛 원점 SW는 옛 앱만 제어(`scope:'/'`는 원점 내) | 첫 방문 1.3MB 다운로드 | 없음(설계대로). `navigateFallbackDenylist`의 `/api/`·`/export/`는 유지 | 후 | P3 |
| 3 | **`push-sw.js` 병합·알림 클릭** | `vite.config.js:30` · `public/push-sw.js:34` `openWindow('/?tab=')` | 상대 경로 — 새 원점에서 그대로 | 없음 | 없음 | — | P3 |
| 4 | **푸시 구독(endpoint)** | `src/push.js:42-48` `registration.pushManager.subscribe` → KV `push:sub:{uid}`(`api/push-sync.js:66`) | 구독은 **SW 등록(=원점) 단위** [스니펫 MDN/Push API]. endpoint는 브라우저 벤더 푸시 서비스 URL이라 서버는 계속 보낼 수 있고, **도착지는 옛 원점의 SW**다. 새 원점엔 구독이 없어 `syncPushState`(`push.js:55-64`)가 조용히 스킵 → 크론이 **옛 상태 스냅샷**으로 판단 | 새 앱에서 알림이 안 오고, 옛 앱(남아 있으면)으로 옴. 옛 앱을 지우면 endpoint가 404/410 → 크론이 정리(`cron-reminders.js:117-121`) → 알림 완전 중단 | **재구독 필요**(사용자 제스처로 권한 프롬프트). VAPID 키 쌍은 원점에 묶이지 않아 **재사용 가능**(`applicationServerKey`는 앱 서버 식별 [스니펫]). 새 원점 첫 로그인 시 "알림 다시 켜기" 배너(DR-9). 옛 앱에서 **로그아웃하면 `disablePush`가 KV 구독을 지운다**(`App.jsx:129-131`) — 새 원점에서 먼저 켠 뒤 옛 앱을 로그아웃하면 새 구독이 지워지므로 **순서: 옛 앱 로그아웃(또는 삭제) → 새 앱 알림 켜기** | 후 | **P1** |
| 5 | **HAE 단축어 POST URL** | `docs/hae-setup.md:30` · `docs/inbody-setup.md:129` · `docs/shortcut-recipe.md:20,96,172` | URL 하드코딩 → 새 도메인으로 폰에서 수정 [사람]. `X-Import-Token` 값은 그대로(Secret Manager로 이관, 01 §5) | 수정 전까지 운동·체성분이 **Vercel 검문소**로 계속 들어감 → 같은 KV 사서함이라 **새 앱이 그대로 pull한다**(병행 기간엔 무해). Vercel 종료 후엔 단축어가 5xx/DNS 실패 → 수신 침묵 알림(5일)이 잡아 줌 | [사람] 컷오버 당일 단축어 2개(운동·체성분) URL 교체 → 수동 실행으로 200 확인 → 앱 설정 카드에 수신 로그 확인. 문서 3개 갱신 | 중 | P1 |
| 6 | **`IMPORT_*` 컷오버** | `api/health-import.js:38-46` · `api/body-import.js:33-41` | 원점과 무관(날짜 기준). 값만 params로 이관. `IMPORT_UID`는 Auth uid라 불변 | 없음 | 새 컷오버 날짜 **불필요**(운동 시작 시각 기준이라 이중 계상 없음, seen 도장 멱등) | 전 | P3 |
| 7 | **`checkOrigin` / `PRODUCTION_ORIGIN`** | `api/_lib/security.js:7-19` · `.env.example` | 새 함수의 허용 목록에 `https://<커스텀>`이 없으면 앱 API 전부 403 | AI·푸시·공유·자동 유입 카드 전부 실패(기록·통계는 Firestore 직결이라 동작) | params `PRODUCTION_ORIGIN=https://<커스텀>`(+ 필요 시 `https://<project>.web.app`). `VERCEL_URL` 프리뷰 허용은 삭제 → 프리뷰 정책은 03 §2 | 전 | **P0** |
| 8 | **Firebase Auth 승인 도메인** [콘솔] | Authentication → Settings → Authorized domains (`docs/DEPLOY-PATH-B.md:29-33`) | 새 도메인이 없으면 `auth/unauthorized-domain` → 로그인 불가 | **로그인 화면에서 막힘** | [사람] 커스텀 도메인 + `<project>.web.app` 추가(와일드카드 불가 [스니펫]) | 전 | **P0** |
| 9 | **`authDomain` · 로그인 방식** | `src/firebase.js:8` `authDomain:"daniel-tracker-cb781.firebaseapp.com"` · `src/auth.js:34-46` popup → 실패 시 redirect | popup은 크로스 도메인 authDomain에서도 동작. **redirect 폴백(iOS PWA 등)**은 서드파티 저장소 차단 브라우저에서 authDomain ≠ 앱 도메인이면 실패 [스니펫] `https://firebase.google.com/docs/auth/web/redirect-best-practices`. Firebase Hosting 위에선 **Option 1(커스텀 도메인을 authDomain으로)**이 가능 — `/__/auth/**`는 Hosting 예약 네임스페이스로 커스텀 도메인에서도 자동 제공 [스니펫] `https://firebase.google.com/docs/hosting/reserved-urls` | iOS 홈 화면 앱에서 Google 로그인 무한 루프/실패(현재도 잠재) | DR-12(채택): Hosting 커스텀 도메인을 `authDomain`으로(Option 1, 코드 1줄) + [콘솔] 승인 도메인 + [콘솔 GCP] Google OAuth 클라이언트의 승인된 리디렉션 URI에 `https://<도메인>/__/auth/handler` 추가 [스니펫]. 별도 리라이트 규칙은 **불필요**(예약 경로). **검증 분담**: 프리뷰 채널(`web.app`)은 authDomain과 크로스 도메인이라 **popup만 검증**, redirect 폴백은 **스테이징 고정 도메인**(그 도메인을 authDomain으로 둔 staging 빌드)에서 iOS 홈 화면 앱으로 검증 | 전 | P1 |
| 10 | **App Check(reCAPTCHA v3)** [콘솔] | `src/firebase.js:19-31` · reCAPTCHA 관리 콘솔 도메인 목록 | 키는 등록 도메인에 바인딩 [스니펫] `https://firebase.google.com/docs/app-check/web/recaptcha-provider`. 새 도메인 미등록 → 토큰 발급 실패. 규칙이 `request.app != null`을 강제 중이면 **Firestore 전면 차단** | 최악: 로그인 뒤 모든 데이터 접근 거부(로컬 캐시 없음 = 빈 화면) | [사람] reCAPTCHA 키 도메인에 커스텀 도메인(+`web.app`) 추가. **현재 규칙의 App Check 강제 여부·`VITE_RECAPTCHA_SITE_KEY` 주입 여부 [미확인]** — 컷오버 전 콘솔 App Check 지표(검증된 요청 수)로 확인. 빌드 변수는 GitHub Variables로(03 §3) | 전 | **P0** |
| 11 | **공유 링크 발급 URL** | `src/shareLink.js:16` `window.location.origin` · `src/components/ClaudeExport.jsx:109,115,242` · `api/share-create.js:66`(상대 `path`만) | 새 원점에서 발급하면 자동으로 새 도메인. `goals.shareLink`는 토큰·만료만 저장(URL 아님)이라 **같은 토큰이 새 원점 URL로 표시**됨 | 없음 | 없음 | — | P3 |
| 12 | **기존 발급분(1h/24h/7d)** | KV `share:{token}` TTL(`share-store.js:11-15`) | 옛 URL(`vercel.app/export/view/<t>`)은 Vercel이 살아 있는 동안 같은 KV 스냅샷을 렌더 → 계속 열림. 병행 기간 ≥ **7일**이면 만료 전에 전부 소멸 | 없음(병행 ≥7일 조건) | DR-8 병행 기간을 7일 이상으로 | 후 | P3 |
| 13 | **경로형 `/export/view/:t` + AI 리더** | `vercel.json` rewrites · `api/export-view.js:36-39` | Firebase rewrite는 `:t`를 쿼리로 안 바꿈 → 경로 파싱 필수(01 §3). Express 마운트 시 `req.url` 잘림 함정(01 §3.3) | 깨지면 **AI 공유 링크 기능 전체 정지**(2026-07-28 확정 사실) | 프리뷰 채널에서 `curl -sI https://<preview>/export/view/<32hex>`로 404(만료) 응답과 `X-Share-View` 헤더 확인 → 실제 토큰으로 200 확인 → **Claude 웹 리더로 실제 열람 [사람]** | 중 | **P1** |
| 14 | **`noindex` · `/export/diag`** | `api/export-view.js:41-54,63,88` | `X-Robots-Tag`·메타는 함수가 붙이므로 유지. `diag`의 `vercelEnv`·`commit`·`branch`는 Vercel env라 `unknown`으로 표시 | 진단 정보 3칸이 비어 보임 | 필드 제거 또는 `K_REVISION` 등으로 대체 [미확인] (01 §5). `robots.txt` Disallow 금지 유지(ARCHITECTURE §6-12) | 후 | P3 |
| 15 | **인바디 직수신 봉인** | `api/import-inbox.js:88-171` · env `INBODY_LOGIN_ID/PW` | 새 환경에 시크릿을 만들지 않으면 `off`(`:94`) — 봉인의 기본 형태. 향후 재개 시 Cloud Run 이그레스 IP는 동적이고 리전은 서울 유지 | 설정 카드 상태 "off" | DR-6(플래그 vs 제거). 기본안: 시크릿 미생성 = 플래그 off, 코드 유지 | 전 | P3 |
| 16 | **JSON 백업 · `analysisExport` 속 URL** | `src/backup.js:16-30`(shareLink 제외) · `src/analysisExport.js:63-67`(URL 언급은 일반 문구) | 원점 포함 값 없음 | 없음 | 없음 | — | P3 |
| 17 | **README / docs 속 URL** | `README.md:105,111` · `docs/ARCHITECTURE.md:20` · `docs/DEPLOY-PATH-B.md:31,116,157` · `docs/hae-setup.md:30` · `docs/inbody-setup.md:129,231` · `docs/shortcut-recipe.md:20,96,172` · `docs/health-import-verification.md:4` · `.env.example`(Vercel 안내 다수) | 문서만 | 없음 | 구현 세션에서 일괄 치환 + README 배포 절차 교체 | 후 | P3 |
| 18 | **Vercel 프리뷰 관행 → 프리뷰 채널** | `api/_lib/security.js:17` `VERCEL_URL` · `docs/DEPLOY-PATH-B.md §1.5` | 채널 URL은 매번 다른 호스트. **로그인 승인 도메인은 CLI `hosting:channel:deploy`가 자동 등록**(배포 SA에 Firebase Authentication Admin — 03 §2·§4.2) → 남는 것은 App Check 도메인·`checkOrigin` 둘 | 개발 흐름 | 03 §2 3안 재평가 · `pinTag`(DR-15)로 채널별 함수 버전 고정 가능 | 후 | P2 |
| 19 | **localStorage 미러·대기열·묘비** (원점별 저장소) | `src/store.js:313-321` `dt_{uid}_*` · `src/syncQueue.js` `dt_pendingSync_{uid}`·`dt_tombstones_{uid}` | 새 원점은 빈 로컬 → 첫 열기에 `getAllData` 전량 읽기(원래 동작). **옛 원점에 남은 오프라인 대기분은 옛 앱을 온라인으로 열어야 전송**된다. 묘비(버린 초안·삭제 체성분 날짜)는 새 원점에 없음 → 사서함에 아직 남아 있던 항목이 초안으로 되돌아올 수 있음(ack된 항목은 무관) | 드물게 버린 초안 재등장 | [사람] 컷오버 전 옛 앱을 온라인으로 한 번 열기(DEPLOY-PATH-B §2와 동일 원칙) | 전 | P2 |
| 20 | **첫 로그인은 온라인 필수** | `src/store.js:82-96` `getMembership`(캐시 `dt_{uid}_member` 없음) · `src/App.jsx:97-106` | 새 원점에서 오프라인이면 멤버 확인 실패 → 초대 화면으로 빠짐 | 잘못된 "초대 코드" 화면 | 안내 문구. 온라인이면 정상 | 후 | P3 |
| 21 | **Firebase Auth 세션(IndexedDB)** | `src/firebase.js:40-42` | 원점별 → 새 원점에서 재로그인 [사람] | 로그인 1회 | 없음 | 후 | P3 |
| 22 | **rate limit 키(클라이언트 IP)** | `api/_lib/security.js:47-51` | Hosting 경유 시 `x-forwarded-for` 첫 항목이 CDN IP일 수 있음 [스니펫] → 전 사용자가 한 버킷 → 429 오탐 | AI 분석이 분당 30회 넘으면 다른 사용자까지 429 | `fastly-client-ip` 우선(01 §6.5-1). 프리뷰에서 헤더 실측 후 확정 | 전 | **P1** |
| 23 | **크론 이중 발송** | `vercel.json crons` · Scheduler 잡 | 병행 기간에 둘 다 살아 있으면 밤 8시 푸시 2회 | 같은 알림 2번 | 런북: Scheduler 잡 생성 **전에** Vercel 크론 제거(또는 `vercel.json` crons 삭제 배포). 되돌릴 땐 반대로 | 중 | P2 |
| 24 | **`FIREBASE_WEB_API_KEY` 예약 접두사** | `api/_lib/verify-auth.js:4` · `verify-uid.js:5` · `api/push-sync.js:18` | Functions env에서 `FIREBASE_` 접두사 거부(`firebase-tools` `lib/functions/env.js:22,128` [코드]) → 배포 실패 | 배포 단계에서 즉시 드러남 | 이름 변경(01 §5). 코드 폴백값(공개 웹 키)이 있어 미설정도 동작 | 전 | P2 |
| 25 | **Hosting 60s 상한** | `api/import-inbox.js:51`(12s 예산) · `vercel.json` maxDuration 60(크론) | 크론은 Hosting 비경유라 무관. 앱 경로는 전부 30s 이내 | 없음 | timeout 설정 01 §2 | — | P3 |
| 26 | 로그인 화면의 인앱 브라우저 탈출 링크 | `src/components/LoginScreen.jsx:21-28,77` `window.location.href/host/pathname` | 현재 주소를 그대로 카카오톡 외부 브라우저·Chrome intent로 넘김 — 원점 무관(런타임 값) | 없음 | 없음 | — | P3 |
| 27 | 오프라인 폴백 페이지 | `public/offline.html:38` `window.location.reload()` | 상대 경로·리로드뿐 | 없음 | 없음 | — | P3 |

## 2. 컷오버 런북 초안

표기: **[사람]** = Daniel이 브라우저/폰/콘솔에서 직접 · 나머지는 CI 또는 구현 세션의 스크립트. 소요는 순수 작업 시간(대기 제외).

### Phase A — 준비 (T-7일 ~ T-1일, 되돌리기 불요: 프로덕션 무영향)

| # | 작업 | 소요 | 확인 방법 | 되돌리기 |
|---|---|---|---|---|
| A1 | [사람] Firebase 프로젝트 **Blaze 전환** + 예산 알림 $10(50/90/100%) + spend cap 예산 $30 | 10분 | Billing 페이지 | Spark 복귀 가능 |
| A2 | [사람] (DR-5 채택 시) staging 프로젝트 생성·Blaze·예산 $5 · Upstash DB 1개 추가 | 20분 | | 삭제 |
| A3 | [사람] Secret Manager에 시크릿 생성(01 §5 표) — 콘솔 또는 `firebase functions:secrets:set`(DR-7). `INBODY_*`는 만들지 않음 | 15분 | `firebase functions:secrets:access NAME`(값 노출 주의) | 시크릿 삭제 |
| A4 | [사람] 커스텀 도메인 구매 → Hosting에 연결(TXT 검증 → A/AAAA 레코드) — SSL 발급 최대 24h [스니펫] `https://firebase.google.com/docs/hosting/custom-domain` · **DNS TTL 300s** | 15분 + 대기 | 콘솔 "연결됨", `curl -I https://<커스텀>` 200 | 레코드 삭제 |
| A5 | [사람] Auth 승인 도메인에 커스텀 도메인·`<project>.web.app` 추가 (표 #8) | 2분 | 콘솔 | 삭제 |
| A6 | [사람] reCAPTCHA 키 도메인에 추가 (표 #10) + App Check 콘솔에서 현재 강제 여부·검증 요청 수 확인 → **강제 중인데 키 주입이 불확실하면 컷오버 전 규칙에서 `request.app != null` 임시 해제 여부 결정**(DEPLOY-PATH-B §3과 같은 판단) | 10분 | App Check 지표 | 도메인 삭제 |
| A7 | [사람] (DR-12 채택 시) GCP 콘솔 OAuth 클라이언트에 리디렉션 URI `https://<커스텀>/__/auth/handler` 추가 | 5분 | 프리뷰에서 redirect 로그인 실측 | URI 삭제 |
| A8 | GitHub Secrets/Variables 등록(03 §3 이름 목록) · 서비스 계정 또는 WIF(03 §4) | 20분 | CI 워크플로 dry-run | 삭제 |
| A9 | 구현 PR 머지 전: 프리뷰 채널 + staging Functions에서 체크리스트 — 로그인(popup·redirect) · `/api/import-inbox` pull 200 · `/api/analyze-food` 200 · `/export/view/<hex>` 404+`X-Share-View` · `/export/diag` · SPA fallback · 비JSON POST → Buffer · `fastly-client-ip` 헤더 실측 · glob 순서 실측(01 §3.2) | 1h | 03 §1 체크리스트 | — |
| A10 | [사람] 옛 앱(폰 전부)을 **온라인으로 한 번 열어** 대기분 동기화 + JSON 전체 백업 1회 (표 #19) | 5분 | 설정 → 데이터 | — |

### Phase B — 컷오버 당일 (T, 총 ≈ 1시간, 순서 엄수)

| # | 작업 | 소요 | 확인 방법 | 되돌리기 조건·방법 |
|---|---|---|---|---|
| B1 | [사람] Vercel 프로젝트에서 **크론 비활성**(또는 `vercel.json` crons 제거 배포) — 표 #23 | 5분 | Vercel Cron 탭 비어 있음 | 크론 재활성 |
| B2 | main 머지 → CI가 Hosting(live) + Functions(prod) 배포. Scheduler 잡 자동 생성(01 §4) | 10분(빌드 포함) | `firebase functions:list` · Scheduler 콘솔 잡 1개 · `curl -I https://<커스텀>/` 200 | CI 롤백 = 이전 커밋 재배포 |
| B3 | 스모크: `curl -sI https://<커스텀>/export/view/0000…(32hex)` → 404 + `X-Share-View: expired` · `curl -s https://<커스텀>/export/diag` → JSON · `curl -s -X POST https://<커스텀>/api/health-import -H "X-Import-Token: wrong" -d '{}'` → 401(=함수 살아 있고 env 3종 존재) | 5분 | 상태 코드 | 어느 하나라도 5xx/504 → **B1 되돌리고 원인 조사**, 도메인은 아직 미공지 상태라 사용자 무영향 |
| B4 | [사람] 새 도메인에서 Google 로그인 → 홈 목표 K가 옛 앱과 동일한지(예: 체중 77.3 기준 1570) · 설정 → 자동 가져오기 카드에 수신 로그 보이는지(같은 KV) | 5분 | 화면 | 로그인 실패면 표 #8/#9 콘솔 항목 재확인 |
| B5 | [사람] 단축어 2개 URL 교체(표 #5) → 수동 실행 → 응답 알림 "0건 추가 · 중복 N 무시" 또는 "N건 추가" | 5분 | 단축어 알림 + 앱 수신 로그 | 옛 URL로 복귀 |
| B6 | [사람] 옛 앱 **로그아웃**(구독 정리) → 새 앱 설정 → 알림 켜기(표 #4 순서) | 3분 | `push:sub:{uid}`의 endpoint가 바뀌었는지는 콘솔 확인 불요 — 당일 밤 8시 푸시 도착으로 확인 | — |
| B7 | [사람] 새 도메인에서 공유 링크 발급 → **Claude 웹에서 실제 열람**(표 #13) | 3분 | 리더가 본문을 읽음 | 실패면 P1 — 라우터 수정 후 재배포, 그동안 옛 앱에서 발급하도록 안내 |
| B8 | [사람] 홈 화면에 새 앱 추가 · 옛 앱은 병행 기간 끝까지 보존(롤백용) | 2분 | | |
| B9 | 밤 8시: 푸시 1회 도착 확인 · Cloud Logging에서 `cronReminders` `sent=1` | — | 로그 | 미도착 → Scheduler 잡 실행 이력(403이면 invoker IAM) · `VAPID_*` 시크릿 바인딩 확인 |

### Phase C — 병행 기간 (T+1 ~ T+14, DR-8)

| # | 작업 | 확인 | 종료 조건 |
|---|---|---|---|
| C1 | 매일: Cloud Logging 오류 0 · 예산 알림 없음 · 수신 로그 정상 | | |
| C2 | T+7: 옛 원점 공유 링크 전부 만료(표 #12) | KV `share:*` | |
| C3 | [사람] 지인(멤버)에게 새 주소 안내 · 옛 앱 삭제 요청 | | |
| C4 | T+14: Vercel **환경변수 백업 후** 프로젝트 삭제 전 **Upstash 소유권 확인**(DR-14 — Marketplace 통합이면 먼저 Upstash 직접 계정으로 이전/재생성, `KV_REST_API_*` 교체 재배포) | Upstash 콘솔에서 DB가 독립 존재 | 그 다음에야 Vercel 삭제 |
| C5 | 문서 URL 일괄 갱신(표 #17) · `.env.example`의 Vercel 안내 제거 | | |

### 되돌리기(롤백) 요약

| 시점 | 절차 | 소요 |
|---|---|---|
| B3 실패(미공지) | B1 되돌림(크론 재활성). 도메인 미공지라 사용자 무영향 | 5분 |
| B4~B9 실패(공지 전) | 위와 동일 + 단축어 URL 옛 값 | 10분 |
| C 단계(공지 후) | ① Scheduler 잡 일시정지 ② Vercel 크론 재활성 ③ 단축어 URL 복귀 ④ 사용자에게 옛 주소 안내(옛 PWA는 그대로 동작) ⑤ 새 원점에서 켠 푸시는 옛 앱에서 다시 켜기 | 30분 |
