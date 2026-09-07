# Daniel Tracker (Body Plan) — 식단·운동·체성분 관리 웹앱

스마트폰 홈 화면에서 앱처럼 사용할 수 있는 **PWA(Progressive Web App)**입니다.
**Firebase Firestore로 여러 기기 간 데이터가 동기화**되며, **AI(Claude)**가 음식·운동·체성분을 분석해 줍니다.
오프라인에서도 앱 화면이 로드되고, 로컬 캐시로 즉시 표시됩니다.

---

## ✨ 주요 기능

- **멀티 사용자 (초대제)** — Google 로그인(Firebase Auth) + 초대 코드 가입. 보안 규칙이 본인 데이터만 접근 허용
- **AI 분석** (Anthropic Claude Haiku)
  - 음식: 텍스트(예: "닭볶음탕 1인분") 또는 **사진**으로 단백질·탄수·지방·칼로리 추정
  - 운동: 운동명으로 MET 계수(강도별) 추정
  - 체성분: 측정 변화 + 식단/운동 데이터를 종합한 코칭 피드백
- **식단/운동/체성분 기록** — 시간대별 그룹핑, 롱프레스 수정/삭제, Net 칼로리 신호등
- **통계** — 주/월/년 집계, 7일 이동평균 차트(Recharts), CSV 내보내기
- **공용 DB** — 함께 읽는 음식/운동 DB (읽기 전용 공유 · 쓰기는 운영자만, 개인 추가분은 각자 DB에)
- **PWA** — 홈 화면 설치, 오프라인 동작

---

## 🧱 기술 스택

| 구분 | 사용 기술 |
|------|-----------|
| 프론트엔드 | React 18, Vite 5, Recharts |
| PWA | vite-plugin-pwa (Workbox) |
| 데이터 | Firebase Firestore (주 저장소) + localStorage (캐시/오프라인 폴백) |
| 보안 | Firebase App Check (reCAPTCHA v3), Firestore Security Rules |
| 백엔드 | `api/*` 핸들러 — Firebase Cloud Functions v2(`functions.js`가 4그룹으로 배선) · Vercel 서버리스(병행) |
| AI | Anthropic Claude (`claude-haiku-4-5`) |
| Rate Limit | Upstash Redis (KV) |
| 배포 | Firebase Hosting + Functions (GitHub Actions) · Vercel(병행 기간) |

---

## 📂 프로젝트 구조

```
daniel-tracker/
├── index.html              # HTML 진입점 (PWA 메타)
├── package.json
├── vite.config.js          # Vite + vite-plugin-pwa(매니페스트/SW 자동 생성)
├── firestore.rules         # Firestore 보안 규칙 (App Check 기반)
├── .env.example            # 환경변수 템플릿
├── public/
│   ├── icon-192.png / icon-512.png / icon.svg
│   └── offline.html        # 오프라인 폴백 페이지
├── functions.js            # Cloud Functions v2 진입점 — api/* 핸들러를 4그룹으로 배선(배선만)
├── firebase.json           # Hosting rewrite(구체 경로 → /api/** 순) · functions 소스·ignore · 에뮬레이터
├── api/                    # 서버리스 핸들러 (Firebase·Vercel 양쪽에서 같은 파일이 돈다)
│   ├── analyze-food.js     # 음식(텍스트/사진) → 영양성분
│   ├── analyze-exercise.js # 운동 → MET 계수
│   ├── analyze-body.js     # 체성분 변화 → 코칭
│   ├── push-sync.js        # 웹푸시 구독/상태 (Firebase ID 토큰 검증)
│   ├── cron-reminders.js   # 예약 푸시 크론 (매일 20:00 KST)
│   └── _lib/security.js    # checkOrigin / rateLimit
└── src/
    ├── main.jsx            # React 진입점
    ├── App.jsx             # 전체 UI + 로직
    ├── firebase.js         # Firebase 초기화 + App Check + Auth
    ├── auth.js             # Google 로그인 / 세션 / ID 토큰 (Firebase Auth 래퍼)
    ├── store.js            # Firestore 저장소 (localStorage 폴백) + 멤버십/마이그레이션
    └── data.js             # 기본 음식/운동 DB + 목표값 + APP_NAME
```

> ℹ️ 서비스워커와 매니페스트는 `vite-plugin-pwa`가 빌드 시 자동 생성합니다(수동 `sw.js`/`manifest.json` 없음).

---

## 🔑 환경변수

배포 전에 반드시 설정해야 합니다. (`.env.example` 참고 — **파일 이름 규칙이 그 파일 맨 위에 있습니다**)

> Firebase에서는 비밀값을 파일이 아니라 **Secret Manager**에, 비밀이 아닌 값은 `.env.<projectId>`에 둡니다.
> 그 파일은 커밋하지 않고 CI가 배포 직전에 GitHub Variables로 만듭니다.

