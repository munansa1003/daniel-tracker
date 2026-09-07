# 03 — CI/배포 설계 + 결정 요청(DR) 목록

> 작성 2026-09-07 · 기준 커밋 main `aca23a2` · **코드·워크플로 변경 없음**(YAML은 이 문서의 코드블록으로만).
> 출처 등급은 `01-firebase-plan.md §0`. 기존 게이트(`.github/workflows/ci.yml`: eslint src api → vitest)는 **그대로 두고** 옆에 워크플로 2개를 추가하는 설계다.

## 1. 트리거와 파이프라인

| 이벤트 | 워크플로 | 단계 | 비고 |
|---|---|---|---|
| `push` · `pull_request` | `ci.yml`(기존, 무변경) | `npm ci` → `eslint src api --max-warnings=0` → `vitest run` | Node 20 → **22로 상향 권고**(런타임과 동일 메이저, 01 §6.3). 변경은 구현 세션 |
| `pull_request`(opened/synchronize) | `preview.yml`(신규) | ① 게이트 재실행(또는 `ci.yml` 완료 대기 `workflow_run`) ② 에뮬레이터 스모크(Java 21, `emulators:exec --project demo-bodyplan`) ③ `vite build`(staging `VITE_*`) ④ **staging 프로젝트**에 `firebase deploy --only functions` ⑤ `firebase hosting:channel:deploy pr-<번호> --expires 7d`(staging) ⑥ PR 코멘트에 채널 URL | 프리뷰 채널의 rewrite는 그 프로젝트의 **live 함수**를 호출한다(`pinTag` 없으면) [스니펫] → 채널을 staging 프로젝트에 만들어야 prod 함수를 건드리지 않는다 |
| `push` to `main` | `deploy.yml`(신규) | ① 게이트 ② `vite build`(prod `VITE_*`) ③ `firebase deploy --only hosting,functions --project prod` ④ 배포 후 스모크(`curl` 3종, 02 런북 B3) | 규칙(`firestore.rules`)은 CI 배포 **제외**(사람이 콘솔 게시 — 01 §10) |
| 수동 `workflow_dispatch` | `deploy.yml` | 같은 단계, `--project` 선택 | 롤백(이전 커밋 재배포)용 |

**staging 함수는 PR마다 덮어써진다**(1인 팀 전제). 동시에 PR 둘을 검증할 땐 나중 배포가 이긴다 — 제약으로 명시.

## 2. 프리뷰 채널 원점 문제 — 3안 비교

채널 주소는 `<project>--<channelId>-<hash>.web.app`로 **매번 다른 호스트**다(같은 channelId를 재사용하면 만료 전까지 같은 URL).
그 원점에서 ① Google 로그인 ② App Check ③ `checkOrigin`이 동작해야 프리뷰가 쓸모 있다(앱은 로그인 전엔 로그인 화면뿐).

