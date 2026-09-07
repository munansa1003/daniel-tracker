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

### ⚠️ 에뮬레이터는 OPTIONS를 가로챈다 — **프로덕션과 다르다** (CI 스모크에서 발견)

CI의 `emulator-smoke`가 처음 돌 때 `OPTIONS /api/analyze-food`만 실패했다. 추적 결과:

- 함수 에뮬레이터가 런타임 env에 `FIREBASE_DEBUG_FEATURES={"enableCors":true,…}`를 넣는다
  (`firebase-tools` `lib/emulator/functionsEmulator.js:996-998`).
- `firebase-functions`의 `onRequest`는 그 플래그가 보이면 **핸들러를 cors 미들웨어로 감싼다**
  (`lib/v2/providers/https.js:53-65`). 그 미들웨어가 preflight를 **204로 먼저 끝내** 우리 라우터가
  아예 돌지 않는다 — 그래서 `X-Function-Group` 헤더도 없다.
- 프로덕션에서는 `cors` 옵션을 주지 않았고 디버그 플래그도 없다 → 감싸기가 없다 →
  **OPTIONS가 핸들러까지 가서 Vercel과 같게 동작한다**(`checkOrigin` → 403/200).

즉 코드 문제가 아니라 **에뮬레이터 전용 차이**다. 스모크 테스트는 두 환경 모두에서 참인 것
(라우팅됨 + 5xx 아님)만 보도록 고쳤고, OPTIONS가 핸들러까지 간다는 계약은 단위 테스트
(`functions-router.test.js`·`functions-integration.test.js`)가 지킨다.

앱은 전부 동일 원점 상대 경로로 호출해 브라우저가 preflight를 보내지 않으므로(01 §6.5-4)
어느 쪽이든 사용자 영향은 없다.

### ℹ️ 에뮬레이터의 `firebase-admin` 경고는 무시한다

에뮬레이터가 매 함수 로드마다 이렇게 경고한다:

```
⚠  The Cloud Functions emulator requires the module "firebase-admin" to be installed as a dependency.
i  functions: Your functions could not be parsed due to an issue with your node_modules (see above)
```

**경고일 뿐이다** — 함수 4개는 정상 로드·실행됐다(같은 로그의 `Loaded functions definitions from
source: api, cronReminders, exportView, ingress`). 에뮬레이터는 `package.json`의 **직접**
의존성 목록만 보고 이 경고를 낸다(패키지 자체는 firebase-functions의 peer로 이미 설치돼 있다).
이 경고를 없애려고 `firebase-admin`을 직접 의존성에 추가하지 말 것 — 자세한 이유와 실제 방벽은
§2 맨 아래 "`firebase-admin`은 막을 수 없고 막을 필요도 없다" 항목에 있다.

### ⚠️ `defineString`의 `default`는 **런타임 폴백이 아니다** — params 어댑터는 사실상 no-op

실행해서 확인했다: `defineString(name, { default: "X" }).value()`는 런타임에 `process.env[name]`을
읽을 뿐이고, 값이 없으면 **`"X"`가 아니라 빈 문자열**을 돌려준다. `default`는 배포(그리고
에뮬레이터 기동) 시점에 CLI가 함수 env로 **미리 구워 넣는** 값이다 — 실제로 이 세션의
에뮬레이터가 `.env.local`에 `PRODUCTION_ORIGIN=https://daniel-tracker-cb781.web.app`을 써 넣었다.

따라서 `api/_lib/params-bridge.js`는 **관찰된 모든 환경에서 채울 빈 자리가 없는** 안전망이다.
설계(01 §2)가 요구한 형태이고 비용이 0이라 그대로 두되, "이 어댑터가 프로덕션을 떠받친다"는
착각을 막기 위해 모듈 주석과 여기에 사실을 적어 둔다. 실질적 함의 하나:
**미설정 값의 폴백은 코드가 아니라 배포가 준다** — 그래서 CI의 `.env.<project>` 생성 step이
빈 값을 쓰지 않는 것(빈 값은 default를 덮어쓴다)이 중요하다.

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