| 변수 | 위치 | 필수 | 용도 / 미설정 시 |
|------|------|:---:|------|
| `VITE_RECAPTCHA_SITE_KEY` | 프론트(빌드) | ✅ | App Check(reCAPTCHA v3). 미설정 시 App Check 비활성 → `firestore.rules` 배포 상태면 **앱이 Firestore 접근 불가** |
| `ANTHROPIC_API_KEY` | 서버리스 | ✅ | Claude API 키. 없으면 AI 분석 전부 실패(500) |
| `VITE_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | 빌드+서버리스 | 선택 | 웹푸시(리마인더·주간 성적표). 미설정 시 푸시 기능 비활성 |
| `CRON_SECRET` | 서버리스 | **Vercel에서만 필수** | 크론 엔드포인트 보호 (Vercel이 헤더 자동 첨부). **미설정 시 예약 푸시가 503으로 정지한다** — 값이 없을 때 열어두면 아무나 구독자 전원에게 푸시를 쏠 수 있어 fail-closed로 바꿨다(2026-08 감사 R-40). 생성: `openssl rand -hex 32` · 확인: `curl -i <도메인>/api/cron-reminders` → `503`이면 미설정, `401`이면 정상.<br>**Firebase에서는 설정하지 않는다** — `onSchedule` 함수는 Cloud Scheduler의 서비스 계정에만 invoker 권한이 있어, URL을 알아도 인터넷에서 호출할 수 없다(방벽이 비밀값이 아니라 IAM) |
| `WEB_API_KEY` | 서버리스 | 선택 | push-sync·verify-* 의 ID 토큰 검증용. 미설정 시 코드의 공개 웹 키 사용.<br>⚠️ 옛 이름은 `FIREBASE_WEB_API_KEY`였다 — Functions env는 `FIREBASE_` 접두사를 **예약어로 거부**해 그 이름으로는 배포가 안 된다. 코드는 새 이름 → 옛 이름 → 공개 폴백 순으로 읽으므로 병행 기간에 양쪽이 다 동작한다 |
| `PREVIEW_ORIGIN_SUFFIX` | 서버리스 | 선택 | **스테이징 전용.** 프리뷰 채널 origin 허용 패턴(예: `bodyplan-staging--*.web.app`). prod에는 두지 않는다 |
| `VITE_AUTH_DOMAIN` | 프론트(빌드) | 선택 | Firebase Auth의 authDomain 교체(DR-12). 미설정 시 현행 유지 |
| `VITE_NEW_ORIGIN` | 프론트(빌드) | 선택 | 새 주소 안내 배너. 미설정 시 배너 자체가 렌더되지 않는다 |
| `VITE_OWNER_EMAIL` | 프론트(빌드) | 선택 | 운영자 이메일 교체 시(기본 하드코딩). **firestore.rules의 isOwner()도 함께 수정** |
| `PRODUCTION_ORIGIN` | 서버리스 | ✅ | API origin 화이트리스트(콤마로 여러 개). 미설정 시 프로덕션 도메인의 API 호출이 403 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | 서버리스 | 선택 | IP별 rate limit. 미설정 시 rate limit이 **fail-open(통과)** — AI 비용 남용 위험 |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | 서버리스 | 선택 | 위 KV 대신 사용 가능한 대체 키 |
| `VERCEL_URL`, `NODE_ENV` | 서버리스 | 자동 | Vercel이 자동 주입(설정 불필요) |
| `K_SERVICE`, `K_REVISION` | 서버리스 | 자동 | Cloud Run이 자동 주입 — `/export/diag`가 Vercel 값이 없을 때 이 둘로 "어느 배포가 응답했나"를 표시 |

> Firebase 클라이언트 config(`src/firebase.js`)는 코드에 하드코딩돼 있습니다. apiKey 등은 공개돼도 무방한 클라이언트 키이며, **실제 보호는 App Check가 담당**하므로 프로덕션에서 `VITE_RECAPTCHA_SITE_KEY`가 핵심입니다.

---

## 🚀 실행 방법

### 1) 로컬 개발

**필요한 것**: Node.js 18 이상

```bash
npm install
cp .env.example .env.local   # ⚠️ `.env`가 아니라 `.env.local` — 아래 경고 참조
                            # (최소 VITE_RECAPTCHA_SITE_KEY는 dev에서 비워도 동작)
npm run dev
```

`http://localhost:5173`에서 열립니다. 같은 Wi-Fi의 스마트폰에서는 `http://PC의IP:5173`으로 접속 가능합니다.

