# ARCHITECTURE.md — Daniel Tracker 인수인계 문서

> 새 Claude Code 세션(또는 다른 개발자)이 이 저장소 작업을 이어받을 때 읽는 문서.
> 마지막 갱신: 2026-06 (Phase 0~2 리팩토링 반영). **코드와 이 문서가 어긋나면 코드가 진실.**

---

## 1. 앱 개요

**Daniel Body Plan** — 식단·운동·체성분 기록 PWA. 1인 사용자(Daniel)가 실제로 매일 사용 중.

| 항목 | 내용 |
|------|------|
| 프론트 | React 18 + Vite 5, recharts, 인라인 스타일 (CSS 파일 없음) |
| PWA | vite-plugin-pwa (Workbox). 수동 sw.js/manifest 없음 — 빌드 시 자동 생성. vite.config의 `manualChunks`로 firebase·recharts·vendor 청크 분리(앱 코드만 바뀌면 큰 라이브러리는 SW 캐시 유지 → 업데이트 재다운 최소) |
| 데이터 | Firebase Firestore(주 저장소) + localStorage(캐시/오프라인 폴백). `src/store.js`가 추상화 |
| 백엔드 | Vercel 서버리스 `api/*` — Claude API로 음식/운동/체성분 AI 분석 |
| 배포 | main에 머지 → Vercel 자동 배포 (https://daniel-tracker.vercel.app) |
| 사용자 프로필 | 175cm · 1984년생(42세) · ~77kg · 목표: 근육 유지하며 완만~표준 감량 |

**TS 없음, 최소 ESLint(`npm run lint`) + Vitest(`npm test`)** — 빌드 성공이 변수 참조 오류를 잡아주지 못하므로(아래 §6 주의) ESLint 3규칙(no-undef · react/jsx-no-undef · rules-of-hooks)이 import 누락을 정적으로, 순수 함수 단위 테스트 + App 렌더 스모크가 동작을 방어. 스타일 규칙은 의도적으로 없음.

## 2. 파일 구조

```
src/
├── App.jsx          ★ ~2,950줄. BodyTab + StatsTab + App + MainApp (Phase 3 분리 대상)
├── theme.jsx        THEME, GlobalStyles(dbp-* 전역 CSS), PROFILE_COLORS
├── utils.js         순수 함수 14종 (§4 참조) — 부수효과·의존성 없음
├── hooks/
│   └── useLongPress.js
├── components/      소형 컴포넌트 11개 (§4 참조)
├── __tests__/       utils.test.js, netcalcard.test.jsx, app.smoke.test.jsx
├── store.js         Firestore 우선 + localStorage 폴백 get/set. 키: day:YYYY-MM-DD, bodylog, goals 등
├── firebase.js      Firebase 초기화 + App Check(reCAPTCHA v3, VITE_RECAPTCHA_SITE_KEY)
├── data.js          기본 음식/운동 DB, DEFAULT_TARGETS, COLORS
└── main.jsx         진입점
api/                 서버리스 (analyze-food/exercise/body, verify-master, _lib/security.js)
vitest.config.js     테스트 전용 설정 (PWA 플러그인 미로딩)
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
체중 W = 이달 체성분 월평균 (없으면 최신값 → 77.5 폴백). MainApp의 TARGETS useMemo(App.jsx ~1900행)
```

### 운동 되먹기 (핵심 컨셉) — 모드별 계수
- `carbBonus = round(운동kcal × exFeedback(mode) ÷ 4)` → 그날 탄수 목표에 가산
- `effectiveTargetK = TARGETS.k + round(운동 × exFeedback(mode))` → 그날 섭취 목표
- `exFeedback`: **감량 0.5 / 유지 1.0** (`src/utils.js`, `MODE_FEEDBACK`)
- **이유(감량 0.5)**: 0% 되먹기는 큰 운동일(600~1000kcal 빈번) 적자가 과해 근손실 위험, 100%는 MET 과대평가에 취약. 50%가 헤지+주기화의 균형점. MET 1.5배 부풀려져도 감량 유지됨(검증됨).

### ★ 목표 모드 (감량 cut / 유지 maintain) — 2026-06 도입
- **차이는 딱 두 가지**: ① 휴식일 적자 `−175 → 0` (`MODE_DEFICIT`) ② 운동 되먹기 `×0.5 → ×1.0` (`MODE_FEEDBACK`). 단백질 2.2·지방 0.6 공통, **탄수는 나머지라 유지 모드에서 자동 +44g**.
- **유지 모드 = 에너지 균형**: 목표 = 그날의 실측 유지칼로리(BMR×1.05) → 순에너지 0 → 떠다니는 월평균 체중 로직이 "자동 안정장치"로 작동(감량기엔 영구 적자였던 그 로직이 평형점을 만듦).
- **저장**: 전역 현재 모드 = `goals.mode`(없으면 `cut` 폴백). 각 날 기록에 `mode` 스탬프(`saveDay`: 오늘=현재 모드, 과거 보정은 기존 스탬프 보존). **기존 데이터(필드 없음)=cut → 동작·숫자 무변화.**
- **판정 적용처**: 홈=현재 모드 / **달력·통계 주간성적표·8주 등급 = 그 날의 모드**(과거 감량일은 감량 기준 그대로 유지, 통째 재칠 방지). 단백질·운동 판정은 모드 무관.
- **감량값(175·0.5)은 변경 금지** — 유지값은 모드 분기로만 추가(역산 추정이라 실측 검증 권장).
- UI: 홈 헤더/요약 모드 배지(A안) + 설정 `목표` 탭 라디오(C안). StatsTab 코칭/달력 범례의 "적자·운동50%" 문구도 모드별 분기.

### 판정 규칙 (전 화면 통일 — PR #6, #8, #16)
- **단일 부등식**: `섭취 ≤ 목표K + 운동×0.5` (⟺ 보정섭취 ≤ 기본목표, 수학적 동치)
- 적용처: 홈 헤더 색, components/NetCalCard.jsx, 섭취 ProgressBar(max=effectiveTargetK), 통계 주간성적표 pHit/dHit(StatsTab 내), 달력 calOk(MainApp 내)
- **반올림 규칙(PR #16)**: 판정은 반드시 `Math.round(표시값)` 기준 — 화면에 170으로 보이면 달성. 원본 소수로 비교하면 "표시 170인데 미달" 버그 재발함
- NetCalCard 신호등 구간: t=기본목표 기준 위험<0.75t / 주의<0.90t / 적정≤t / 초과>t (폭이 좁은 건 사용자가 인지하고 유지 결정)

### 시간대 (PR #2) — 단일 소스 `TIME_PERIODS` (src/utils.js)
새벽 0-5 / 아침 6-10 / 점심 11-16 / 저녁 17-20 / 야간 21-23. 그룹핑·시간드롭다운 모두 `periodOf()` 사용. 통계의 "야식 22시+"는 별개 지표(의도).

### 어제 복사 (PR #12, #14)
- 개별 항목 클릭 = **현재 시간**으로 추가 / "전체 복사" = **어제 원래 시간** 유지

## 4. 컴포넌트 지도 (2026-06 Phase 0~2 반영)

### 분리된 모듈

| 파일 | 심볼 | 비고 |
|------|------|------|
| theme.jsx | THEME, GlobalStyles, PROFILE_COLORS | THEME **40+곳에서 사용**. GlobalStyles는 전역 CSS(`dbp-*`, keyframes) 주입 — App 최상단 렌더 필수 |
| utils.js | today, nowHour, isCompletedDay, **periodStart**, calcTargets, **exFeedback, isCalOk, MODE_DEFICIT, MODE_FEEDBACK**, sortByHour, TIME_PERIODS, periodOf, groupMealsByTime, groupExercisesByTime, aggregateDay, calcMovingAvg, getWeekKey, getMonthKey, getYearKey | 전부 순수 함수. calcTargets(w,h,a,**mode**)·판정 헬퍼는 §3 참조. periodStart(period,todayStr)=기간 토글 시작일 |
| hooks/useLongPress.js | useLongPress | BodyTab·MainApp 사용 |
| components/LongPressActionBar.jsx | LongPressActionBar | |
| components/Modal.jsx | Modal | 14곳 사용 |
| components/ProgressBar.jsx | ProgressBar | |
| components/MiniDonut.jsx | MiniDonut | recharts PieChart/Pie/Cell/ResponsiveContainer 사용 |
| components/NetCalCard.jsx | NetCalCard | 보정섭취+막대+신호등 (PR #8). mode prop으로 되먹기 계수 일치. netcalcard.test.jsx가 경계값 보호 |
| components/NextMealTip.jsx | NextMealTip | 식단 탭 상단 위젯(H): 남은 매크로 ÷ 남은 끼니 → 다음 한 끼 권장(P·C·kcal). nowHour 주입(테스트 용이), 목표 충족 시 완료 메시지 |
| components/MacroRatioBar.jsx | MacroRatioBar | 식단 탭 상단 위젯(B): 섭취 P/C/F 칼로리 기여 비율 스택바 + 목표 비율선. 섭취 0이면 null |
| components/IntakeRhythm.jsx | IntakeRhythm | 식단 탭 상단 위젯(C): 5시간대 칼로리 막대 + 단백질 오버레이. TIME_PERIODS/periodOf 사용, 기록 0이면 null |
| components/WorkoutStamp.jsx | WorkoutStamp | 운동 탭 상단 위젯(L): 오늘 운동 도장(분·평균MET·소모) + 연속일/최장 + 최근7칸. 미기록 시 끊김 경고. allDays로 스트릭 계산 |
| components/ExerciseRhythm.jsx | ExerciseRhythm | 운동 탭 상단 위젯: 5시간대 소모 kcal 막대 + 분 라벨(IntakeRhythm 운동판). 기록 0이면 null |
| components/CalorieBandChart.jsx | CalorieBandChart, buildCalorieSeries | 식단 탭 기간 통계(D1): 1주/1달/3개월/전체 토글 + 일별 섭취 라인·목표밴드·초과 빨간점. buildCalorieSeries 순수함수(그 날 모드로 isCalOk 판정). period-charts.test.jsx |
| components/WeekdayRadar.jsx | WeekdayRadar, buildWeekdayTotals | 운동 탭 기간 통계(E9): 기간 토글 + 요일별 소모 kcal 7각형 레이더. buildWeekdayTotals 순수함수. period-charts.test.jsx |
| components/DateCopySheet.jsx | DateCopySheet, recentCopyDays, copyDupCount | 날짜별 복사(컨셉3): 최근 기록일 칩 선택 + 끼니별(전체/끼니/개별) 미리보기 시트. MainApp가 모달로 렌더, addMealsBatch/addExBatch로 복사(개별=현재시간/묶음=원본시간) + copyUndo 스낵바(컨셉4). date-copy.test.jsx |
| components/AddFoodForm.jsx | AddFoodForm | COLORS(data.js) 사용 |
| components/AddExForm.jsx | AddExForm | **weight prop 필요** |
| components/EditMealForm.jsx | EditMealForm | periodOf 사용 |
| components/EditExForm.jsx | EditExForm | **weight prop 필요**, periodOf 사용 |
| components/ProfileSetup.jsx | ProfileSetup | PROFILE_COLORS 사용 |
| components/LoginScreen.jsx | LoginScreen + 비밀번호 해싱 유틸(비공개) | PBKDF2-SHA256 10만회 + 레거시 SHA-256/평문 호환(PR #1)은 LoginScreen만 사용해 같은 파일에 module-private으로 둠. store의 프로필 CRUD 사용 |

### App.jsx에 남은 것 (~2,950줄, 라인은 2026-06 기준)

| 라인 | 심볼 | 비고 |
|---:|------|------|
| 20 | BodyTab (~490줄) | 차트 기간선택+날짜비례 X축(PR #7), AI 코칭, store 직접 접근. Phase 3 대상 |
| 512 | StatsTab (~1100줄) | **내부에 DotMatrix·sparklinePath 중첩 정의** — 추출 시 통째로. Phase 3 대상 |
| 1617 | App (default export) | 세션 복원 |
| 1651 | MainApp (~1300줄) | 오케스트레이터. 상태 허브. **분리 대상 아님** |

## 5. 리팩토링 계획 (합의된 점진 방식 — 빅뱅 금지)

### Phase 0 — 테스트 먼저 ⭐ ✅ 완료 (2026-06)
- Vitest 도입(`"test": "vitest"`), happy-dom(렌더 스모크용)
- `src/__tests__/utils.test.js`: calcTargets(1.05/−175/매크로 정합), periodOf(0~23 전체), aggregateDay, getWeekKey
- `src/__tests__/netcalcard.test.jsx`: 신호등 경계값(0.75t/0.90t/t), 반올림 판정(PR #16), 운동 50% 되먹기 — 실렌더링(renderToStaticMarkup) 검증
- `src/__tests__/app.smoke.test.jsx`: App→MainApp 마운트 + 5개 탭 전환 (import 누락 → 흰 화면 방어)
- 효과: §3의 캘리브레이션 값이 실수로 깨지면 즉시 검출

### Phase 1 — 순수 모듈 추출 ✅ 완료 (2026-06)
- `src/theme.jsx`: THEME, PROFILE_COLORS, GlobalStyles (GlobalStyles가 JSX라 .jsx 확장자)
- `src/utils.js`: today, nowHour, isCompletedDay, calcTargets, sortByHour, TIME_PERIODS, periodOf, groupMealsByTime, groupExercisesByTime, aggregateDay, calcMovingAvg, getWeek/Month/YearKey
- `src/hooks/useLongPress.js`
- App.jsx는 import로 대체. **순수 이동 — 로직 한 글자도 변경 금지**

### Phase 2 — 소형 컴포넌트 ✅ 완료 (2026-06, 1개 추출 = 1커밋)
순서: LongPressActionBar → Modal → ProgressBar → MiniDonut → NetCalCard → 폼 4종 → ProfileSetup → LoginScreen (비밀번호 유틸 동반 이동)
- 각 추출 후 `npm run build` + `npm test` 통과 확인함

### Phase 3 — 큰 탭 (선택, 별도 라운드) ⬜ 미착수
BodyTab → StatsTab 순. StatsTab은 중첩 컴포넌트 포함 통째 이동.

### App / MainApp 은 App.jsx에 유지 (추출 금지)

## 6. ⚠️ 지뢰 목록 (반드시 읽을 것)

1. **빌드는 import 누락을 못 잡음** (TS 없음). `THEME` import 빠뜨려도 빌드 ✓ → 런타임 흰 화면. **1차 방어는 `npm run lint`**(no-undef가 `THEME`, jsx-no-undef가 `<Modal>` 누락을 검출 — 검증됨), 2차는 app.smoke.test.jsx(탭 전환). 추출마다 **lint+test 필수**, dev 서버 실제 클릭 확인도 권장
2. **TARGETS 이름 3종**: `DEFAULT_TARGETS`(data.js import 별칭) / MainApp 지역 `TARGETS`(useMemo, 동적) / StatsTab의 `appTargets` prop. 잘못 연결하면 **에러 없이 숫자만 틀려짐**
3. **recharts import 한 줄에 14개** — MiniDonut/BodyTab/StatsTab이 나눠 씀. 분리 시 어떤 차트가 어디 필요한지 정확히 갈라야 함
4. **GlobalStyles의 `dbp-*` CSS 클래스** — 여러 컴포넌트가 className으로 사용. GlobalStyles가 항상 렌더돼야 애니메이션 동작
5. **StatsTab 내부 중첩** — DotMatrix(컴포넌트), sparklinePath(함수)가 StatsTab 안에 정의됨
6. **BodyTab은 store.js 직접 접근** — getCurrentUserId, localStorage(`dt_*_body-coaching` 캐시)
7. **판정은 반올림 기준**(§3) — 리팩토링 중 `Math.round` 빠뜨리면 PR #16 버그 재발. **칼로리 판정은 `isCalOk()` 한 곳으로 통일**(반올림+모드 되먹기 내장). 직접 `<= 목표 + ex×0.5` 인라인 금지 — 0.5가 모드별(0.5/1.0)이므로 `exFeedback(mode)`/`isCalOk` 사용
9. **모드 판정의 두 종류**(§3): 홈/오늘=`goals.mode`(현재), 달력/통계 과거=`dd.mode`(그 날). 둘을 섞으면 과거 등급이 흔들림. 새 판정 추가 시 "이건 현재 모드냐 그 날 모드냐" 먼저 결정
8. 임시 파일(미리보기 HTML 등)은 커밋 금지 — stop hook이 untracked 파일을 잡음

## 7. 검증 방법

```bash
npm install && npm run build     # 에러 0 + PWA 산출물(sw.js, manifest.webmanifest 각 1개)
npm test                         # Vitest (CI/비대화형에선 1회 실행, 터미널에선 watch)
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