### ⚠️ `functions.ignore`의 `"src/__tests__"`는 **아무것도 거르지 않았다** (리뷰 → 실측으로 발견)

설계 문서의 `firebase.json` 초안과 이 세션의 첫 구현이 함께 갖고 있던 버그다.

firebase-tools는 소스를 훑으며 **각 항목의 절대경로**를 ignore 패턴과 대조한다
(`lib/fsAsync.js` `readdirRecursive` → `minimatch(absPath, glob, {matchBase:true, dot:true})`,
`lib/deploy/functions/prepareFunctionsUpload.js:77-80`). `matchBase`는 **패턴에 `/`가 없을 때만**
동작하므로, `"src/__tests__"`는 `/home/…/daniel-tracker/src/__tests__`와 **영영 맞지 않는다.**
직접 재현해 확인했다 — `docs`·`dist` 같은 한 조각 패턴은 걸리고 `src/__tests__`만 그냥 통과했다.

증상이 없다는 것이 이 버그의 문제다: 배포는 성공하고 테스트도 초록인데 배포본에 테스트가
통째로 실린다. 게다가 이 세션의 첫 테스트는 **"목록에 그 문자열이 있는가"만** 봐서 절대 못 잡았다.

- **고친 것**: `"src/__tests__"` → `"__tests__"`(한 조각이라 matchBase가 동작하고, 디렉터리가
  걸리면 그 아래로 재귀하지 않으므로 하위까지 전부 빠진다).
- **같이 고친 것**: `.env`·`.env.<projectId>`가 제외되지 않고 있었다 — **배포 때 실제로 존재하는
  파일은 이쪽**이다(CI가 `Write functions env` step에서 만든다). 즉 "제외한 것은 배포 때 없는
  파일, 배포 때 있는 파일은 제외 안 된 것"이었다. `.env`·`.env.*`로 바꿨다.
  env 주입은 그대로다 — `loadUserEnvs`가 아카이브가 아니라 **배포 머신의 디스크에서 직접**
  읽는 것을 소스로 확인했다(`lib/functions/env.js:245-260`).
- **테스트**: 이제 firebase-tools의 매칭 규칙(패턴에 `/` 금지 + basename 대조 + 조상 디렉터리
  가지치기)을 **재현해 실제로 걸러지는지** 본다. 변이 3종(패턴 되돌리기 · `.env` 제거 ·
  `src` 통째 제외)이 전부 잡히는 것을 확인했다.
- **되돌리는 법**: `firebase.json`의 `functions[0].ignore`에서 해당 줄 삭제(그러면 테스트가 실패한다).

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

### `[자동결정]` 푸시 재구독 배너는 **새 원점에서만** 뜬다

- **왜**: 계획서 WP-5의 조건(`pushConfigured()` + 구독 없음 + 서버 reminders 켜짐)만으로는
  **현재 운영 중인 Vercel 앱에도 배너가 뜬다.** 컷오버 때 원점 배너를 띄우려면 옛 원점에도
  `VITE_NEW_ORIGIN`을 넣어야 하는데, 그 순간 푸시 배너까지 조건을 만족한다 — 알림이 멀쩡히
  오고 있는 사람에게 "알림을 다시 켜세요"라고 말하게 되고, "변수가 없으면 무변경"이라는
  병행 호환 불변식도 깨진다. 그래서 조건에 **"지금이 옛 원점이 아니다"**를 더했다.
  결과적으로 두 배너는 원점이 서로를 배제해 **동시에 뜨지 않는다**(같은 화면에서
  "여기서 나가세요"와 "여기서 켜세요"를 함께 말하지 않는다).
- **되돌리는 법**: `src/migrationBanners.js`의 `shouldShowPushBanner`에서 앞의 두 줄
  (`newOrigin`·`isOldOrigin`) 삭제.

