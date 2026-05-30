# Daniel Tracker (Daniel Body Plan) — 식단·운동·체성분 관리 웹앱

스마트폰 홈 화면에서 앱처럼 사용할 수 있는 **PWA(Progressive Web App)**입니다.
**Firebase Firestore로 여러 기기 간 데이터가 동기화**되며, **AI(Claude)**가 음식·운동·체성분을 분석해 줍니다.
오프라인에서도 앱 화면이 로드되고, 로컬 캐시로 즉시 표시됩니다.

---

## ✨ 주요 기능

- **멀티 사용자 프로필** — 로그인 화면에서 프로필 선택/생성, 프로필별 비밀번호(선택), 관리자 마스터키로 삭제
- **AI 분석** (Anthropic Claude Haiku)
  - 음식: 텍스트(예: "닭볶음탕 1인분") 또는 **사진**으로 단백질·탄수·지방·칼로리 추정
  - 운동: 운동명으로 MET 계수(강도별) 추정
  - 체성분: 측정 변화 + 식단/운동 데이터를 종합한 코칭 피드백
- **식단/운동/체성분 기록** — 시간대별 그룹핑, 롱프레스 수정/삭제, Net 칼로리 신호등
- **통계** — 주/월/년 집계, 7일 이동평균 차트(Recharts), CSV 내보내기
- **공용 DB** — 모든 사용자가 함께 쓰는 음식/운동 DB (앱 내 "DB 관리"에서 편집)
- **PWA** — 홈 화면 설치, 오프라인 동작

---

## 🧱 기술 스택

| 구분 | 사용 기술 |
|------|-----------|
| 프론트엔드 | React 18, Vite 5, Recharts |
| PWA | vite-plugin-pwa (Workbox) |
| 데이터 | Firebase Firestore (주 저장소) + localStorage (캐시/오프라인 폴백) |
| 보안 | Firebase App Check (reCAPTCHA v3), Firestore Security Rules |
| 백엔드 | Vercel 서버리스 함수 (`api/*`) |
| AI | Anthropic Claude (`claude-haiku-4-5`) |
| Rate Limit | Upstash Redis / Vercel KV |

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
├── api/                    # Vercel 서버리스 함수
│   ├── analyze-food.js     # 음식(텍스트/사진) → 영양성분
│   ├── analyze-exercise.js # 운동 → MET 계수
│   ├── analyze-body.js     # 체성분 변화 → 코칭
│   ├── verify-master.js    # 관리자 마스터키 검증
│   └── _lib/security.js    # checkOrigin / rateLimit / safeEqual
└── src/
    ├── main.jsx            # React 진입점
    ├── App.jsx             # 전체 UI + 로직
    ├── firebase.js         # Firebase 초기화 + App Check
    ├── store.js            # Firestore 저장소 (localStorage 폴백)
    └── data.js             # 기본 음식/운동 DB + 목표값
```

> ℹ️ 서비스워커와 매니페스트는 `vite-plugin-pwa`가 빌드 시 자동 생성합니다(수동 `sw.js`/`manifest.json` 없음).

---

## 🔑 환경변수

배포 전에 반드시 설정해야 합니다. (`.env.example` 참고 → `.env` 또는 Vercel 환경변수로 등록)

| 변수 | 위치 | 필수 | 용도 / 미설정 시 |
|------|------|:---:|------|
| `VITE_RECAPTCHA_SITE_KEY` | 프론트(빌드) | ✅ | App Check(reCAPTCHA v3). 미설정 시 App Check 비활성 → `firestore.rules` 배포 상태면 **앱이 Firestore 접근 불가** |
| `ANTHROPIC_API_KEY` | 서버리스 | ✅ | Claude API 키. 없으면 AI 분석 전부 실패(500) |
| `ADMIN_MASTER_KEY` | 서버리스 | ✅ | 관리자 마스터키 검증(프로필 삭제/비번 우회) |
| `PRODUCTION_ORIGIN` | 서버리스 | ✅ | API origin 화이트리스트(콤마로 여러 개). 미설정 시 프로덕션 도메인의 API 호출이 403 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | 서버리스 | 선택 | IP별 rate limit. 미설정 시 rate limit이 **fail-open(통과)** — AI 비용 남용 위험 |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | 서버리스 | 선택 | 위 KV 대신 사용 가능한 대체 키 |
| `VERCEL_URL`, `NODE_ENV` | 서버리스 | 자동 | Vercel이 자동 주입(설정 불필요) |

> Firebase 클라이언트 config(`src/firebase.js`)는 코드에 하드코딩돼 있습니다. apiKey 등은 공개돼도 무방한 클라이언트 키이며, **실제 보호는 App Check가 담당**하므로 프로덕션에서 `VITE_RECAPTCHA_SITE_KEY`가 핵심입니다.

---

## 🚀 실행 방법

### 1) 로컬 개발

**필요한 것**: Node.js 18 이상

```bash
npm install
cp .env.example .env   # 값 채우기 (최소 VITE_RECAPTCHA_SITE_KEY는 dev에서 비워도 동작)
npm run dev
```

`http://localhost:5173`에서 열립니다. 같은 Wi-Fi의 스마트폰에서는 `http://PC의IP:5173`으로 접속 가능합니다.

> 로컬 dev에서는 App Check가 디버그 토큰 모드로 동작합니다(브라우저 콘솔에 출력되는 토큰을 Firebase 콘솔에 등록).
> `api/*` 서버리스 함수는 Vercel 런타임이 필요하므로, AI 기능까지 로컬에서 테스트하려면 `vercel dev` 사용을 권장합니다.

### 2) Vercel 배포 (권장)

1. GitHub에 코드를 push하고 Vercel에서 Import
2. **Settings → Environment Variables**에 위 환경변수 등록 (이 단계가 빠지면 AI/로그인 기능이 동작하지 않습니다)
3. Deploy → `https://<프로젝트>.vercel.app` 생성
4. (선택) Upstash 통합을 추가하면 KV 변수가 자동 주입되어 rate limit이 활성화됩니다

### 3) 스마트폰 홈 화면 추가

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