| 안 | 내용 | 로그인 | App Check | `checkOrigin` | 운영 부담 | 평가 |
|---|---|---|---|---|---|---|
| **A. 고정 스테이징 도메인에서만 로그인 검증** | 프리뷰 채널은 정적·`curl` 스모크만. 로그인이 필요한 검증은 staging **live**(`<staging>.web.app`, 고정)에서 — PR을 staging live에 배포 | staging live만 승인 도메인 등록 1회 | reCAPTCHA 키 도메인 1회 | `PRODUCTION_ORIGIN`에 고정 도메인 1회 | 최소 | PR별 격리는 없음(live 하나를 돌려 씀) |
| **B. 채널별 등록** | 채널 URL을 Auth 승인 도메인·reCAPTCHA 도메인·`PRODUCTION_ORIGIN`에 매번 등록 | CLI가 **자동 등록**(`hosting:channel:deploy`의 `authorizedDomains` 기본 켜짐 → `syncAuthState`, `lib/commands/hosting-channel-deploy.js:101-105` + `lib/hosting/api.js:214-224` [코드]; 배포 SA에 `roles/firebaseauth.admin` 필요). GitHub Action 경로에선 누락 사례 보고 [스니펫] | reCAPTCHA 도메인은 **수동**[사람] — 또는 App Check **디버그 토큰**을 프리뷰 빌드에만 주입(`self.FIREBASE_APPCHECK_DEBUG_TOKEN`, [스니펫] `https://firebase.google.com/docs/app-check/web/debug-provider`) | `PRODUCTION_ORIGIN`은 함수 env라 채널마다 재배포 → 비현실적. 대신 staging 함수의 허용 목록에 **`*.web.app` 접미사 규칙**을 추가하는 코드 변경(구현 세션, staging 전용 플래그) | PR마다 사람 손 | 격리 최상, 부담 최대 |
| **C. 우회(스테이징 전용 완화)** | staging 프로젝트에서 ① Auth 도메인은 CLI 자동 등록에 맡김 ② **규칙에서 App Check 미강제**(staging 규칙만) + reCAPTCHA 미설정(`VITE_RECAPTCHA_SITE_KEY` 빈값 → 코드가 App Check를 끔 `src/firebase.js:26-37`) ③ staging 함수는 `PRODUCTION_ORIGIN`에 `https://<staging>.web.app`만 두고 채널 호스트는 `Origin`이 `https://<staging>--*.web.app` 패턴이면 허용(코드 변경 1곳, staging 플래그) | 자동 | 없음(staging 한정) | 패턴 허용 | PR마다 0 | 격리·자동화 균형. **prod 경로는 손대지 않음** |

**추천: C(프리뷰 채널) + A(릴리스 전 최종 확인은 staging live)**. B는 채널마다 [사람] 작업이 생겨 1인 운영에서 지속되지 않는다.
C의 코드 변경은 `security.js`의 허용 목록에 "`PREVIEW_ORIGIN_SUFFIX`가 설정된 경우에만 접미사 일치 허용" 한 줄이며 **prod에는 그 env를 두지 않는다**.
DR-12(authDomain = 커스텀 도메인)를 채택하면 프리뷰에서 redirect 로그인은 크로스 도메인이 되므로 popup만 검증 대상(iOS PWA redirect는 staging live에서).

## 3. 빌드타임 `VITE_*` 주입 — Variables vs Secrets

| 변수 | 성격 | 저장 | 이유 |
|---|---|---|---|
| `VITE_RECAPTCHA_SITE_KEY` | 공개(번들에 그대로 실림) | GitHub **Variables**(Environment 단위: `staging`·`production`) | Secrets에 넣으면 로그 마스킹만 될 뿐 번들에는 어차피 노출 — 오히려 값 확인이 불편 |
| `VITE_VAPID_PUBLIC_KEY` | 공개키 | Variables | 서버 쪽 사본은 `functions` `.env.<project>`(01 §5) |
| `VITE_OWNER_EMAIL` | 공개(선택) | Variables | 규칙과 동기 |

주입 방식: 워크플로 `jobs.<job>.environment: production` + `env: { VITE_…: ${{ vars.VITE_… }} }` → `vite build`가 `import.meta.env.VITE_*`로 번들에 굽는다.
로컬 개발은 기존 `.env`(gitignore) 그대로.

## 4. GitHub Secrets/Variables 이름 목록 (값 없음) · 서비스 계정 최소 권한

### 4.1 이름 목록

| 종류 | 이름 | 용도 | 비고 |
|---|---|---|---|
| Secret | `GCP_WIF_PROVIDER` | Workload Identity Federation 제공자 리소스 이름 | DR-13 A안. 비밀은 아니나 Secret에 두어 로그 노출 최소화 |
| Secret | `GCP_DEPLOY_SA_EMAIL` | 배포 SA 이메일 | 위와 동일 |
| Secret(대안) | `FIREBASE_SERVICE_ACCOUNT_PROD` · `FIREBASE_SERVICE_ACCOUNT_STAGING` | SA 키 JSON | DR-13 B안(키 파일). `firebase init hosting:github`의 관행 이름 |
| Secret(선택) | `APPCHECK_DEBUG_TOKEN_STAGING` | 프리뷰 빌드 App Check 디버그 토큰 | §2 B안 채택 시에만 |
| Variable | `FIREBASE_PROJECT_PROD` · `FIREBASE_PROJECT_STAGING` | 프로젝트 ID | `.firebaserc`와 중복이나 워크플로 가독성 |
| Variable(환경별) | `VITE_RECAPTCHA_SITE_KEY` · `VITE_VAPID_PUBLIC_KEY` · `VITE_OWNER_EMAIL` | §3 | |
| 내장 | `GITHUB_TOKEN` | PR 코멘트 | `permissions: pull-requests: write` |

