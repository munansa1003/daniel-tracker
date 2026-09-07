# 이전 구현 세션 — 자동결정 · NEEDS_HUMAN · BLOCKED

> 작성 2026-09-07 · 브랜치 `claude/vercel-firebase-migration-impl-kijfex` · PR #106
> 설계 문서(`01-firebase-plan.md` · `02-impact-map.md` · `03-ci-deploy-design.md`)에 답이 없어
> 구현 세션이 스스로 정한 것과, 코드로 끝낼 수 없어 사람이 해야 하는 것을 여기 모은다.
> 형식: `[자동결정] 무엇 · 왜 · 되돌리는 법`.

---

## 1. 실측으로 확정된 것 (설계 문서의 [미확인] 해소)

### ✅ 겹치는 rewrite glob의 우선순위 — **구체 경로가 `/api/**`를 이긴다**

`01-firebase-plan.md §3.2`가 **[미확인]**으로 남겨 둔 항목이다("Hosting이 첫 번째 일치 규칙을
쓰는지 원문 미확인"). 이 세션에서 Hosting 에뮬레이터로 실측했다.

```
[hosting] Rewriting /api/health-import to …/asia-northeast3/ingress    for local Function asia-northeast3/ingress
[hosting] Rewriting /api/body-import   to …/asia-northeast3/ingress    for local Function asia-northeast3/ingress
[hosting] Rewriting /api/analyze-food  to …/asia-northeast3/api        for local Function asia-northeast3/api
[hosting] Rewriting /export/diag       to …/asia-northeast3/exportView for local Function asia-northeast3/exportView
```

`firebase.json`에 적힌 순서대로 첫 번째 일치 규칙이 이겼다. **폴백(§7 B안 — ingress를 api에
흡수)은 필요 없다.** 다만 이것은 에뮬레이터 실측이므로, 컷오버 전 프리뷰 채널에서
`X-Function-Group` 헤더로 한 번 더 확인한다(02 A9).

### ✅ 함수 이름은 camelCase로 배포된다

`exportView`·`cronReminders` 같은 대문자 포함 export 이름이 그대로 함수 ID가 된다
(에뮬레이터가 `asia-northeast3-exportView`로 초기화). 설계 문서의 `firebase.json` 초안이 쓴
`functionId: "exportView"`가 유효하다.

### ✅ 비JSON Content-Type 본문이 기존 Buffer 분기로 통한다

`Content-Type: text/plain`으로 보낸 JSON 본문이 400(파싱 실패)이 아니라 **검문 결과 그대로**
(토큰 미설정이면 503, 불일치면 401) 응답했다. 단축어의 '파일 첨부' 경로가 Firebase에서도
Vercel과 같게 동작한다.

### ✅ Cloud Run 환경변수로 진단 필드가 채워진다

`/export/diag`가 `vercelEnv: "exportView"`(= `K_SERVICE`) · `commit: "1"`(= `K_REVISION`)로
응답했다. `VERCEL_*`가 없는 환경에서 필드가 `unknown`으로 비지 않는다.

---

## 2. `[자동결정]`

### `[자동결정]` `PREVIEW_ORIGIN_SUFFIX`는 순수 접미사뿐 아니라 `*` 패턴도 받는다

- **왜**: 계획서 WP-2는 "접미사 일치"라고 적었지만, 프리뷰 채널 호스트는
  `<project>--<채널>-<해시>.web.app` 꼴이라 **프로젝트 이름이 앞에 온다**. 순수 접미사로 열려면
  `.web.app`을 넣어야 하고, 그러면 **남의 Firebase 사이트 전부**가 허용된다.
  `03-ci-deploy-design.md §2` C안이 쓴 표기(`https://<staging>--*.web.app`)가 실제로 필요한 형태다.
  구현 중 테스트가 이 구멍을 드러내 그대로 고쳤다.
- **되돌리는 법**: `api/_lib/security.js`의 `matchesPreviewSuffix`에서 `*` 분기를 지우면 순수
  접미사만 남는다. 값에 `*`가 없으면 지금도 순수 접미사로 동작하므로, 되돌려도 설정은 그대로 산다.

### `[자동결정]` `getClientIp`에 `x-real-ip` 폴백을 남긴다

- **왜**: 계획서는 `fastly-client-ip` → `x-forwarded-for` → `socket.remoteAddress` 3단계를 적었는데,
  옛 코드에는 `x-real-ip`가 있었다. 지우면 Vercel에서의 동작이 바뀐다(병행 호환 불변식 위반).
  넣어도 Firebase에서는 그 헤더가 오지 않아 무해하다.
- **되돌리는 법**: 해당 3줄 삭제.

### `[자동결정]` `functions.ignore`에 `.env.local`·`.env.*.local`·`.secret.local`을 넣는다

- **왜**: 루트가 함수 소스라(DR-3 B안) 로컬 비밀 파일이 배포 zip에 그대로 올라간다.
  `ignore`는 업로드 목록에만 영향을 주고, 에뮬레이터는 디스크에서 직접 읽으므로 로컬 개발에는
  영향이 없다(이 세션에서 `.env.local` 로딩이 정상 동작함을 확인).
- **되돌리는 법**: `firebase.json`의 `functions[0].ignore`에서 세 줄 삭제.

### `[자동결정]` `params-bridge`의 1회 실행 플래그를 **그룹별**로 둔다

- **왜**: 프로덕션은 그룹 4개가 각각 별도 프로세스지만 **에뮬레이터는 한 프로세스**다.
  전역 불리언 하나면 먼저 뜬 그룹이 플래그를 소진해 나머지 그룹의 param이 영영 안 채워진다 —
  에뮬레이터에서만 나는 종류의 버그라 프로덕션 테스트로는 안 잡힌다.
- **되돌리는 법**: `api/_lib/params-bridge.js`의 `Set`을 불리언으로 되돌린다.

### `[자동결정]` `WEB_API_KEY`를 모듈 상수가 아니라 함수로 읽는다

- **왜**: 상수면 import 시점의 `process.env`가 굳는다. params 어댑터는 첫 요청 때 도는 경우가
  있어 그 뒤에 채워진 값이 반영되지 않는다. 호출 시점에 읽으면 순서 문제가 사라지고,
  테스트에서 env를 바꿔 가며 확인할 수 있다.
- **되돌리는 법**: 세 파일(`_lib/verify-auth.js`·`_lib/verify-uid.js`·`push-sync.js`)의
  `webApiKey()`를 다시 `const`로.

### `[자동결정]` 에뮬레이터 스모크를 `vitest.config.js`의 기본 스위트에서 제외한다

- **왜**: 파일 이름이 `*.test.js`라 기본 include에 걸린다. 그대로 두면 에뮬레이터가 없는
  모든 실행(훅·로컬·CI 게이트)에서 항상 실패한다. `exclude`에 `src/__tests__/emu/**`를 추가했다.
- **되돌리는 법**: `vitest.config.js`의 `exclude` 한 줄 삭제(대신 파일 이름을 바꿔야 한다).

---

## 3. `BLOCKED` — 이 샌드박스에서 끝내지 못한 것

### ⚠️ Hosting 에뮬레이터 경유 스모크는 이 세션에서 실행하지 못했다 (코드 문제 아님)

- **증상**: `npm run test:emu`에서 Hosting(5000)이 함수(5001)로 **프록시하는 홉**이 403으로 막힌다.

  ```
  HTTP/1.1 403 Forbidden
  x-proxy-error: request blocked: no rule allows host "127.0.0.1"
  ```

- **원인**: 이 클라우드 세션의 에이전트 프록시다. `firebase-tools`의 Hosting 프록시가
  `NO_PROXY`(127.0.0.1 포함)를 무시하고 루프백 요청까지 `HTTPS_PROXY`로 보낸다.
  **애플리케이션 코드·`firebase.json`과 무관하다.** GitHub Actions에는 이 프록시가 없으므로
  CI의 `emulator-smoke` job에서는 그대로 돈다.
- **대신 확인한 것** (같은 에뮬레이터, 함수 직접 호출 — 즉 functions-framework를 그대로 통과):

  | 요청 | 결과 |
  |---|---|
  | `POST /api/analyze-food` (Origin 없음) | `403` · `X-Function-Group: api` · `{"error":"Forbidden origin"}` |
  | `POST /api/push-sync` (Origin 없음) | `403` · `X-Function-Group: api` |
  | `POST /api/nope` | `404` · `{"error":"not-found","message":"unknown api route: nope"}` |
  | `POST /api/health-import` **via api 그룹** | `404` — 그룹 경계가 선다 |
  | `POST /api/health-import` (ingress) | `503` (env 3종 미설정 = 설계된 잠금) · `X-Function-Group: ingress` |
  | 같은 요청, `Content-Type: text/plain` | `503` — **400(파싱 실패)이 아니다** |
  | `POST /api/analyze-food` **via ingress 그룹** | `404` · `unknown ingress route: analyze-food` |
  | `GET /export/view/<32hex>` | `404` · `X-Share-View: unconfigured` · `Cache-Control: no-store` · `X-Robots-Tag: noindex, nofollow` |
  | `GET /export/diag` | `200` · `{"route":"export-view",…,"vercelEnv":"exportView","commit":"1"}` |
  | `GET /export/view` (토큰 없음) | `404` |
  | `POST /export/view` | `405` `{"error":"GET only"}` |
  | `GET /export/other` | `404` |

  그리고 rewrite 매칭 자체는 Hosting 에뮬레이터의 라우팅 로그로 확인했다(§1 첫 항목) —
  막힌 것은 매칭 **뒤의** 프록시 홉이다.
- **남은 일**: CI의 `emulator-smoke` job이 이 PR에서 바로 돈다(자격증명 불필요). 그 job의 초록불이
  Hosting 경유 경로까지의 최종 확인이다.

---

## 4. `NEEDS_HUMAN` — 콘솔·자격증명이 필요해 이 세션이 하지 않은 것

이름은 `03-ci-deploy-design.md §4.1`·`02-impact-map.md §2` 런북 표기 그대로다.

### 4.1 배포 전 준비 (02 Phase A)

| # | 작업 | 근거 |
|---|---|---|
| A1 | Firebase 프로젝트 **Blaze 전환** + 예산 알림 $10(50/90/100%) + spend cap 예산 $30 | 02 A1 |
| A2 | staging 프로젝트 생성·Blaze·예산 $5 · Upstash DB 1개 추가 → 그 ID를 `.firebaserc`의 `staging`과 GitHub Variable `FIREBASE_PROJECT_STAGING`에 반영 (**지금은 `bodyplan-staging` 플레이스홀더**) | DR-5 |
| A3 | Secret Manager에 시크릿 **4개** 생성: `ANTHROPIC_API_KEY` · `IMPORT_TOKEN` · `KV_REST_API_TOKEN` · `VAPID_PRIVATE_KEY`. `firebase functions:secrets:set NAME --project <id>`. **`INBODY_LOGIN_ID/PW`·`SHARE_TEST_TOKEN`은 만들지 않는다**(DR-6·DR-7 — 값 부재 = 그 기능만 off) | DR-7 A+a |
| A4 | 커스텀 도메인 구매 → Hosting 연결(TXT → A/AAAA), **DNS TTL 300s**, SSL 발급 최대 24h | DR-1 |
| A5 | Auth **승인 도메인**에 커스텀 도메인 + `<project>.web.app` 추가 | 02 #8 (P0) |
| A6 | reCAPTCHA 키 도메인에 추가 + App Check 강제 여부·검증 요청 수 확인 | 02 #10 (P0) |
| A7 | GCP OAuth 클라이언트에 리디렉션 URI `https://<도메인>/__/auth/handler` 추가 | DR-12 |
| A8 | GitHub **Secrets** `GCP_WIF_PROVIDER`·`GCP_DEPLOY_SA_EMAIL` + **Variables** 등록(§4.2) · WIF 풀/제공자 생성 · 배포 SA 역할 부여(03 §4.2 표) | DR-13 |
| A9 | 1차 부트스트랩 배포를 **운영자 계정(owner)으로** 1회 — API 활성화·시크릿 바인딩·아티팩트 정책을 만든 뒤 CI SA를 최소 권한으로 좁힌다 | 03 §4.2 권고 |
| A10 | 옛 앱(폰 전부)을 온라인으로 한 번 열어 대기분 동기화 + JSON 전체 백업 1회 | 02 #19 |

### 4.2 GitHub Variables (워크플로가 이 이름을 읽는다)

| 종류 | 이름 |
|---|---|
| Secret(저장소) | `GCP_WIF_PROVIDER` · `GCP_DEPLOY_SA_EMAIL` |
| Variable(저장소) | `FIREBASE_PROJECT_PROD` · `FIREBASE_PROJECT_STAGING` · `PROD_HOSTNAME` |
| Variable(빌드) | `VITE_RECAPTCHA_SITE_KEY` · `VITE_VAPID_PUBLIC_KEY` · `VITE_OWNER_EMAIL` · `VITE_AUTH_DOMAIN` · `VITE_NEW_ORIGIN` |
| Variable(함수 env) | `PRODUCTION_ORIGIN` · `KV_REST_API_URL` · `IMPORT_UID` · `IMPORT_CUTOVER_DATE` · `IMPORT_BODY_CUTOVER_DATE` · `IMPORT_TZ_OFFSET` · `VAPID_SUBJECT` · `PREVIEW_ORIGIN_SUFFIX`(staging만) |

`[자동결정]` **prod와 staging이 같은 변수 이름을 쓴다** — 값은 GitHub **Environment**
(`production` / `staging`)에 각각 둔다. Environment 변수가 저장소 변수를 덮으므로 워크플로는
한 벌이면 되고, 이름이 갈리면(`STAGING_…`) 새 변수를 추가할 때마다 두 곳을 고쳐야 해서
한쪽을 빠뜨리기 쉽다. 되돌리는 법: 두 워크플로의 `env:` 블록에서 `vars.X`를 `vars.STAGING_X`로.

> ⚠️ **`KV_REST_API_URL`·`IMPORT_UID`는 `staging` Environment에 반드시 스테이징 값을 넣는다.**
> 비워 두면 저장소 변수(= prod 값)로 떨어져 프리뷰가 **실데이터 사서함·푸시 구독**을 두드린다.

**`FIREBASE_PROJECT_PROD`·`FIREBASE_PROJECT_STAGING`이 비어 있으면 배포 job은 통째로 skip된다**
(빨간불이 아니라 회색). 즉 이 PR을 머지해도 변수를 넣기 전까지는 아무것도 배포되지 않는다.
반면 `ci.yml`의 `emulator-smoke` job은 자격증명이 필요 없어 **지금 바로 돈다**.

### 4.3 컷오버 당일 (02 Phase B) — 순서 엄수

| # | 작업 |
|---|---|
| B1 | **Vercel 크론 비활성**(또는 `vercel.json`의 `crons` 제거 배포) — Scheduler 잡 생성보다 **먼저**. 안 그러면 밤 8시 푸시가 2번 간다 |
| B5 | 단축어 2개(운동·체성분)의 POST URL을 새 도메인으로 교체 → 수동 실행으로 200 확인 |
| B6 | **옛 앱 로그아웃 → 새 앱에서 알림 켜기** (순서 반대면 새 구독이 지워진다) |
| B7 | 새 도메인에서 공유 링크 발급 → **Claude 웹에서 실제 열람** |

### 4.4 병행 종료 전 (02 Phase C)

| # | 작업 |
|---|---|
| C4 | **Upstash 소유권 확인**(DR-14) — Vercel Marketplace 통합이면 통합 삭제가 DB 삭제로 이어질 수 있다. 확인 전에는 Vercel 프로젝트를 지우지 않는다 |
| C5 | 문서 URL 일괄 갱신(`docs/hae-setup.md` 등) — 도메인이 정해진 뒤 |

### 4.5 이 세션이 하지 않은 것 (금지 목록)

`firebase deploy`/`login` · 시크릿 값 생성·기록 · `firestore.rules` 변경 · `vercel.json` 변경 ·
`src/utils.js` 상수 · `src/store.js`의 `getAllData` 개선 · `firebase-tools`를 devDependency로 추가 ·
docs 속 `vercel.app` URL 일괄 치환 · 인바디 코드 제거.
