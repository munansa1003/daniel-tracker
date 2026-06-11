# ARCHITECTURE.md — Daniel Tracker 인수인계 문서

> 새 Claude Code 세션(또는 다른 개발자)이 이 저장소 작업을 이어받을 때 읽는 문서.
> 마지막 갱신: 2026-06 (PR #16까지 반영). **코드와 이 문서가 어긋나면 코드가 진실.**

---

## 1. 앱 개요

**Daniel Body Plan** — 식단·운동·체성분 기록 PWA. 1인 사용자(Daniel)가 실제로 매일 사용 중.

| 항목 | 내용 |
|------|------|
| 프론트 | React 18 + Vite 5, recharts, 인라인 스타일 (CSS 파일 없음) |
| PWA | vite-plugin-pwa (Workbox). 수동 sw.js/manifest 없음 — 빌드 시 자동 생성 |
| 데이터 | Firebase Firestore(주 저장소) + localStorage(캐시/오프라인 폴백). `src/store.js`가 추상화 |
| 백엔드 | Vercel 서버리스 `api/*` — Claude API로 음식/운동/체성분 AI 분석 |
| 배포 | main에 머지 → Vercel 자동 배포 (https://daniel-tracker.vercel.app) |
| 사용자 프로필 | 175cm · 1984년생(42세) · ~77kg · 목표: 근육 유지하며 완만~표준 감량 |

**테스트/린트/TS 없음** — 빌드 성공이 변수 참조 오류를 잡아주지 못함(아래 §6 주의).

## 2. 파일 구조

```
src/
├── App.jsx      ★ 3,750줄 단일 파일. 전체 UI+로직 (분리 대상)
├── store.js     Firestore 우선 + localStorage 폴백 get/set. 키: day:YYYY-MM-DD, bodylog, goals 등
├── firebase.js  Firebase 초기화 + App Check(reCAPTCHA v3, VITE_RECAPTCHA_SITE_KEY)
├── data.js      기본 음식/운동 DB, DEFAULT_TARGETS, COLORS
└── main.jsx     진입점
api/             서버리스 (analyze-food/exercise/body, verify-master, _lib/security.js)
```

## 3. ★ 칼로리·매크로 설계 (가장 중요한 도메인 지식 — 절대 임의 변경 금지)

실사용자의 **7개월 실측 데이터로 캘리브레이션**된 값들. 변경하려면 사용자 합의 필요.

### 목표 계산 — `calcTargets(weight, height, age)` (App.jsx ~125행)
```
BMR = Mifflin-St Jeor (10W + 6.25H − 5A + 5)
비운동 기초유지 = BMR × 1.05      ← 실측 역산값 (공식 활동계수 1.55는 과대평가였음. 실측범위 1.03~1.12의 중심)
휴식일 목표 K = 기초유지 − 175    ← 기초적자. 운동 포함 평균 적자 ~400/일 = 주 0.37kg 감량
단백질 P = W × 2.2 (g)            ← LBM당 2.8g/kg, 근보존 상단. 고정
지방   F = W × 0.6 (g)            ← 0.8에서 하향(탄수 확보 목적). 최소 0.5 이상 유지할 것
탄수   C = (K − P×4 − F×9) ÷ 4   ← "나머지" 구조 (의도됨)
체중 W = 이달 체성분 월평균 (없으면 최신값 → 77.5 폴백). MainApp의 TARGETS useMemo(~2700행)
```

### 운동 50% 되먹기 (핵심 컨셉)
- `carbBonus = round(운동kcal × 0.5 ÷ 4)` → 그날 탄수 목표에 가산
- `effectiveTargetK = TARGETS.k + round(운동 × 0.5)` → 그날 섭취 목표
- **이유**: 0% 되먹기는 큰 운동일(600~1000kcal 빈번) 적자가 과해 근손실 위험, 100%는 MET 과대평가에 취약. 50%가 헤지+주기화의 균형점. MET 1.5배 부풀려져도 감량 유지됨(검증됨).

### 판정 규칙 (전 화면 통일 — PR #6, #8, #16)
- **단일 부등식**: `섭취 ≤ 목표K + 운동×0.5` (⟺ 보정섭취 ≤ 기본목표, 수학적 동치)
- 적용처: 홈 헤더 색(~3044), NetCalCard(~231), 섭취 ProgressBar(max=effectiveTargetK), 통계 주간성적표 pHit/dHit(~1427, ~1516), 달력 calOk(~2990)
- **반올림 규칙(PR #16)**: 판정은 반드시 `Math.round(표시값)` 기준 — 화면에 170으로 보이면 달성. 원본 소수로 비교하면 "표시 170인데 미달" 버그 재발함
- NetCalCard 신호등 구간: t=기본목표 기준 위험<0.75t / 주의<0.90t / 적정≤t / 초과>t (폭이 좁은 건 사용자가 인지하고 유지 결정)

### 시간대 (PR #2) — 단일 소스 `TIME_PERIODS` (~141행)
새벽 0-5 / 아침 6-10 / 점심 11-16 / 저녁 17-20 / 야간 21-23. 그룹핑·시간드롭다운 모두 `periodOf()` 사용. 통계의 "야식 22시+"는 별개 지표(의도).

### 어제 복사 (PR #12, #14)
- 개별 항목 클릭 = **현재 시간**으로 추가 / "전체 복사" = **어제 원래 시간** 유지

## 4. 컴포넌트 지도 (2026-06 기준 라인)

| 라인 | 심볼 | 비고 |
|---:|------|------|
| 7 | THEME | 모듈 상수. **40+곳에서 사용** |
| 16 | GlobalStyles | 전역 CSS(`dbp-*` 클래스, keyframes) 주입. App 최상단 렌더 필수 |
| 63-90 | 비밀번호 해싱 유틸 | PBKDF2-SHA256 10만회 + 레거시 SHA-256/평문 호환 (PR #1) |
| 125 | calcTargets | §3 참조 |
| 136-171 | sortByHour, TIME_PERIODS, periodOf, groupMeals/ExercisesByTime | |
| 174 / 185 | LongPressActionBar / useLongPress | |
| 231 | NetCalCard | 보정섭취+막대+신호등 (PR #8) |
| 291 / 314 | ProgressBar / MiniDonut | |
| 339 / 557 | LoginScreen / ProfileSetup | store의 프로필 CRUD 사용 |
| 619 | Modal | 14곳 사용 |
| 637-795 | AddFoodForm, AddExForm, EditMealForm, EditExForm | AddExForm/EditExForm은 weight prop 필요 |
| 796 | BodyTab (~490줄) | 차트 기간선택+날짜비례 X축(PR #7), AI 코칭, store 직접 접근 |
| 1288-1308 | aggregateDay, calcMovingAvg, getWeek/Month/YearKey | |
| 1311 | StatsTab (~1100줄) | **내부에 DotMatrix·sparklinePath 중첩 정의** — 추출 시 통째로 |
| 2416 | App (default export) | 세션 복원 |
| 2450 | MainApp (~1300줄) | 오케스트레이터. 상태 허브. **분리 대상 아님** |

## 5. 리팩토링 계획 (합의된 점진 방식 — 빅뱅 금지)

### Phase 0 — 테스트 먼저 ⭐ (분리 전 필수 안전망)
- Vitest 도입(`npm i -D vitest`, package.json에 `"test": "vitest"`)
- 순수 함수 단위 테스트: `calcTargets`(1.05/−175/매크로 정합), `aggregateDay`, `periodOf`(0~23 전체 매핑), 신호등 판정 경계값, `getWeekKey`, 반올림 판정 규칙
- 효과: §3의 캘리브레이션 값이 실수로 깨지면 즉시 검출

### Phase 1 — 순수 모듈 추출 (위험 0)
- `src/theme.js`: THEME, PROFILE_COLORS, GlobalStyles
- `src/utils.js`: today, nowHour, isCompletedDay, calcTargets, sortByHour, TIME_PERIODS, periodOf, groupMealsByTime, groupExercisesByTime, aggregateDay, calcMovingAvg, getWeek/Month/YearKey
- `src/hooks/useLongPress.js`
- App.jsx는 import로 대체. **순수 이동 — 로직 한 글자도 변경 금지**

### Phase 2 — 소형 컴포넌트 (위험 낮음, 1개 추출 = 1커밋)
순서: LongPressActionBar → Modal → ProgressBar → MiniDonut → NetCalCard → 폼 4종 → ProfileSetup → LoginScreen
- 각 추출 후 `npm run build` + dev 화면 클릭 확인 후 다음으로

### Phase 3 — 큰 탭 (선택, 별도 라운드)
BodyTab → StatsTab 순. StatsTab은 중첩 컴포넌트 포함 통째 이동.

### App / MainApp 은 App.jsx에 유지 (추출 금지)

## 6. ⚠️ 지뢰 목록 (반드시 읽을 것)

1. **빌드는 import 누락을 못 잡음** (TS/린트 없음). `THEME` import 빠뜨려도 빌드 ✓ → 런타임 흰 화면. 추출마다 **dev 서버에서 실제 클릭 확인** 필수
2. **TARGETS 이름 3종**: `DEFAULT_TARGETS`(data.js import 별칭) / MainApp 지역 `TARGETS`(useMemo, 동적) / StatsTab의 `appTargets` prop. 잘못 연결하면 **에러 없이 숫자만 틀려짐**
3. **recharts import 한 줄에 14개** — MiniDonut/BodyTab/StatsTab이 나눠 씀. 분리 시 어떤 차트가 어디 필요한지 정확히 갈라야 함
4. **GlobalStyles의 `dbp-*` CSS 클래스** — 여러 컴포넌트가 className으로 사용. GlobalStyles가 항상 렌더돼야 애니메이션 동작
5. **StatsTab 내부 중첩** — DotMatrix(컴포넌트), sparklinePath(함수)가 StatsTab 안에 정의됨
6. **BodyTab은 store.js 직접 접근** — getCurrentUserId, localStorage(`dt_*_body-coaching` 캐시)
7. **판정은 반올림 기준**(§3) — 리팩토링 중 `Math.round` 빠뜨리면 PR #16 버그 재발
8. 임시 파일(미리보기 HTML 등)은 커밋 금지 — stop hook이 untracked 파일을 잡음

## 7. 검증 방법

```bash
npm install && npm run build     # 에러 0 + PWA 산출물(sw.js, manifest.webmanifest 각 1개)
npm run dev                      # localhost:5173
```
수동 체크리스트(리팩토링 후): 로그인 → 홈(도넛 3개·섭취바·NetCalCard 신호등) → 식단 탭(추가/어제복사/시간대 그룹) → 운동 탭 → 체성분(차트 기간버튼·AI코칭 버튼 존재) → 통계(주간성적표·기간요약 코멘트·달력 dot) → DB관리/CSV 내보내기.
숫자 스모크 테스트: 체중 77.3/175/42 → K=1570, P=170, F=46, C=119. 운동 1070 → 목표 2105, 탄수보충 +134.

## 8. 변경 이력 (PR #1~#16 요약)

#1 보안/PWA/문서 4건(MET 미리보기 fix, SW/manifest 일원화, 비번 PBKDF2, README) · #2 시간대 5구간 · #3 칼로리 재설계(실측 보정) · #4 운동 50% 되먹기 · #5 지방 0.6(탄수 정상화) · #6 적자판정 전화면 통일 · #7 체성분 차트 기간선택+날짜비례 · #8 NetCalCard 보정섭취+막대 · #9 통계 스파크라인 기간반영 · #10 통계 코멘트 식단연계 · #11 매크로 스마트안내(→#13에서 제거) · #12 어제복사 시간유지 · #14 개별=현재/전체=어제시간 · #15 식단탭 섭취합계 · #16 반올림 판정 통일

## 9. 운영 규칙

- 개발 브랜치에서 작업 → 커밋(한국어, 배경+이유 포함) → push → **PR 생성 → head sha 확인 후 머지** (#3에서 stale head 머지 사고 있었음 — 머지 전 head 확인 습관화)
- 머지 = Vercel 자동 배포 = 실사용자 폰에 반영. **빌드 깨진 채 머지 절대 금지**
- 사용자는 한국어로 소통, 변경 전 컨셉 미리보기(정적 HTML, JS 없이)를 선호함