### `[자동결정]` `fastly-client-ip`는 **Cloud Run에서만** 신뢰한다

- **왜**: 계획서 WP-2는 "`fastly-client-ip` 우선"이라고만 적었는데, 그대로 두면
  **Vercel에서 rate limit이 통째로 뚫린다.** Vercel은 그 헤더를 덮어쓰지 않으므로 공격자가
  헤더 하나로 매 요청 새 버킷을 만들 수 있고, 그러면 토큰 추측에 횟수 제한을 걸어 둔
  감사 R-39의 방어가 병행 기간의 Vercel 쪽에서만 사라진다. `K_SERVICE`(Cloud Run이 주입,
  사용자가 넣을 수 없음)가 있을 때만 Fastly 헤더를 본다.
- **되돌리는 법**: `api/_lib/security.js` `getClientIp`의 `if (process.env.K_SERVICE)` 제거.

### `[자동결정]` `hosting.headers`에 `/`를 명시하고 중괄호 확장을 쓰지 않는다

- **왜**: ① 사용자가 실제로 여는 주소는 `/`(그리고 `/?tab=…`)다. `/index.html`만 적으면
  그 규칙은 요청 경로가 `/index.html`일 때만 붙고 `/`는 Hosting 기본 캐시(1시간)로 떨어져
  **배포가 최대 1시간 늦게 잡힌다.** ② `/{a,b,c}` 중괄호 확장은 에뮬레이터에서는 동작했지만
  Hosting 공식 문서가 보장하는 glob 부분집합이 아니다 — 규칙이 조용히 안 붙으면 SW가 캐시돼
  같은 증상이 난다. 항목을 하나씩 풀어 적었다(테스트가 중괄호 재도입을 막는다).
- **되돌리는 법**: `firebase.json` `hosting.headers`를 한 줄 glob으로 되돌린다.

### `[자동결정]` `/export/diag/`(후행 슬래시)도 진단으로 인식한다

- **왜**: express는 후행 슬래시 경로도 같은 라우트로 보내는데 `req.path`가 달라
  `diag=1` 주입만 빠진다. 그러면 진단을 열려던 사람에게 "링크를 찾을 수 없음" 404 공유
  페이지가 나간다 — 원인을 찾기 가장 어려운 형태다.
- **되돌리는 법**: `functions.js`의 `req.path.replace(/\/+$/, "")`를 `req.path`로.

### `[자동결정]` `api` 그룹에도 `IMPORT_TOKEN`을 바인딩한다

- **왜**: `01 §2` 매핑표는 `import-inbox`(= `api` 그룹)의 시크릿을 `KV_REST_API_TOKEN`만으로
  적었는데, 그 핸들러가 설정 카드에 보낼 상태를
  `enabled: !!(IMPORT_TOKEN && IMPORT_UID && IMPORT_CUTOVER_DATE)`로 계산한다
  (`import-inbox.js:255,259`). 토큰을 `ingress`에만 두면 **자동 가져오기가 멀쩡히 동작하는데
  카드는 항상 "꺼짐"**이라고 말한다 — 사용자를 없는 고장으로 보내는 거짓말이다.
  최소 권한을 한 칸 넓히는 쪽이 낫다고 판단했다(그 토큰은 이 앱 자신의 값이고, `api`는
  이 앱 자신의 엔드포인트다). 나머지 `IMPORT_*`는 `.env.<project>`라 코드베이스 전체에 이미 붙는다.
- **되돌리는 법**: `functions.js`의 `API_PARAMS`와 `api`의 `secrets:`에서 `IMPORT_TOKEN` 제거
  (테스트의 기대 목록도 함께). 그때는 카드가 거짓 "꺼짐"을 표시한다는 것을 알고 하는 것이다.

### ℹ️ `firebase-admin`은 **막을 수 없고 막을 필요도 없다** — 대신 import를 막는다

