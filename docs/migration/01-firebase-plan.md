# 01 — Vercel → Firebase 이전 계획 (설계 전용 · 구현 착수 전 승인용)

> 작성 2026-09-07 · 기준 커밋 main `aca23a2` · 세션 모델 페이블 · **코드 변경 없음**
> 이 문서는 "무엇을 어디로 옮기는가"의 매핑이다. 원점 전환의 영향과 컷오버 런북은 `02-impact-map.md`,
> CI/배포는 `03-ci-deploy-design.md`. 결정이 필요한 항목은 **DR-n**으로 표시하고 03 문서 끝의 DR 목록에 모았다.

## 0. 출처 등급 (이 문서 전체에 적용)

이 세션의 네트워크 정책이 `firebase.google.com` · `cloud.google.com` · `docs.cloud.google.com` · `vercel.com` ·
MDN · Cloudflare 문서 **페이지 열람을 차단**했다. 그래서 외부 사실은 아래 등급으로 표기한다.

| 등급 | 뜻 | 신뢰도 |
|---|---|---|
| **[코드]** | npm 공식 패키지 소스에서 파일:줄 단위로 확인 — `firebase-tools@15.29.0` · `firebase-functions@7.3.2` · `@google-cloud/functions-framework@5.0.5` (2026-09-07 `npm pack`) | 높음 (실행되는 코드) |
| **[스니펫]** | 공식 문서 URL의 검색 스니펫으로 확인. 원문 페이지는 이 세션에서 열지 못함 → **구현 세션에서 URL 재확인** | 중간 |
| **[미확인]** | 확인 못 함. 구현 전 반드시 확인 | — |
| **[콘솔]** | 코드 밖(Firebase/GCP/Vercel/reCAPTCHA 콘솔)에 있어 이 세션에서 볼 수 없음 | — |

## 1. 대상 아키텍처

```
                 ┌──────────────────────── Firebase 프로젝트 daniel-tracker-cb781 (Blaze) ────────────────────────┐
                 │                                                                                                │
  브라우저/PWA ──HTTPS──▶ Firebase Hosting (커스텀 도메인 1개 = 유일한 원점)                                       │
  단축어(HAE)              │  정적 dist/ (index.html · assets/* · sw.js · manifest.webmanifest · push-sw.js)         │
  외부 AI 리더             │  rewrites:                                                                             │
                 │         │   /api/health-import, /api/body-import ─────▶ Functions v2  `ingress`   (onRequest)   │
                 │         │   /export/view, /export/view/**, /export/diag ▶ Functions v2  `exportView`(onRequest)   │
                 │         │   /api/**  ───────────────────────────────▶ Functions v2  `api`       (onRequest)   │
                 │         │   **  ─────────────────────────────────────▶ /index.html (SPA fallback)                │
                 │         │                                                                                        │
  Cloud Scheduler ─OIDC──▶ Functions v2 `cronReminders` (onSchedule, 매일 20:00 Asia/Seoul) — HTTP 비공개(IAM)       │
                 │                                                                                                │
                 │  Secret Manager ──(defineSecret)──▶ 위 4개 함수의 env                                            │
                 │  Firestore · Auth · App Check ── 기존 그대로(데이터 이전 없음, 서버는 Firestore 자격증명 없음 유지) │
                 └────────────────────────────────────────────────────────────────────────────────────────────────┘
                              │                                   │
                              ▼                                   ▼
                     Upstash Redis(REST) — 유지                Anthropic Messages API — 유지
                     (rate limit · 사서함 · 푸시 · 공유)       identitytoolkit(accounts:lookup) — 유지
```

**원칙 1 — 모든 API 호출은 Hosting rewrite 경유(동일 원점).** 앱의 API 호출 10곳이 전부 상대 경로
`/api/...`다(`src/push.js:30`, `src/shareLink.js:41,64`, `src/App.jsx:838,863,884,954,1039,1092`,
`src/components/BodyTab.jsx:132`). 함수의 `*.run.app`/`cloudfunctions.net` 직접 URL은 앱·문서 어디에도 쓰지 않는다.
그래야 `checkOrigin`(`api/_lib/security.js:21`)·CORS·쿠키 문제가 지금과 동일하게 "없음"으로 유지된다.

**원칙 2 — 서버는 계속 Firestore 자격증명을 갖지 않는다.** Admin SDK를 넣지 않는다(ARCHITECTURE §3.5의 보안 태세 유지).
함수가 Firebase 프로젝트 "안"으로 들어가도 이 태세는 바꾸지 않는다 — 실수로 `firebase-admin`을 의존성에 넣지 말 것.

**원칙 3 — 함수 그룹은 인증 태세·호출 주체별로 나눈다**(§7). 4개 서비스: `api`(앱·checkOrigin) ·
`ingress`(단축어·X-Import-Token) · `exportView`(공개 GET·토큰 게이트) · `cronReminders`(스케줄·IAM).

## 2. 함수 매핑표 (11행 = `ls api/*.js`)

공통: 리전 `asia-northeast3`(DR-2) · 런타임 `nodejs22`(DR-4) · `minInstances 0` · `maxInstances` 소수(§9) ·
CPU 1(v2는 메모리 ≤2GiB일 때 CPU 기본 1 — `firebase-functions` `lib/v2/options.d.ts:104` [코드]) ·
메모리 기본 256MiB(`firebase-tools` `lib/deploy/functions/backend.js:118` [코드]) · timeout 기본 60s(`backend.js:119` [코드]).