> 로컬 dev에서는 App Check가 디버그 토큰 모드로 동작합니다(브라우저 콘솔에 출력되는 토큰을 Firebase 콘솔에 등록).
> `api/*` 서버리스 함수는 서버 런타임이 필요합니다. Firebase 에뮬레이터로 함께 띄우려면
> `npm run build && npm run test:emu`가 쓰는 것과 같은 방식으로
> `npx firebase-tools@15 emulators:start --project demo-bodyplan --only functions,hosting`을 쓰세요
> (`demo-` 접두사 프로젝트는 로그인이 필요 없습니다). Vercel 쪽은 `vercel dev`.

> ⚠️ **`.env`를 만들지 마세요.** 이 저장소의 **루트가 곧 Cloud Functions의 소스 디렉터리**라
> (`firebase.json`의 `functions.source: "."`), `.env`는 Firebase가 "모든 프로젝트 공통 함수 env"로
> 읽습니다 — 로컬 비밀이 프로덕션 함수에 그대로 실립니다. 로컬 값은 **`.env.local`**에만 두세요.
> 자세한 파일 이름 규칙은 `.env.example` 맨 위에 있습니다.

### 2) Firebase 배포 (CI가 수행 — 이전 진행 중)

배포는 GitHub Actions가 한다. 사람이 `firebase deploy`를 직접 치는 것은 **1차 부트스트랩 때 한 번뿐**이다.

| 워크플로 | 언제 | 무엇을 |
|---|---|---|
| `.github/workflows/ci.yml` | 모든 push·PR | 게이트(eslint → vitest) + 에뮬레이터 스모크(Hosting rewrite → 함수). 자격증명 불필요 |
| `.github/workflows/preview.yml` | PR | **스테이징 프로젝트**의 프리뷰 채널 배포 + 스모크 + PR 코멘트 |
| `.github/workflows/deploy.yml` | `main` push · 수동 | 프로덕션 Hosting + Functions 배포 + 배포 후 스모크 |

두 배포 워크플로는 `vars.FIREBASE_PROJECT_{PROD,STAGING}`이 비어 있으면 **통째로 skip**된다.
변수를 넣기 전에는 아무것도 배포되지 않는다(빨간불이 아니라 회색 skip).