**함수 런타임 시크릿(`ANTHROPIC_API_KEY` 등)은 GitHub에 두지 않는다** — Secret Manager에만(§5 A안).

### 4.2 배포 서비스 계정 역할 (최소 권한 시도안)

| 역할 ID | 필요한 이유 | 출처 |
|---|---|---|
| `roles/firebasehosting.admin` | Hosting 배포·채널 생성 | [코드] `lib/init/features/hosting/github.js:370-377` · `lib/gcp/resourceManager.js:16-23`(`firebase init hosting:github`가 부여하는 6종) |
| `roles/firebaseauth.admin` | 프리뷰 채널 URL을 Auth 승인 도메인에 자동 등록 | [코드] 같은 목록 + `hosting-channel-deploy.js:101-105` |
| `roles/serviceusage.apiKeysViewer` · `roles/serviceusage.serviceUsageConsumer` · `roles/run.viewer` | 같은 목록(웹 앱 설정 조회·API 사용) | [코드] |
| `roles/cloudfunctions.developer` | 함수 생성·갱신 | [코드] 같은 목록. 공식 문서는 "Cloud Functions Admin + Service Account User" [스니펫] `https://firebase.google.com/docs/projects/iam/permissions` |
| `roles/iam.serviceAccountUser`(런타임 SA에 대해) | 배포 시 `iam.serviceAccounts.ActAs` 검사(`lib/deploy/functions/checkIam.js:43` [코드]) | [코드] |
| `cloudfunctions.functions.setIamPolicy` 권한 | 새 HTTPS 함수의 공개 invoker 설정 검사(`checkIam.js:22,78` [코드]) — `developer`에 포함되는지 [미확인] → 없으면 `roles/cloudfunctions.admin` | [코드]/[미확인] |
| `roles/run.admin` | v2는 Cloud Run 서비스 invoker 설정(`fabricator.js:465-508` `run.setInvokerCreate` [코드]) | [코드]/역할명 매핑은 [미확인] |
| `roles/cloudscheduler.admin` | `onSchedule` 잡 생성(`lib/gcp/cloudscheduler.js` [코드]) | 역할명 [스니펫] |
| `roles/secretmanager.admin`(또는 사전 수동 부여) | 런타임 SA에 `roles/secretmanager.secretAccessor` 바인딩을 CLI가 `ensureServiceAgentRole`로 부여(`lib/deploy/functions/ensure.js:110-119` [코드]) → 바인딩 권한 필요. **대안: 운영자가 콘솔에서 1회 부여하면 배포 SA엔 불필요** | [코드] |
| `roles/artifactregistry.admin`(또는 `.writer` + 정리 정책 수동) | 이미지 저장소·정리 정책(`lib/functions/artifacts.js:73` 메시지 [코드]) | [코드] |
| Cloud Build 관련(`roles/cloudbuild.builds.editor`) | 함수 빌드 | [미확인] |
| API 활성화(`serviceusage.services.enable`) | CLI가 12개 API를 켜려 시도(`lib/deploy/functions/prepare.js:603-613` [코드]) → **운영자가 콘솔에서 미리 켜 두면 배포 SA에 불필요** | [코드] |

**권고**: 1차 배포는 운영자 계정(Owner)으로 로컬에서 수행해 API 활성화·시크릿 바인딩·아티팩트 정책을 만들고, 그 뒤 CI SA는 위 표의 굵은 최소 집합으로 시작해 실패하는 권한만 추가한다. 정확한 최소 집합은 **[미확인]**이며 실측으로 확정한다.