| # | Vercel 파일 | 함수(그룹) · 라우트 | 트리거 | 메모리 | timeoutSeconds | 시크릿(defineSecret) | req/res 호환 차이 | 본문 한도 | Cache-Control | 무료 한도 소비(§9 가정) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `analyze-food.js` | `api` · `POST /api/analyze-food` | onRequest | **512MiB**(사진 base64 JSON 파싱) | 60 (Hosting 상한 60s [스니펫]) | `ANTHROPIC_API_KEY` | 없음(Express req/res) | 앱 상한 없음 → **앱에서 4MB 상한 권고**(구현 세션) | 없음 | 호출 1.2%·CPU 큼(4s 대기) |
| 2 | `analyze-exercise.js` | `api` · `POST /api/analyze-exercise` | onRequest | 256 | 60 | `ANTHROPIC_API_KEY` | 없음 | 소형 | 없음 | 소 |
| 3 | `analyze-body.js` | `api` · `POST /api/analyze-body` | onRequest | 256 | 60 | `ANTHROPIC_API_KEY` | 없음 | 소형 | 없음 | 소 |
| 4 | `health-import.js` | `ingress` · `POST /api/health-import` | onRequest | 256 | 30 | `IMPORT_TOKEN`, `KV_REST_API_TOKEN` | 비JSON Content-Type 본문은 **Buffer**로 도착(functions-framework `server.js:70-88` [코드]) → 기존 `Buffer.isBuffer` 분기(`:74`)로 호환. 클라이언트 IP 추출 변경 필요(§6.5) | 앱 4MB(`import-rules.js:13`) < 플랫폼 32MiB [스니펫] | 없음 | 소 |
| 5 | `body-import.js` | `ingress` · `POST /api/body-import` | onRequest | 256 | 30 | 위와 동일 | 위와 동일(`:64`) | 4MB | 없음 | 소 |
| 6 | `import-inbox.js` | `api` · `POST /api/import-inbox` | onRequest | 256 | **30**(현 maxDuration 유지; 내부 예산 12s `:51`) | `KV_REST_API_TOKEN`, (`INBODY_LOGIN_ID/PW` — 봉인 DR-6) | 없음 | 소형 | 없음 | 호출 최다(앱 열 때마다) |
| 7 | `push-sync.js` | `api` · `POST /api/push-sync` | onRequest | 256 | 30 | `KV_REST_API_TOKEN` | `FIREBASE_WEB_API_KEY` env **이름 변경 필요**(§5, 예약 접두사) | 소형 | 없음 | 중 |
| 8 | `cron-reminders.js` | `cronReminders` | **onSchedule** `0 20 * * *` `timeZone:'Asia/Seoul'` | 256 | **120**(현 60 → 구독자 증가 대비; Scheduler attemptDeadline 기본 180·최대 1800 `validate.js:30-31` [코드]) | `VAPID_PRIVATE_KEY`, `KV_REST_API_TOKEN` | **req/res 없음** — `ScheduledEvent`를 받음. 핸들러 본체를 `runReminders()`로 추출하고 Bearer 검문·rateLimit 제거(§4) | — | — | 30회/월 |
| 9 | `export-view.js` | `exportView` · `GET /export/view`, `/export/view/:t`, `/export/diag` | onRequest | 256 | 30 | `KV_REST_API_TOKEN`, `SHARE_TEST_TOKEN`(선택) | `?t=` 치환 없음 → 라우터가 `req.params.t`를 `req.query.t`로 넣어 주거나 기존 `req.url` 파싱(`:36-39`)에 의존. **Express 마운트 시 `req.url`이 잘리므로 루트 마운트 또는 `originalUrl` 사용**(§3) · `VERCEL_ENV`/`VERCEL_GIT_*` 진단 필드 대체(`:50-52`) | — | **`no-store` 유지**(CDN 캐시 안 됨, §3.4) | 소 |
| 10 | `share-create.js` | `api` · `POST /api/share-create` | onRequest | 256 | 30 | `KV_REST_API_TOKEN` | 없음 | 600KB(`share-store.js:18`) | 없음 | 소 |
| 11 | `share-revoke.js` | `api` · `POST /api/share-revoke` | onRequest | 256 | 30 | `KV_REST_API_TOKEN` | 없음 | 소형 | 없음 | 소 |

`api/_lib/*.js` 11개는 그대로 공용 모듈. `verify-auth.js`·`verify-uid.js`·`push-sync.js:18`의 웹 API 키 상수 이름만 §5 참조.

## 3. 라우팅 — `vercel.json` → `firebase.json`

### 3.1 rewrites 매핑

| 현 `vercel.json` | 의미 | `firebase.json` rewrite (제안) | 함수 쪽 요구 |
|---|---|---|---|
| `/export/view` → `/api/export-view` | 쿼리형(`?t=`·`?token=`) 하위호환 | `{ "source": "/export/view", "function": { "functionId": "exportView", "region": "asia-northeast3" } }` | `req.query` 그대로 |
| `/export/view/:t` → `/api/export-view?t=:t` | **경로형(필수 유지)** | `{ "source": "/export/view/**", "function": {…} }` | **Firebase는 `:t`를 쿼리로 바꿔주지 않는다** — 요청 경로 `/export/view/<hex>`가 그대로 함수에 간다. 함수가 경로에서 토큰을 파싱해야 함(`export-view.js:36-39`에 이미 구현됨. 단 §3.3의 `req.url` 주의) |
| `/export/diag` → `/api/export-view?diag=1` | 진단 | `{ "source": "/export/diag", "function": {…} }` | 라우터가 `req.query.diag = "1"` 주입, 또는 핸들러가 `req.path === "/export/diag"`도 인식 |
| (없음 — Vercel은 `api/*.js`를 자동 노출) | | `{ "source": "/api/health-import", "function": {"functionId":"ingress",…} }` · `{ "source": "/api/body-import", … "ingress" }` · `{ "source": "/api/**", "function": {"functionId":"api",…} }` | 그룹 라우터가 경로로 분기 |
| (Vercel SPA 기본) | SPA fallback | `{ "source": "**", "destination": "/index.html" }` — **마지막 줄** | |
| `crons` | 크론 | 삭제 → `onSchedule`(§4) | |
| `regions: ["icn1"]` | 리전 | 함수 `region` 옵션 + rewrite `region` | |
| `functions.*.maxDuration` | 타임아웃 | 함수 `timeoutSeconds` | |

rewrite `function` 블록의 스키마(`functionId`·`region`·`pinTag`)는 `firebase-tools` `schema/firebase-config.json`
`HostingRewrites` 정의 [코드]. `region`을 생략하면 CLI가 소스에서 리전을 추정하고, 여러 리전이면 `us-central1`로
기본 선택하거나 오류를 낸다(`lib/deploy/hosting/convertConfig.js:48-56` [코드]). **`region`은 반드시 명시한다.**