**1차 부트스트랩은 사람이 한 번 한다.** API 활성화·시크릿 바인딩·아티팩트 정리 정책은
소유자 권한이 필요해 CI 서비스 계정으로는 처음부터 되지 않는다. 브라우저에서
[Google Cloud Shell](https://shell.cloud.google.com)을 열어 owner 계정으로 1회 배포한 뒤,
CI 서비스 계정을 최소 권한으로 좁힌다(로컬에 gcloud/firebase-tools를 깔 필요가 없다):

```bash
git clone https://github.com/munansa1003/daniel-tracker && cd daniel-tracker
npm ci && npm run build
npx firebase-tools@15 login --no-localhost
npx firebase-tools@15 deploy --only hosting,functions --project daniel-tracker-cb781
```

시크릿 4개(`ANTHROPIC_API_KEY`·`IMPORT_TOKEN`·`KV_REST_API_TOKEN`·`VAPID_PRIVATE_KEY`)는
그 전에 만들어 둔다 — 값은 저장소·GitHub이 아니라 Secret Manager에만 둔다:

```bash
npx firebase-tools@15 functions:secrets:set ANTHROPIC_API_KEY --project daniel-tracker-cb781
```

`INBODY_LOGIN_ID`/`INBODY_LOGIN_PW`·`SHARE_TEST_TOKEN`은 **만들지 않는다** — 값이 없으면
그 기능만 꺼진다(인바디 직수신 봉인 · 공유 뷰 진단 샘플 off).

규칙(`firestore.rules`)은 CI가 배포하지 않는다. 지금까지처럼 사람이 콘솔에서 게시한다.

**남은 사람 작업의 전체 목록과 순서는 [`docs/migration/DECISIONS.md`](docs/migration/DECISIONS.md)**에 있다
(콘솔 준비 → GitHub 변수 → 컷오버 당일 순서 → 병행 종료). 컷오버 런북 자체는
[`docs/migration/02-impact-map.md`](docs/migration/02-impact-map.md) §2.

### 3) Vercel 병행 (컷오버까지, 이후 14일)

Vercel 배포는 **지우지 않는다**. 같은 커밋이 양쪽에 배포되고 같은 Firestore·Upstash를 보므로
데이터는 한 곳이다. 코드는 양쪽 호환을 유지한다 — env 이름이 바뀐 곳은 옛 이름도 함께 읽고
(`WEB_API_KEY` ← `FIREBASE_WEB_API_KEY`), 새 파일(`functions.js`·`firebase.json`·워크플로)은
Vercel 배포에 영향을 주지 않는다.

| 기간 | Vercel | Firebase |
|---|---|---|
| 컷오버 전 | 현행 자동 배포 | 프리뷰/스테이징만 |
| 컷오버 ~ +14일 | 자동 배포 유지, 단 **크론은 컷오버 당일 제거** | 프로덕션 |
| +14일 이후 | (Upstash 소유권 확인 후) 프로젝트 삭제 | 단독 |

> ⚠️ **크론 이중 발송**: Vercel 크론과 Cloud Scheduler가 동시에 살아 있으면 밤 8시 푸시가
> 두 번 간다. 컷오버 당일 **Vercel 크론 제거가 먼저**다(02 런북 B1).

1. GitHub에 코드를 push하고 Vercel에서 Import
2. **Settings → Environment Variables**에 위 환경변수 등록 (이 단계가 빠지면 AI/로그인 기능이 동작하지 않습니다)
3. Deploy → `https://<프로젝트>.vercel.app` 생성
4. (선택) Upstash 통합을 추가하면 KV 변수가 자동 주입되어 rate limit이 활성화됩니다

### 4) 스마트폰 홈 화면 추가

- **iPhone**: Safari → 공유(□↑) → "홈 화면에 추가"
- **Android**: Chrome → ⋮ → "홈 화면에 추가"

---

## 🔒 Firestore 보안 규칙 배포

`firestore.rules`는 **App Check 토큰이 있는 요청만** 허용합니다(`request.app != null`).

> ⚠️ **순서 주의**: 앱에 App Check(`VITE_RECAPTCHA_SITE_KEY`)가 통합·정상 동작하는 것을 먼저 확인한 **뒤에** 이 규칙을 배포하세요.
> 규칙을 먼저 배포하면 App Check 토큰이 없는 앱이 Firestore에 접근하지 못해 즉시 다운됩니다.

Firebase 콘솔의 Firestore → 규칙 탭에 `firestore.rules` 내용을 붙여넣고 Publish 합니다.
(향후 Firebase Auth 도입 시 `request.auth.uid == uid` 조건을 추가해 본인 데이터만 접근하도록 강화할 수 있습니다.)

---

## 💾 데이터 관리

- 주 저장소는 **Firebase Firestore**이며, **localStorage**는 빠른 첫 화면 표시와 오프라인을 위한 캐시/폴백입니다.
- 같은 프로필로 로그인하면 **여러 기기에서 데이터가 동기화**됩니다.
- Firestore 접근 실패 시 localStorage에 저장된 마지막 데이터로 동작합니다.
- 통계 탭 하단에서 **CSV 내보내기**로 백업할 수 있습니다(엑셀에서 바로 열림).

---

## 🔧 커스텀하기

### 목표 수치 변경 (`src/data.js`)
```js
export const TARGETS = {
  p: 170,      // 단백질 목표 (g)
  c: 217,      // 탄수화물 목표 (g)
  f: 62,       // 지방 목표 (g)
  k: 2106,     // 칼로리 목표 (kcal)
  weight: 77.5 // 기본 체중 (체성분 기록이 없을 때의 폴백값)
};
```
> 실제 목표는 프로필의 키/나이와 **이달 평균 체중**을 바탕으로 Mifflin-St Jeor 공식(활동계수 1.55, 20% 적자)으로 동적 계산됩니다. 위 값은 폴백/기본값입니다.

### 음식/운동 DB 수정
같은 `src/data.js`의 `DEFAULT_FOODS` / `DEFAULT_EX` 배열을 수정하거나, 앱 내 "DB 관리"에서 추가/삭제할 수 있습니다(공용 DB는 Firestore에 저장되어 모든 사용자가 공유).

---

## ❓ 자주 묻는 질문

**Q: 다른 기기에서도 데이터가 동기화되나요?**
A: 네. Firebase Firestore를 사용하므로 같은 프로필로 로그인하면 기기 간 동기화됩니다. (오프라인일 때는 로컬 캐시로 동작하다가 온라인 복귀 시 동기화)

**Q: 데이터가 날아갈 수 있나요?**
A: Firestore에 저장되므로 브라우저 캐시를 지워도 유지됩니다. 다만 안전을 위해 CSV 백업을 권장합니다.

**Q: 비용은 어떻게 되나요?**
A: Vercel/Firebase/Upstash 무료 플랜으로 개인 사용 수준은 충분합니다. 단, AI 분석은 Anthropic API 사용량에 따라 과금되며, rate limit(KV) 미설정 시 호출이 제한되지 않으니 주의하세요.

**Q: AI 기능이 동작하지 않아요.**
A: 서버리스 환경변수(`ANTHROPIC_API_KEY` 등)가 설정됐는지, API 호출 origin이 `PRODUCTION_ORIGIN` 화이트리스트에 포함됐는지 확인하세요.