## 5. 시크릿을 Secret Manager에 넣는 경로 — 2안 (DR-7)

| 안 | 흐름 | 장점 | 단점 |
|---|---|---|---|
| **A. 운영자 수동(콘솔 또는 로컬 CLI `firebase functions:secrets:set NAME --project …`)** | 값은 Secret Manager에만 존재. CI는 접근 권한 없음 | 값 저장소 1곳 · 배포 SA 권한 최소 · GitHub 침해 시 서버 시크릿 무영향 | 값 교체가 [사람] 작업(연 1~2회) |
| B. CI가 GitHub Secrets에서 `functions:secrets:set` | 매 배포 또는 수동 dispatch로 동기화 | 코드형 관리 | 값이 GitHub·Secret Manager 두 곳 · 배포 SA에 `secretmanager.admin` · `set`마다 새 버전 생성(6개 무료 초과 → `secrets:prune` 필요, `lib/commands/functions-secrets-prune.js` [코드]) |

**추천 A.** `functions:secrets:*` 명령 5종(`set`·`access`·`describe`·`destroy`·`prune`, `lib/commands/functions-secrets-*.js` [코드])은 로컬에서 운영자가 쓴다.

## 6. 워크플로 YAML 초안 (문서 안 코드블록 — 파일 생성 금지)

### 6.1 `preview.yml` (PR → 게이트 + 에뮬레이터 스모크 + staging 함수 + 프리뷰 채널)

```yaml
# .github/workflows/preview.yml — 초안. 구현 세션에서 파일로 옮긴다.
name: Preview (staging)
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  id-token: write        # WIF (DR-13 A안)
  pull-requests: write   # 채널 URL 코멘트
concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  preview:
    runs-on: ubuntu-latest
    environment: staging
    env:
      VITE_RECAPTCHA_SITE_KEY: ${{ vars.VITE_RECAPTCHA_SITE_KEY }}   # staging은 비워 App Check 끔(§2 C안)
      VITE_VAPID_PUBLIC_KEY: ${{ vars.VITE_VAPID_PUBLIC_KEY }}
      VITE_OWNER_EMAIL: ${{ vars.VITE_OWNER_EMAIL }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "21" }          # 에뮬레이터 최소 Java 21 [코드]
      - run: npm ci
      # 게이트(ci.yml과 동일 — 여기서도 한 번 더 돌려 배포 직전 상태를 보장)
      - run: npx eslint src api --max-warnings=0
      - run: npx vitest run
      # 에뮬레이터 스모크: Hosting rewrite → 함수, 경로형 공유 뷰, 비JSON 본문
      - run: npx firebase-tools@15 emulators:exec --project demo-bodyplan --only functions,hosting "npx vitest run --config vitest.emu.config.js"
      - run: npm run build
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SA_EMAIL }}
          create_credentials_file: true
          export_environment_variables: true    # GOOGLE_APPLICATION_CREDENTIALS → firebase-tools가 사용 [코드 requireAuth.js:85]
      - name: Deploy functions (staging)
        run: npx firebase-tools@15 deploy --only functions --project ${{ vars.FIREBASE_PROJECT_STAGING }} --force --non-interactive
      - name: Deploy preview channel (staging)
        id: channel
        run: |
          npx firebase-tools@15 hosting:channel:deploy pr-${{ github.event.pull_request.number }} \
            --project ${{ vars.FIREBASE_PROJECT_STAGING }} --expires 7d --json > channel.json   # DR-10
          echo "url=$(node -e "const j=require('./channel.json');console.log(Object.values(j.result)[0].url)")" >> "$GITHUB_OUTPUT"
      - name: Smoke (curl)
        run: |
          U="${{ steps.channel.outputs.url }}"
          curl -sfI "$U/" | head -1
          test "$(curl -s -o /dev/null -w '%{http_code}' "$U/export/view/00000000000000000000000000000000")" = "404"
          test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$U/api/health-import" -H 'X-Import-Token: wrong' -d '{}')" = "401"
      - uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({ ...context.repo, issue_number: context.issue.number,
              body: `프리뷰(staging): ${{ steps.channel.outputs.url }} (7일 후 만료)` })
```