`firebase-functions@7`은 `firebase-admin`을 **선택 아닌 peer**로 선언한다
(`peerDependenciesMeta`에 optional 표시가 없다) → `npm ci`가 자동 설치하므로 `node_modules`와
lockfile에 존재한다. 설치 자체는 피할 수 없다.

그런데 01 §1 원칙 2("서버는 Firestore 자격증명을 갖지 않는다")가 실제로 요구하는 것은
"설치되지 않았다"가 아니라 **"아무도 import 하지 않는다"**이다. 배포된 함수에는 런타임
서비스 계정의 ADC가 붙어 있어, 누가 한 줄 `import "firebase-admin"`을 넣는 순간 서버가
Firestore를 직접 쓸 수 있게 되고 "day 문서를 쓰는 주체는 앱 하나"라는 구조가 조용히 무너진다.

그래서 `firebase-config.test.js`가 **소스 전체를 스캔해** `firebase-admin` 문자열이
`api/`·`src/`(테스트 제외)·`functions.js`·`scripts/` 어디에도 없음을 단언한다.
직접 의존성 금지 단언은 그대로 두되, 진짜 방벽은 이 스캔이다.

### `[자동결정]` `/export/view/*`를 라우터에 추가한다 (firebase.json은 건드리지 않는다)

- **왜**: Hosting의 `/export/view/**`는 **여러 세그먼트**를 먹는데 express의 `:t`는 한 조각만
  받는다. 그 차이만큼(`/export/view/<t>/뭔가`)이 라우터 catch-all로 떨어져, 공유 뷰의
  `no-store`·`noindex` 헤더가 없는 맨 JSON 404가 나갔다. 실물 핸들러가 받게 하면 자기 규칙
  (`isValidToken`)으로 판단해 늘 같은 404 페이지를 준다.
- **왜 `firebase.json`을 안 고쳤나**: 폭을 맞추려면 `/export/view/*`(단일 세그먼트)로 좁히는
  방법도 있지만, 그 rewrite는 **이 이전에서 가장 먼저 지켜야 하는 경로**(AI 공유 링크)다.
  실제 Hosting에서 `*`의 의미를 실측하지 않은 채 좁히는 쪽이 훨씬 위험하다 — 라우터 한 줄로
  같은 결과를 얻을 수 있으면 그쪽을 택한다.
- **되돌리는 법**: `functions.js`의 라우트 배열에서 `"/export/view/*"` 제거.

### `[자동결정]` `firebase-tools`를 **정확한 버전**으로 고정한다 (`@15` → `@15.29.0`)

- **왜**: `deploy.yml`은 배포 자격증명이 환경에 노출된 상태에서 `npx -y`로 패키지를 받아
  실행한다. `@15`는 major 범위라 매 실행이 새 코드를 당길 수 있다. 설계 문서(03 §6 메모)도
  "재현성"을 이유로 고정을 요구했고, devDependency는 금지(SessionStart 훅의 `npm ci`가
  느려짐)이므로 남은 방법은 정확한 버전 지정이다. 15.29.0은 이 세션이 실제로 돌려 본 버전이다.
- **되돌리는 법**: 세 자리(`package.json`의 `test:emu`, `preview.yml`, `deploy.yml`)에서
  `@15.29.0`을 `@15`로. 버전을 올릴 때도 같은 세 자리를 함께 고친다.

### ℹ️ 남겨 둔 것 (고치지 않기로 한 지적)