**경로형 `/export/view/:t`가 깨지면 AI 공유 링크 기능이 죽는다** — Claude 웹 리더는 쿼리스트링을 유실한다
(2026-07-28 실측, ARCHITECTURE §6-10). 그래서 위 두 번째 행이 이 이전에서 가장 먼저 지켜야 할 라우트다.

### 3.2 우선순위 · 정적 파일 우선 · 리전 제약

| 규칙 | 내용 | 출처 |
|---|---|---|
| 응답 우선순위 | 예약 네임스페이스 `/__/*` → redirects → **정확히 일치하는 정적 파일** → rewrites → 404 | [스니펫] `https://firebase.google.com/docs/hosting/full-config` — 구현 세션에서 원문 재확인 |
| 정적 파일 우선의 의미 | `dist/`에 `/api/*`·`/export/*` 파일이 없으므로 rewrite가 동작. 반대로 `dist/index.html`·`sw.js`·`manifest.webmanifest`·`push-sw.js`는 rewrite 없이 정적 제공 | 빌드 산출물 실측(§6.6) |
| **겹치는 glob의 순서** | `/api/health-import`(ingress)와 `/api/**`(api)가 겹친다. Hosting이 "첫 번째 일치 규칙"을 쓰는지 원문 미확인 → **[미확인]**. 안전책: ① 구체 경로를 앞에 둔다 ② 배포 직후 프리뷰 채널에서 `curl -I`로 실측 ③ 실측이 어긋나면 `ingress`를 `api` 함수에 합친다(§7의 B안 폴백) | — |
| Hosting → 2nd gen 함수 리전 | 1세대는 `us-central1` 한정이었으나 2nd gen은 rewrite에 `region`을 지정하면 다른 리전 가능(`asia-northeast3` 포함). CLI 코드가 `functionRegion`을 그대로 API에 넘긴다(`convertConfig.js:110-111` [코드]) | [코드] + [스니펫] `https://firebase.google.com/docs/hosting/functions` ("If region is omitted… defaults to us-central1") |
| Hosting 경유 요청 타임아웃 | **60초 상한** — 함수 timeout을 더 길게 잡아도 Hosting이 504를 낸다 | [스니펫] `https://firebase.google.com/docs/hosting/functions` — 원문 재확인 필요 |
| 함수가 받는 경로 | rewrite 원본 경로 전체(`/api/analyze-food`, `/export/view/<t>`)가 그대로 전달됨 | [스니펫] `https://github.com/firebase/firebase-functions/issues/858` + Vercel도 동일 동작이라 코드 변경 없음 |
| 에뮬레이터 | Hosting 에뮬레이터도 rewrite를 함수 에뮬레이터로 프록시(`lib/hosting/functionsProxy.js:24-38` [코드]). 리전 기본 `us-central1` — rewrite에 `region`을 적으면 그 값 사용 | [코드]. 2nd gen 리전 이슈(#7580)는 [스니펫] — 실측 필요 |

### 3.3 Express 마운트 시 `req.url` 함정 (구현 세션 필독)

`export-view.js:36-39`는 `req.url`에서 `/^\/export\/view\/([^/?#]+)/`를 찾는다. Express에서 `app.use("/export", …)`처럼
**하위 경로에 마운트하면 `req.url`이 마운트 이후 부분만 남는다**(`/view/<t>`) → 정규식이 실패해 404. 두 가지 중 하나:

- (권장) 라우터가 Vercel의 치환 의미를 재현: `app.get(["/export/view", "/export/view/:t"], (req,res) => { if (req.params.t && req.query.t === undefined) req.query.t = req.params.t; return exportView(req,res); })` · `/export/diag` → `req.query.diag = "1"`. 핸들러 파일은 한 글자도 안 바꾼다.
- 또는 루트 마운트(`app.all("*", …)`)로 `req.url`을 보존.

### 3.4 캐시·헤더

| 대상 | 제안 | 근거 |
|---|---|---|
| 함수 응답 | 동적 응답은 CDN이 캐시하지 않음(기본 `private` 취급). `export-view`의 `no-store`·`X-Robots-Tag`는 그대로 유효 | [스니펫] `https://firebase.google.com/docs/hosting/manage-cache` |
| 쿠키 | Hosting은 함수로 가는 요청의 쿠키를 `__session` 외 제거 | [스니펫] 같은 페이지. 이 앱은 쿠키를 쓰지 않아 무영향(ID 토큰은 본문) |
| 정적 `assets/**` | `Cache-Control: public, max-age=31536000, immutable` (해시 파일명) | `firebase.json` `hosting.headers`(스키마 [코드]) |
| `sw.js` · `manifest.webmanifest` · `index.html` · `push-sw.js` | `Cache-Control: no-cache` — SW 갱신이 즉시 잡히게 | 현 Vercel도 SW 갱신이 즉시였음(`registerType: autoUpdate`) |
| `X-Robots-Tag` 전역 | 앱 자체는 로그인 뒤 화면이라 불필요. `/export/*`는 함수가 이미 붙임 | ARCHITECTURE §6-12(robots.txt Disallow 금지 유지) |

## 4. 크론 → `onSchedule`

| 항목 | Vercel(현재) | Firebase(제안) | 근거 |
|---|---|---|---|
| 스케줄 | `0 11 * * *` UTC(=20:00 KST), `vercel.json` | `onSchedule({ schedule: "0 20 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3", timeoutSeconds: 120, retryCount: 0, secrets: [VAPID_PRIVATE_KEY, KV_REST_API_TOKEN] }, runReminders)` | `ScheduleOptions.timeZone`·`retryCount` [코드] `lib/v2/providers/scheduler.d.ts:35-41` |
| 시간대 기본 | UTC | v2 기본 `UTC`(`lib/gcp/cloudscheduler.js:21` [코드]) → 반드시 `Asia/Seoul` 명시 | |
| 인증 | `CRON_SECRET` Bearer 대조(`cron-reminders.js:46-56`), 미설정 시 503(fail-closed, 감사 R-40) | CLI가 Cloud Scheduler 잡을 **HTTP 타깃 + OIDC 토큰(기본 컴퓨트 SA)**으로 만들고(`cloudscheduler.js:131-137` [코드]), 함수의 Cloud Run **invoker를 그 SA로만** 설정한다(`fabricator.js:502-508` [코드]) — httpsTrigger의 기본 `["public"]`(`:465`)과 달리 **공개 invoker가 아니다**. 즉 인터넷에서 URL을 알아도 IAM에서 403 | [코드] + [스니펫] `https://firebase.google.com/docs/functions/schedule-functions` ("only the associated Cloud Scheduler job has permission") |
| `CRON_SECRET` | 필수 env | **삭제**. 대체 방벽 = IAM invoker. `rateLimit(cron)`·`safeEqual`도 의미 없어 제거 | 코드 변경은 구현 세션 |
| 재시도 | 없음 | `retryCount: 0` 유지(중복 푸시 방지). 실패는 로그로 | |
| 수동 실행 | `curl -H "Authorization: Bearer …"` | Firebase 콘솔/`gcloud scheduler jobs run` — 사람 조작 [사람] | |
| 테스트 | `cron-auth.test.js`(503/401 계약) | 이 계약은 소멸 → 테스트를 "`runReminders()` 순수 실행 + 발송 모킹"으로 개편(테스트 파일 변경은 구현 세션 범위) | |
| 비용 | Hobby 크론 1일 1회 제한 [스니펫] | Scheduler 잡 1개 — 청구 계정당 3개 무료, 이후 $0.10/잡/월 [스니펫] `https://cloud.google.com/scheduler/pricing` | |

**HTTP 비노출 여부의 정확한 표현**: 함수는 여전히 Cloud Run 서비스로 HTTPS URL을 갖지만, 호출 권한(`roles/run.invoker`)이
스케줄러 SA에만 있다. "URL이 없다"가 아니라 "URL이 있어도 IAM이 막는다"이다. 따라서 `todayKST()`·발송 로직은 그대로,
검문 코드만 사라진다.

## 5. 시크릿·설정 매핑표 (`.env.example` 전수 + grep 합집합)

| 이름 | 현재 위치 | 대상 | 방식 | 비고 |
|---|---|---|---|---|
| `VITE_RECAPTCHA_SITE_KEY` | Vercel env(빌드) | **빌드타임 `VITE_`** | GitHub **Variables**(비밀 아님, 번들에 노출됨) | 프로젝트별 키(staging/prod 각각, §10) |
| `VITE_VAPID_PUBLIC_KEY` | Vercel env(빌드+서버) | 빌드타임 `VITE_` **+ 함수 params** | GitHub Variables + `functions` `.env.<project>`의 `VITE_VAPID_PUBLIC_KEY`(같은 이름 유지해 `cron-reminders.js:58` 무변경) | 공개키. 기존 VAPID 쌍 **재사용 가능**(02 §1 푸시 항목) |
| `VITE_OWNER_EMAIL` | Vercel env(빌드) | 빌드타임 | GitHub Variables(선택) | `firestore.rules`와 동기 필수 |
| `ANTHROPIC_API_KEY` | Vercel env | **Secret Manager** | `defineSecret("ANTHROPIC_API_KEY")` → `api` 함수 `secrets:[…]` | |
| `VAPID_PRIVATE_KEY` | Vercel env | **Secret Manager** | `cronReminders` | |
| `VAPID_SUBJECT` | Vercel env | params | `.env.<project>` (`mailto:` 서비스 주소) | |
| `CRON_SECRET` | Vercel env | **삭제** | §4 | |
| `FIREBASE_WEB_API_KEY` | Vercel env(선택) | params — **이름 변경 필수** | `FIREBASE_` 접두사는 Functions env에서 **예약**되어 배포 거부(`lib/functions/env.js:22,128` [코드]: `RESERVED_PREFIXES = ["X_GOOGLE_","FIREBASE_","EXT_","KIT_"]`) → 예: `WEB_API_KEY`. 코드 3곳(`verify-auth.js:4`, `verify-uid.js:5`, `push-sync.js:18`)+`.env.example`+README 갱신(구현 세션) | 값은 공개 웹 키라 시크릿 불필요 |
| `PRODUCTION_ORIGIN` | Vercel env | params | `.env.<project>` — prod: `https://<커스텀도메인>`, staging: `https://<staging>.web.app` | 02 §1 |
| `IMPORT_TOKEN` | Vercel env | **Secret Manager** | `ingress` | 단축어 헤더 값. 새 원점에서 **재발급 여부는 DR-9와 무관, 02 §1 HAE 항목** |
| `IMPORT_UID` · `IMPORT_CUTOVER_DATE` · `IMPORT_BODY_CUTOVER_DATE` · `IMPORT_TZ_OFFSET` | Vercel env | params | `.env.<project>` | 값은 우편함 귀속·컷오버 — 비밀 아님 |
| `INBODY_LOGIN_ID` · `INBODY_LOGIN_PW` · `INBODY_COUNTRY` | Vercel env(Sensitive) | **보류 — 봉인** | DR-6: 시크릿을 만들지 않는다(값 부재 = 기능 off, `import-inbox.js:94`). 필요 시 운영자가 콘솔에서만 생성 | 계정 자격증명 자체(사고 반경 큼) |
| `SHARE_TEST_TOKEN` | Vercel env(선택) | Secret Manager(선택) 또는 미설정 | `exportView` | 미설정이면 진단 샘플 경로만 비활성 |
| `KV_REST_API_URL` | Vercel(Upstash 통합 자동 주입) | params | `.env.<project>` | 호스트만. **소유권 확인 필요(DR-7 보조)** |
| `KV_REST_API_TOKEN` | Vercel | **Secret Manager** | 4개 함수 전부 | `UPSTASH_REDIS_REST_*` 이름으로 옮겨도 코드가 둘 다 읽음(`kv.js:7-13`) |
| `VERCEL_URL` · `VERCEL_ENV` · `VERCEL_GIT_COMMIT_SHA` · `VERCEL_GIT_COMMIT_REF` | 자동 주입 | **삭제** | `security.js:17`(프리뷰 origin 허용) · `export-view.js:50-52`(진단) → Cloud Run의 `K_SERVICE`/`K_REVISION` [미확인 — 기억 기반, 확인 필요]로 대체하거나 필드 제거 | |
| `NODE_ENV` | 자동 주입 | 무대응 | `security.js:60`의 경고 로그 분기에만 쓰임. Functions 런타임이 `production`을 넣는지 [미확인] — 어느 쪽이든 기능 영향 없음 | |

**시크릿 개수**: prod 4~5개(ANTHROPIC · VAPID_PRIVATE · IMPORT_TOKEN · KV_TOKEN · [SHARE_TEST]) + staging 동수 = 8~10 활성 버전.
Secret Manager 무료 6 버전/월, 초과 버전당 $0.06/월 [스니펫] `https://cloud.google.com/secret-manager/pricing` → ≈ $0.24/월.
`.env`·`.env.<project>`·`.secret.local`(에뮬레이터용) 파일은 `functions.source` 디렉터리에 둔다 [스니펫]
`https://firebase.google.com/docs/functions/config-env`. **`.secret.local`은 반드시 `.gitignore`**.

## 6. 런타임·패키지 구조

### 6.1 현재 모듈 형식

- 루트 `package.json` `"type": "module"` → `api/*.js`·`src/*.js` 전부 **ESM**. `api/*`가 `../src/reminders.js`·`../src/analysisExport.js`를 직접 import(`cron-reminders.js:19`, `export-view.js:10`). 이 두 모듈의 의존 사슬(`utils.js`·`healthEvents.js`·`bodyDraft.js`·`bodyMetrics.js`)은 **순수**(외부 import 없음, 실측).
- `firebase-functions@7.3.2`는 `require` 실패(`ERR_REQUIRE_ESM`) 시 동적 `import()`로 ESM 모듈을 로드한다(`lib/runtime/loader.js:17-27` [코드]) → **ESM 유지 가능**.
- Node 내장만 사용: `node:https`(inbody-cloud) · `node:crypto`(security · import-inbox) · 전역 `fetch`(Anthropic·KV·identitytoolkit) · `Buffer`. `web-push@3.6.7`은 순수 JS. 네이티브 모듈 없음 → Cloud Build 컴파일 이슈 없음.

### 6.2 3안 비교 (DR-3)

| 안 | 구조 | 장점 | 단점 | Windows 2대·클라우드 세션 호환 |
|---|---|---|---|---|
| **A. `functions/` 분리 + 원본 참조** | `functions/package.json` 별도, 코드는 `../api`·`../src` import | 함수 패키지 슬림 | `firebase deploy`는 `functions.source` 밖 파일을 업로드하지 않으므로 `../api` import가 **배포본에서 깨진다**. 심볼릭 링크는 Windows·zip 업로드에 취약 | ✗ |
| **B. 루트 공용(`functions.source: "."`)** | 루트 `package.json`이 함수 패키지. `main`을 함수 진입점(예: `functions.js`)으로, `engines.node` 명시. `firebase.json` `functions.ignore`로 `dist`·`docs`·`bench`·`fixtures`·`src/__tests__`·`public` 제외(기본 ignore는 `node_modules`·`.git`뿐 — `prepareFunctionsUpload.js:77-78` [코드]) | import 경로·테스트·훅·CI 전부 **무변경**. 한 패키지 = 한 lockfile | Cloud Build가 루트 `npm ci`로 `react`·`recharts`·`firebase`(클라이언트)까지 설치 → 이미지 커지고 배포 느림(수 분). `main` 필드가 Vite와 무관해 혼동 여지 | ✓ |
| **C. `functions/` 분리 + 번들(esbuild)** | `functions/package.json`(deps: firebase-functions·express·web-push) + `predeploy`에서 `api/`·`src/` 순수 모듈을 `functions/lib/index.js`로 번들 | 슬림·빠른 배포·콜드스타트 최소. 테스트는 원본(`api/`)에 그대로 | 빌드 단계 추가(esbuild devDep), 번들 산출물과 원본의 이중성, 훅 게이트가 번들 오류를 못 잡음(`eslint src api`) → 에뮬레이터 스모크로 보완 | ✓ (순수 Node 스크립트) |

**추천: B로 시작, 배포 시간·이미지가 문제되면 C.** 근거: 이 저장소의 방어선(훅·CI·517 테스트)이 전부 "원본 파일"을 본다.
B는 그 방어선이 배포본에도 그대로 적용된다. C는 성능이 낫지만 "테스트한 것 ≠ 배포한 것"의 틈이 생긴다.
`firebase.json` 초안:

```json
{
  "functions": [{ "source": ".", "codebase": "bodyplan", "runtime": "nodejs22",
                  "ignore": ["node_modules", ".git", "dist", "docs", "bench", "fixtures", "public", "src/__tests__", "scripts", ".claude", "*.log"] }],
  "hosting": { "public": "dist", "ignore": ["**/.*"],
               "headers": [ { "source": "/assets/**", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
                            { "source": "/{sw.js,push-sw.js,manifest.webmanifest,index.html}", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] } ],
               "rewrites": [ { "source": "/api/health-import", "function": { "functionId": "ingress", "region": "asia-northeast3" } },
                             { "source": "/api/body-import",   "function": { "functionId": "ingress", "region": "asia-northeast3" } },
                             { "source": "/export/diag",      "function": { "functionId": "exportView", "region": "asia-northeast3" } },
                             { "source": "/export/view",      "function": { "functionId": "exportView", "region": "asia-northeast3" } },
                             { "source": "/export/view/**",   "function": { "functionId": "exportView", "region": "asia-northeast3" } },
                             { "source": "/api/**",           "function": { "functionId": "api", "region": "asia-northeast3" } },
                             { "source": "**", "destination": "/index.html" } ] },
  "emulators": { "functions": { "port": 5001 }, "hosting": { "port": 5000 }, "firestore": { "port": 8080 }, "auth": { "port": 9099 }, "ui": { "enabled": false } }
}
```

(`functions` 배열의 필드명 `source`·`codebase`·`runtime`·`ignore`는 `schema/firebase-config.json` `LocalFunctionConfig` [코드]. `runtime` enum에 `nodejs22`·`nodejs24` 포함 [코드].)

### 6.3 Node 버전 (DR-4)

| 런타임 | 상태 | 지원 종료(deprecation) | 폐기(decommission) | 출처 |
|---|---|---|---|---|
| `nodejs20` | GA로 표기되나 **deprecation 2026-04-30 경과** | 2026-04-30 | **2026-10-30** | [코드] `lib/deploy/functions/runtimes/supported/types.js:50-54` |
| **`nodejs22`** (추천) | GA | 2027-04-30 | 2028-10-31 | [코드] `:56-60` |
| `nodejs24` | GA | 2028-04-30 | 2028-10-31 | [코드] `:62-66` |

`nodejs20`은 폐기 6주 전이라 제외. `nodejs22`는 이 클라우드 세션(22.22)과 일치. CI(`ci.yml`)는 Node 20 — **22로 올려야
로컬·CI·런타임이 같은 메이저**가 된다(`.github` 변경은 구현 세션). Windows PC 2대의 Node 버전은 [미확인].

### 6.4 테스트 어댑터 필요 여부

| 테스트 | 모킹 방식 | 함수 이전 후 |
|---|---|---|
| `export-view.test.js:8-20` · `share-link.test.js` · `health-import.test.js` · `inbody-cloud.test.js` | 가짜 `res`(`status/json/setHeader/send`) + 가짜 `req`(`method/query/headers/body/url`)로 **핸들러 직접 호출** | 핸들러 시그니처 `(req,res)` 불변 → **어댑터 불필요, 517건 유지** |
| `cron-auth.test.js` | 위와 동일 | 검문 계약이 소멸 → 개편(§4) |
| `push-state` · `e2e-chain` · 골든 | 순수 | 무변경 |
| 신규 | 라우터 배선(경로→핸들러, `:t`→`query.t`, `/export/diag`→`query.diag`) 단위 테스트 + 에뮬레이터 스모크(§11) | 추가 |

### 6.5 플랫폼 차이 5건 (구현 세션 체크리스트)

1. **클라이언트 IP**: Hosting 경유 시 원 IP가 `fastly-client-ip`에 오고 `x-forwarded-for`는 CDN IP [스니펫] (`https://github.com/pbojinov/request-ip/issues/37` 등, 공식 문서 원문 [미확인]). `security.js:47-51`의 `getClientIp`가 그대로면 **rate limit 키가 CDN IP로 뭉쳐** 정상 사용자가 429를 맞을 수 있다 → `fastly-client-ip` 우선, 없으면 XFF. 함수 직접 URL로 우회 호출 시 이 헤더는 위조 가능(P2, 02 §1).
2. **본문 파싱**: functions-framework가 JSON·text·urlencoded를 파싱하고 그 외는 `bodyParser.raw({type:'*/*'})`로 **Buffer**를 준다(`server.js:70-88` [코드]; 한도 `'1024mb'` `:60`, 상위 계층 32MiB [스니펫]). `req.rawBody`도 있음(`lib/common/providers/https.d.ts:10` [코드]). 기존 `Buffer.isBuffer` 분기와 호환.
3. **`req.url` 마운트 함정**: §3.3.
4. **OPTIONS**: 동일 원점이라 preflight 없음. 라우터를 `app.all()`로 걸면 핸들러의 `OPTIONS` 분기도 그대로 동작.
5. **진단 필드**: `export-view.js:50-52` Vercel 전용 env 3종 → 제거 또는 대체.

### 6.6 정적 산출물 실측 (2026-09-07 `vite build`)

`dist/` 1.4MB · precache 17개(1,294KiB) · 청크 4개(firebase 441KB · recharts 363KB · index 294KB · vendor 186KB) ·
`manifest.webmanifest`의 `start_url:"/"`·`scope:"/"` (상대) · `sw.js`에 `push-sw.js` importScripts. 전부 원점 무관 경로.

## 7. 함수 분할 전략 (DR-11)

| 관점 | A. 11개 개별 | B. Express 라우터 1개(`/api/**`+`/export/**`) | **C. 그룹 4개(추천)** |
|---|---|---|---|
| 콜드스타트 | 서비스 11개 각각 콜드 → 앱 첫 화면에서 pull·push-sync·analyze가 **각각** 1회씩 콜드 | 1회 | `api` 1회(앱 경로 전부 공유), ingress·exportView는 호출 주체가 달라 독립 |
| 배포 시간 | Cloud Build/Run 리비전 11개 → 가장 느림 | 가장 빠름 | 4개 |
| 격리 | 최상 — 체성분 파서 오류가 운동 수신을 못 잡음(ARCHITECTURE §2의 설계 의도) | 최하 — 한 서비스 장애·타임아웃·메모리 초과가 전부에 파급 | 인증 태세별 격리: 앱(checkOrigin)/단축어(토큰)/공개 GET/스케줄. health·body-import는 한 서비스지만 요청 단위 격리(Express 에러는 요청 단위)라 모듈 로드 실패 외엔 서로 안 잡음 |
| 로그·모니터링 | 서비스별 필터 | 경로 라벨 필요 | 서비스별 + 경로 |
| 메모리·timeout 개별 설정 | 가능 | 불가(최대값으로 통일 → 비용↑) | 그룹별(api 512MiB/60s, ingress 256/30, exportView 256/30, cron 256/120) |
| minInstances 비용(쓸 경우) | ×11 | ×1 | ×4 |
| rewrite 수 | 11+3 | 2 | 6 |
| Hosting 60s 상한과의 상성 | 무관 | 무관 | 무관 |

추천 C. 폴백: §3.2의 glob 순서가 실측에서 어긋나면 `ingress`를 `api`에 흡수(그룹 3개).

## 8. 콜드스타트·성능

| 경로 | 현재(Vercel icn1) | 이전 후(minInstances 0) | 대응 |
|---|---|---|---|
| 앱 시작 `import-inbox pull` | 수백 ms | 콜드 시 +0.5~2s(Node 일반값 [스니펫]; 이 번들은 express·web-push 수준이라 하단) | 앱은 localStorage-first라 화면은 즉시. pull 지연은 배경. 그대로 수용 |
| AI 분석(4s 대기) | 4~6s | +콜드 1s | 사용자 체감 미미. timeout 60(Hosting 상한) |
| 인바디 pull(예산 12s, `import-inbox.js:51`) | 30s 함수 | 30s 유지 · Hosting 60s 이내 | 봉인 상태라 실제 호출 없음(DR-6) |
| 크론(구독자 N 순차) | 60s | 120s, Hosting 비경유 | N≈100까지 안전(uid당 KV 4회+발송 2회 ≈ 0.5s) |
| CPU | — | v2 CPU 1 고정(메모리 ≤2GiB) → 인스턴스 시간 과금 | §9 |
| 동시성 | Vercel 인스턴스당 1 | v2 기본 80(`options.d.ts:95` [코드]) → 동시 요청이 인스턴스를 공유해 콜드·비용 감소 | |
| `minInstances 1` 옵션 | — | 서비스당 약 $3~8/월 [스니펫] — 1,000 MAU 전엔 불필요 | DR 불요, 운영 중 조정 |

## 9. 비용·한도 추정 (1,000 MAU 가정)

가정: MAU 1,000 · DAU 400(40%) · DAU 1인/일: 앱 열기 3회(pull 3 + ack 1) · push-sync 3 · AI 분석 2 · 공유 0.1 → **≈ 10 호출/일**.
지속 시간: pull 0.4s · push-sync 0.3s · AI 4s · 공유·뷰 0.2s. 인스턴스 시간 = 요청 시간 합(동시성 공유 무시 = **상한**).

| 항목 | 계산식 | 월 추정 | 무료 한도 | 소비율 | 출처 |
|---|---|---|---|---|---|
| 함수 호출 | 400 × 10 × 30 + 30(크론) | **120k** | 2,000,000/월 | 6% | [스니펫] `https://cloud.google.com/run/pricing` |
| vCPU-초 | 400×30×(4×0.4+3×0.3+2×4+0.1) = 400×30×10.6 | **127k** | 180,000 | 71% | 같은 페이지 |
| GiB-초 | 127k × 0.25GiB(256MiB) / `api` 512MiB면 ×0.5 | 32k~64k | 360,000 | 9~18% | 같은 페이지 |
| 초과 시 단가 | Tier 1 vCPU $0.000024/s · GiB $0.0000025/s · $0.40/100만 요청 [스니펫]. **`asia-northeast3`는 Tier 2**로 더 비쌈(+35% 수준 [스니펫], 정확 단가 [미확인]) | 2배 트래픽이면 vCPU 74k 초과 × ≈$0.000032 ≈ **$2.4** | | | `https://docs.cloud.google.com/run/docs/locations` |
| Hosting 저장 | 1.4MB × 보관 릴리스 수 | ≪ 1GB | 10GB | <1% | [스니펫] `https://firebase.google.com/docs/hosting/usage-quotas-pricing` |
| Hosting 전송 | 신규 설치 1,000×1.3MB + 배포 8회×400 DAU×0.4MB | ≈ 2.6GB/월 ≈ 87MB/일 | 360MB/일 | 24% (전체 청크 갱신 배포일은 520MB → 초과분 $0.15/GB ≈ $0.02) | 같은 페이지 |
| Firestore 읽기(**범위 밖 — 언급만**) | `getAllData`가 앱 열 때마다 `data` 컬렉션 전량(`store.js:405-426`): 400 DAU × 3 × 400문서 | 14.4M/월 | 50k/일(=1.5M/월) | **960%** → (14.4M−1.5M)×$0.06/10만 ≈ **$7.7/월** | [스니펫] `https://firebase.google.com/pricing`. 이 항목이 청구서의 대부분이며 별도 세션(`getAllData` 개선)의 근거 |
| Cloud Scheduler | 잡 1개 | $0 | 3잡/청구계정 | 33% | [스니펫] |
| Secret Manager | 8~10 버전 | ≈ $0.24 | 6 버전 | 초과 | [스니펫] |
| Cloud Build(배포) · Artifact Registry(이미지) | 배포당 빌드 4개 · 이미지 4×≈150MB | 소액 | [미확인] | — | `functions:artifacts:setpolicy`로 옛 이미지 정리(`lib/functions/artifacts.js` [코드]) |
| **합계(Firestore 제외)** | | **$0.3~3/월** + 도메인 | | | Vercel Pro $20/월 [스니펫] 대비 |

**예산 알림·상한 제안**: Cloud Billing 예산 **$10/월**, 알림 50/90/100% · Cloud Run **max instances** `api` 3 · 나머지 2(비용 천장 =
인스턴스 수 × 시간) · Google Cloud **spend cap 예산 $30**(초과 시 Cloud Run이 일시정지되어 5xx — 의도된 킬 스위치, [스니펫]
`https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps`). Firebase 콘솔이 Blaze 전환 시 예산 알림을 자동 제안 [스니펫].

## 10. 2-프로젝트 구성 (staging / prod) — DR-5

| 항목 | prod | staging |
|---|---|---|
| 프로젝트 | `daniel-tracker-cb781`(기존, Firestore·Auth 그대로) | 신규(예: `bodyplan-staging`) — Blaze 필요(Functions) + 예산 알림 $5 |
| `.firebaserc` | `{"projects":{"default":"daniel-tracker-cb781","prod":"daniel-tracker-cb781","staging":"<id>"}}` (`firebase use staging`) | |
| 시크릿 | Secret Manager(prod 프로젝트) | Secret Manager(staging 프로젝트) — **HAE 토큰·KV 토큰 별도 값** |
| KV | 기존 Upstash DB | **별도 Upstash DB**(무료 티어 1개 더) — 사서함·seen 도장·푸시가 섞이면 안 됨 |
| Auth 승인 도메인 | 커스텀 도메인 + `daniel-tracker-cb781.web.app` | `<staging>.web.app` |
| App Check | 기존 reCAPTCHA 키(도메인 추가) | 별도 키 또는 디버그 토큰(03 §2) |
| Firestore 시드 | 없음(실데이터) | ① 앱의 JSON 백업(`src/backup.js`)을 staging 계정에서 "복원"(사용자 UI 경로, 실데이터 사본 주의 — shareLink·식별자는 이미 제외됨 `backup.js:16-30`) ② 또는 `fixtures/golden-sample.json`(백업 형식과 동일) 복원 → **② 추천**(개인정보 없음) |
| 규칙 | 콘솔 게시(현행 관행) — `firebase deploy --only firestore:rules`는 **CI에서 제외**(규칙 배포는 사람이, `docs/firestore-rules-r36.md` 절차) | 같은 규칙 파일 게시 |
| 인바디 | 봉인 | 봉인 |

## 11. 테스트 전략 (에뮬레이터)

- 요구: `firebase-tools` 15.x는 **Java 21 이상**(`lib/emulator/commandUtils.js:390-392` [코드]). 클라우드 VM Java 21 ✓ · CI는 `actions/setup-java`(21) · Windows PC [미확인].
- 실행: `firebase emulators:exec --project demo-bodyplan --only functions,hosting,firestore,auth "npx vitest run --config vitest.emu.config.js"` — `demo-*` 프로젝트 ID는 클라우드 호출 없이 동작(로그인 불필요 [스니펫] — 원문 [미확인]).
- 검증 항목: ① Hosting 5000 → `/api/analyze-food`가 함수 에뮬레이터로 프록시되는가(`functionsProxy.js:24-38` [코드]) ② `/export/view/<32hex>`가 경로 파싱으로 200/404를 내는가(**AI 리더 시나리오**) ③ `/export/diag` ④ 비JSON Content-Type POST가 Buffer로 도착해 400이 아닌 정상 파싱되는가 ⑤ SPA fallback ⑥ 규칙 테스트(`@firebase/rules-unit-testing`, 선택).
- 시크릿: `.secret.local`(gitignore) · KV는 기존 인메모리 모킹(`health-import.test.js:10-60`)을 에뮬레이터 스모크에서도 env 미설정(fail-open)으로 우회 → rate limit 경로는 단위 테스트가 담당.
- 게이트 위치: 훅(`check.mjs`)에는 넣지 않는다(90초 제한·Java 의존). CI의 별도 job으로만(03 §1).

## 12. 롤백 계획

| 단계 | 내용 |
|---|---|
| 병행 기간(DR-8) | Vercel 배포를 **삭제하지 않고 그대로 둔다**(Hobby 유지, env 그대로). 같은 Upstash·Firestore를 바라보므로 데이터는 한 곳. 두 원점이 동시에 살아 있어도 충돌 없음(사서함은 uid 키, seen 도장은 멱등) |
| DNS | 커스텀 도메인은 신규라 "되돌릴 DNS"가 없다 — 롤백 = 사용자를 `daniel-tracker.vercel.app`으로 다시 안내. TTL은 300s로 낮춰 두면 도메인을 Vercel로 옮기는 2차 롤백도 빠름 |
| 되돌리기 조건 | 컷오버 후 24h 내: Google 로그인 실패(승인 도메인/authDomain), HAE 단축어 401/5xx 지속, 공유 링크 404(경로형), 밤 8시 푸시 미수신, `import-inbox` 504 |
| 되돌리는 절차 | ① 단축어 URL을 vercel.app으로 복귀 [사람] ② 앱 안내 문구 ③ Scheduler 잡 일시정지(중복 푸시 방지 — Vercel 크론이 살아 있으므로) ④ Firebase 함수는 두어도 무해 |
| 병행 중 이중 크론 | **Vercel 크론과 Scheduler가 동시에 살아 있으면 푸시가 2번 간다** → 컷오버 순서에서 Vercel 크론 제거(`vercel.json` crons 삭제 배포 또는 Vercel 프로젝트 크론 비활성)가 선행. 02 런북 |
| 종료 | 병행 기간 끝: Vercel 프로젝트 삭제 **전에** Upstash가 Vercel Marketplace 통합인지 확인(DR-7 보조) — 통합 제거가 DB 삭제로 이어질 수 있음 [스니펫, 원문 미확인] |

## 13. 대안 한 장 — Cloudflare Pages + Workers를 택하지 않는 이유

| 항목 | Cloudflare 무료 | 이 앱과의 충돌 |
|---|---|---|
| Workers CPU 10ms/요청, 10만 요청/일 [스니펫] `https://developers.cloudflare.com/workers/platform/limits/` | AI 호출은 I/O 대기라 CPU는 적지만, **4MB HAE 본문 JSON 파싱 + 화이트리스트 검문**과 **사진 base64(수 MB) JSON 처리**는 10ms를 넘길 수 있음 → 유료($5/월)로 올라가면 비용 이점 소멸 |
| KV 쓰기 1,000/일 [스니펫] `https://developers.cloudflare.com/kv/platform/limits/` | Upstash를 유지하면 무관하나, 그러면 "청구서 한 장"이 아니라 세 장(Cloudflare·Upstash·Firebase) |
| 런타임 = Node가 아님 | `node:https`로 헤더 지문을 통제하는 `inbody-cloud.js`(봉인 중이나 자산), `web-push`(Node crypto) → `nodejs_compat` 하에서도 재검증 필요. 재작성 범위가 Firebase(어댑터 수준)보다 큼 |
| Auth/Firestore/App Check | 어차피 Firebase → 콘솔 2개·승인 도메인·App Check 도메인 관리가 분산 |
| 결론 | Firebase 이전이 "옮기는 코드 최소 + 청구서 1장"이라는 배경(§0 배경)에 부합. Cloudflare는 이점이 CPU 과금 모델뿐이고 이 앱의 병목은 CPU가 아니라 Firestore 읽기(§9) |