### 6.2 `deploy.yml` (main push → 프로덕션 hosting+functions)

```yaml
# .github/workflows/deploy.yml — 초안
name: Deploy (production)
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  id-token: write
concurrency: { group: deploy-prod, cancel-in-progress: false }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production        # Environment 보호 규칙(승인자 1명)을 걸 수 있음
    env:
      VITE_RECAPTCHA_SITE_KEY: ${{ vars.VITE_RECAPTCHA_SITE_KEY }}
      VITE_VAPID_PUBLIC_KEY: ${{ vars.VITE_VAPID_PUBLIC_KEY }}
      VITE_OWNER_EMAIL: ${{ vars.VITE_OWNER_EMAIL }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - run: npx eslint src api --max-warnings=0
      - run: npx vitest run
      - run: npm run build
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SA_EMAIL }}
          create_credentials_file: true
          export_environment_variables: true
      - name: Deploy hosting + functions (prod)
        run: npx firebase-tools@15 deploy --only hosting,functions --project ${{ vars.FIREBASE_PROJECT_PROD }} --force --non-interactive
      - name: Post-deploy smoke
        run: |
          U="https://${{ vars.PROD_HOSTNAME }}"
          curl -sfI "$U/" | head -1
          test "$(curl -s -o /dev/null -w '%{http_code}' "$U/export/view/00000000000000000000000000000000")" = "404"
          curl -sf "$U/export/diag" | grep -q '"route":"export-view"'
```

메모: `firebase-tools`는 `npx …@15`로 고정하거나 devDependency로 lockfile에 넣는다(재현성; 훅·게이트에는 무영향). `FIREBASE_TOKEN`·`login:ci`는 **deprecated**(`lib/requireAuth.js:87-89`, `lib/commands/login-ci.js:17` [코드]) — 쓰지 않는다.
`--only hosting,functions`는 규칙·인덱스를 건드리지 않는다.

## 7. Vercel 병행 기간의 이중 배포 정책 (DR-8)

| 기간 | Vercel | Firebase | 규칙 |
|---|---|---|---|
| 구현 PR 머지 전 | Git 통합 자동 배포 유지(현행) | 프리뷰/staging만 | 프로덕션 코드 무변경 |
| 컷오버 ~ 병행 종료 | **자동 배포 유지**(main이 두 곳에 같은 코드로 감) — 단 `vercel.json` crons는 컷오버 당일 제거(02 B1) | `deploy.yml` | 병행 중 코드는 **양쪽 호환**이어야 함: env 이름 변경(`FIREBASE_WEB_API_KEY`→새 이름)은 코드가 두 이름을 다 읽게, `VERCEL_*` 진단은 없으면 `unknown` |
| 병행 종료 | Git 통합 해제 → (Upstash 소유권 확인 후) 프로젝트 삭제 | 단독 | 02 C4 |

## 8. 결정 요청(DR) 목록

각 항목: 안 · 추천 · 근거 · 미룰 수 있는지. **DR-13·14는 이 세션이 발견한 추가 항목**.