| 지적 | 왜 안 고쳤나 |
|---|---|
| `KV_REST_API_URL` 미설정이면 rate limit이 조용히 전면 해제되고 배포는 성공한다 | **기존 동작이다**(`security.js`의 fail-open — 가용성 우선). 이전이 만든 문제가 아니다. 다만 Vercel에서는 Upstash 통합이 값을 자동 주입했고 Firebase에서는 **사람이 GitHub Variable로 넣어야** 해서 잊기 쉬워졌다 → §4.1 A8과 아래 확인 절차에 넣었다. fail-closed로 바꾸는 것은 앱을 세울 수 있는 변경이라 이 PR의 범위 밖 |
| `ci.yml`이 `push`·`pull_request` 양쪽에 걸려 PR마다 두 번 돈다 | 이 저장소의 **기존 트리거 설정**이다. 이 PR은 job 하나를 더했을 뿐이고, 메인 게이트의 트리거 의미를 사람 확인 없이 바꾸지 않는다. 비용은 job 하나 ≈ 1분 |

> **배포 직후 확인**: `curl https://<도메인>/export/diag`의 `shareEnabled`가 `false`면
> KV가 안 붙은 것이다 — rate limit·사서함·푸시 구독·공유 링크가 전부 조용히 꺼진 상태다.
> 이 한 줄이 위 표 첫 행을 눈에 보이게 만드는 장치다.

## 3. 이 샌드박스에서 막혔다가 **CI에서 해소된 것** (`BLOCKED` → 해소)

> 세션 규칙 §0.2의 `BLOCKED`로 시작했으나 CI 실행으로 풀렸다. 남은 `BLOCKED`는 없다.

### ✅ Hosting 경유 스모크 — 샌드박스에서는 프록시가 막았고, CI에서는 돌았다

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
- **해소**: CI의 `emulator-smoke` job이 이 PR에서 실제로 돌았고 **Hosting 경유 경로가 동작했다**.
  첫 실행 12건 중 11건 통과 · 1건은 위 §1의 에뮬레이터 전용 OPTIONS 차이(코드 문제 아님)라
  테스트를 고쳤다. CI 로그에서 확인된 것:

  ```
  [hosting] Rewriting /api/health-import → ingress   "POST /api/health-import" 503
  [hosting] Rewriting /api/body-import   → ingress   "POST /api/body-import"   503
  [hosting] Rewriting /api/analyze-food  → api       "POST /api/analyze-food"  403
  [hosting] Rewriting /export/view/<32hex> → exportView   404
  [hosting] Rewriting /export/diag       → exportView     200
  "GET /nonexistent-page" 200  (SPA fallback)   ·  "GET /sw.js" 200
  ```

  즉 **이 샌드박스에서 막힌 것은 세션의 프록시뿐**이었고, 실제 Hosting rewrite → 함수 프록시는
  정상이다.

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

> ⚠️ **`staging` Environment에 아래 셋을 반드시 스테이징 값으로 넣는다.** 비워 두면 저장소
> 변수(= prod 값)로 떨어진다:
> - `KV_REST_API_URL` — 프리뷰가 **실데이터 사서함·푸시 구독**을 두드린다
> - `IMPORT_UID` — 수신분이 실제 사용자에게 귀속된다
> - `PRODUCTION_ORIGIN` — 스테이징 함수가 **프로덕션 원점을 신뢰**하게 된다
>   (프로덕션 페이지에서 스테이징 API를 부를 수 있게 되는 형태)

**`FIREBASE_PROJECT_PROD`·`FIREBASE_PROJECT_STAGING`이 비어 있으면 배포 job은 통째로 skip된다**
(빨간불이 아니라 회색). 즉 이 PR을 머지해도 변수를 넣기 전까지는 아무것도 배포되지 않는다.
반면 `ci.yml`의 `emulator-smoke` job은 자격증명이 필요 없어 **지금 바로 돈다**.

### 4.3 컷오버 당일 (02 Phase B) — **순서 엄수**