| DR | 안 | 추천 | 근거 | 미룰 수 있나 |
|---|---|---|---|---|
| **DR-1 커스텀 도메인** | 요건만: ① 등록기관에서 A/AAAA·TXT 편집 가능 ② TTL 300s 설정 가능 ③ `www` 불요(apex 1개) ④ 상표·법무 검토는 별도 세션 | 이름은 Daniel 결정. **컷오버 전 SSL 발급(≤24h) 여유 확보** | 02 #1·#8·#9·#10 전부 도메인 확정 후 가능 | **아니오** — 원점을 한 번만 바꾸려면 첫 배포 전에 필요 |
| **DR-2 리전** | A `asia-northeast3`(서울, Tier 2 [스니펫]) · B `asia-northeast1`(도쿄, Tier 1) · C `us-central1` | **A** | 현 `icn1`과 동등한 지연, 인바디 재개 시 국내 리전 유지. 비용 차이는 이 규모에서 월 수십 센트(01 §9). rewrite `region` 명시로 Hosting 제약 없음(01 §3.2) | 아니오(함수 리전은 재배포로 바꿀 수 있으나 URL·잡이 바뀜) |
| **DR-3 함수 패키지 구조** | A 분리+원본 참조(불가) · **B 루트 공용** · C 분리+esbuild 번들 | **B**, 배포 시간이 문제면 C | 방어선(훅·CI·517 테스트)이 원본 파일을 보므로 배포본=검증본. 01 §6.2 | 예(B→C 전환은 코드 이동 없이 빌드 스크립트 추가) |
| **DR-4 Node 런타임** | `nodejs20`(폐기 2026-10-30) · **`nodejs22`** · `nodejs24` | **22** | 20은 6주 뒤 폐기 [코드]. 22 = 클라우드 세션 버전. CI도 22로 | 아니오 |
| **DR-5 스테이징 프로젝트** | A 도입(Blaze, 예산 $5) · B 미도입(프리뷰 채널이 prod 함수 호출) | **A** | B는 프리뷰가 prod KV·prod 함수를 두드림(단축어 토큰·사서함 오염 위험) | 예(1차 컷오버는 A 없이도 가능하나 §1의 PR 파이프라인이 성립하지 않음) |
| **DR-6 인바디 직수신 봉인 방식** | A 플래그(시크릿 미생성 = `off`, 코드 유지) · B 코드 제거 · C 시크릿 생성해 활성 | **A** | 코드는 감사로 검증된 자산(계정 잠금 방어 3중). 값 부재만으로 완전 off(`import-inbox.js:94`). B는 되돌리기 비용, C는 사고 반경(계정 자격증명) | 예 |
| **DR-7 시크릿 주입 경로** | **A 운영자 수동** · B CI `functions:secrets:set` | **A** | §5 | 예 |
| **DR-8 Vercel 병행 기간** | A 7일 · **B 14일** · C 30일 | **B** | 공유 링크 최대 TTL 7일 소멸 + 푸시·단축어 1주 관찰. 30일은 Hobby 약관상 상용 전환 시점과 겹칠 수 있음 | 예(연장은 언제든) |
| **DR-9 푸시 재구독 UX** | A 설정에서 수동 켜기(안내만) · **B 새 원점 첫 로그인 시 배너 "알림 다시 켜기"(서버 `push:state.reminders`로 이전에 켰던 사용자만)** · C 자동 시도(불가 — 권한은 사용자 제스처 필요) | **B** | 02 #4. 배너는 `pushConfigured() && !getSubscription()` 조건. 옛 앱 로그아웃 순서 안내 포함 | 예(A로 시작 가능) |
| **DR-10 프리뷰 채널 만료** | 3d · **7d(기본)** · 30d(최대) | **7d** | 기본값 7d·최대 30d(`lib/hosting/expireUtils.js:18-19` [코드]). 재배포 시 자동 연장 [스니펫] | 예 |
| **DR-11 함수 분할** | A 11개 · B 라우터 1개 · **C 그룹 4개** | **C** | 01 §7 | 예(그룹 경계는 라우터 배선만) |
| **DR-12 `authDomain`·로그인** | A 현행(`firebaseapp.com`, popup 우선 + redirect 폴백) · **B `authDomain` = 커스텀 도메인(Option 1) + OAuth 리디렉션 URI 등록** · C popup 전용(redirect 폴백 제거) | **B** | iOS PWA의 redirect 폴백이 서드파티 저장소 차단에서 실패하는 문제를 Hosting이 구조적으로 해결 [스니펫]. 프리뷰 채널에서는 크로스 도메인이라 popup만 검증 | 예(A로 컷오버 후 B 적용 가능 — 코드 1줄 + 콘솔 2곳) |
| **DR-13 CI 인증(추가)** | **A WIF(키 없음)** · B SA 키 JSON(GitHub Secret) | **A** | `FIREBASE_TOKEN`·`login:ci` deprecated [코드]; ADC 경유 `GOOGLE_APPLICATION_CREDENTIALS`를 CLI가 권장(`requireAuth.js:85`) [코드]; WIF는 `google-github-actions/auth`가 그 변수를 내보냄 [스니펫] | 예(B로 시작해 A로 전환 가능) |
| **DR-14 Upstash KV 소유권(추가)** | A 현 DB가 Vercel Marketplace 통합이면 **Upstash 직접 계정으로 신규 DB 생성 후 키 이관(수동 복사 스크립트)** · B 통합 유지(Vercel 프로젝트를 영구 보존) · C 통합 아님이면 조치 불요 | **먼저 [콘솔]에서 확인** → 통합이면 A | 통합 삭제 = DB 삭제 가능성 [스니펫]. `import:seen`(영구 도장)·`push:sub`·`share:*` 유실은 이중 계상·알림 중단으로 이어짐 | 아니오(병행 종료 전 필수) |

## 9. 자기 검증 결과 (2026-09-07, 이 세션 실행)

| 항목 | 결과 |
|---|---|
| 함수 매핑 11행 = `ls api/*.js` | 11 = 11 ✓ (analyze-body · analyze-exercise · analyze-food · body-import · cron-reminders · export-view · health-import · import-inbox · push-sync · share-create · share-revoke) |
| 시크릿 표 = `.env.example` ∪ `grep -rn "process.env\|import.meta.env" api src vite.config.js` | 코드에서 읽는 이름 29종(Vercel 자동 5종 · `UPSTASH_*` 대체 2종 · Vite 내장 `DEV`/`PROD` 포함) 전부 01 §5 표에 있음 ✓. `.env.example` 22종 중 코드에 없는 것 0 ✓ (스크립트로 대조) |
| rewrites 3개 매핑 + `:t` 경로 파싱 요구 | 01 §3.1 세 행 ✓ · "Firebase는 `:t`를 쿼리로 바꿔주지 않는다" 명시 ✓ · `req.url` 마운트 함정(01 §3.3) ✓ |
| 원점 소비처 grep 근거 | 02 §1 각 행에 파일:라인 — `grep -rln "vercel.app\|VERCEL_URL\|location.origin\|window.location\|pushManager\|start_url\|authDomain" src api public vite.config.js index.html docs README.md` 결과 15개 파일 전부 표에 포함 ✓ (`LoginScreen.jsx`·`offline.html`은 원점 무관으로 #26·#27에 기록) |
| 외부 사실 출처 | 한도·요금·역할명·rewrite 리전·authDomain 요건 전부 [코드]/[스니펫]/[미확인] 등급 + URL ✓. **원문 페이지 열람은 네트워크 정책으로 불가** — [스니펫] 항목은 구현 세션에서 재확인 |
| `npx eslint src api --max-warnings=0` | 통과(exit 0) ✓ |
| `npx vitest run` | **517/517 통과, exit 1** — `bulk-delete-ui.test.jsx` 실행 중 `alert is not a function` unhandled rejection 1건(`src/App.jsx:643`, happy-dom에 `alert` 없음). 3회 재현(결정적). GitHub CI(Node 20) main 최근 5회 녹색 → **이 환경(Node 22)의 기존 상태**이며 문서 변경과 무관. `src/` 변경 금지라 수정하지 않음 → 구현 세션 첫 작업으로 권고 |
| `vite build` | 통과. `dist/` 1.4MB, precache 17개 ✓ |
| 시크릿 값 부재 | 세 문서에서 API 키·토큰·PEM 형태 문자열 검색 0건 ✓ (Firebase 웹 API 키 문자열도 문서에 싣지 않음. 이름만 기재) |
| 금지 사항 | `src/` `api/` `firestore.rules` `vite.config.js` `vercel.json` `package.json` `.github/` 무변경 · `.github/workflows/` 파일 미생성 · firebase CLI 미설치·미실행 ✓ (`git status`로 확인) |