| # | 작업 | 확인 |
|---|---|---|
| B1 | **Vercel 크론 비활성**(또는 `vercel.json`의 `crons` 제거 배포) — Scheduler 잡 생성보다 **먼저**. 안 그러면 밤 8시 푸시가 2번 간다 | Vercel Cron 탭이 비어 있음 |
| B2 | main 머지 → CI가 Hosting(live) + Functions(prod) 배포. Scheduler 잡 자동 생성 | `firebase functions:list` · Scheduler 콘솔에 잡 1개 |
| B3 | 배포 후 스모크 — `deploy.yml`이 자동으로 돈다(`PROD_HOSTNAME` 변수 필요) | job 초록불 |
| B4 | 새 도메인에서 **Google 로그인** → 홈 목표 K가 옛 앱과 같은지 · 설정의 자동 가져오기 카드에 수신 로그가 보이는지(같은 KV) | 화면. 실패하면 A5(승인 도메인)·A6(App Check)·A7(OAuth URI) 재확인 |
| B5 | 단축어 2개(운동·체성분)의 POST URL을 새 도메인으로 교체 → 수동 실행 | 단축어 알림 "N건 추가" 또는 "중복 N 무시" + 앱 수신 로그 |
| B6 | **옛 앱 로그아웃 → 새 앱에서 알림 켜기** (순서 반대면 옛 앱의 로그아웃이 방금 만든 새 구독을 지운다) | 당일 밤 8시 푸시 도착으로 확인 |
| B7 | 새 도메인에서 공유 링크 발급 → **Claude 웹에서 실제 열람** | 리더가 본문을 읽음 |
| B8 | 홈 화면에 새 앱 추가 · **옛 앱은 병행 기간 끝까지 보존**(롤백용) | |
| B9 | **밤 8시: 푸시 1회 도착 확인** · Cloud Logging에서 `cronReminders`의 `sent` 값 확인 | 미도착이면 Scheduler 실행 이력(403이면 invoker IAM) · `VAPID_*` 시크릿 바인딩 |

> B9가 이 이전의 마지막 미검증 항목이다 — 크론은 하루 한 번만 돌아 배포 직후에 확인할 수 없다.
> `cronReminders`는 Hosting을 거치지 않고 IAM(스케줄러 SA의 invoker)만으로 보호되므로,
> 스모크로 대신 확인할 방법이 없다. 반드시 당일 밤에 사람이 확인한다.

### 4.4 병행 기간 · 종료 전 (02 Phase C)

| # | 작업 |
|---|---|
| C1 | 매일: Cloud Logging 오류 0 · 예산 알림 없음 · 앱의 자동 수신 로그 정상 |
| C2 | T+7: 옛 원점에서 발급한 공유 링크가 전부 만료됐는지(최대 TTL 7일) |
| C3 | 지인(멤버)에게 새 주소 안내 · 옛 앱 삭제 요청 |
| C4 | **Upstash 소유권 확인**(DR-14) — Vercel Marketplace 통합이면 통합 삭제가 DB 삭제로 이어질 수 있다. 확인 전에는 Vercel 프로젝트를 지우지 않는다 |
| C5 | 문서 URL 일괄 갱신(`docs/hae-setup.md` 등) — 도메인이 정해진 뒤 |
| C6 | **DR-2 리전 실측** — 설계는 "스테이징 실측으로 결정(기본 후보 서울)"이었고, 코드에는 기본값 `asia-northeast3`가 들어가 있다. 실측을 아직 안 했으므로 과제로 남긴다: staging에 서울/타이완 두 리전으로 `api`를 배포해 서울 폰에서 `import-inbox` pull p50/p95를 각 20회 비교. 바꾸려면 `functions.js`의 `FUNCTIONS_REGION` 한 곳만 고치면 되고(테스트가 `firebase.json`과의 일치를 강제한다), 재배포로 URL·Scheduler 잡이 새로 만들어진다 |

### 4.5 이 세션이 하지 않은 것 (금지 목록)

`firebase deploy`/`login` · 시크릿 값 생성·기록 · `firestore.rules` 변경 · `vercel.json` 변경 ·
`src/utils.js` 상수 · `src/store.js`의 `getAllData` 개선 · `firebase-tools`를 devDependency로 추가 ·
docs 속 `vercel.app` URL 일괄 치환 · 인바디 코드 제거.
