# ARCHITECTURE.md — Daniel Tracker 인수인계 문서

> 새 Claude Code 세션(또는 다른 개발자)이 이 저장소 작업을 이어받을 때 읽는 문서.
> 마지막 갱신: 2026-08 (자동 유입 3경로 + 적응형 TDEE 도입 후 구조 감사 반영 — `docs/system-audit-2026-08.md`).
> **코드와 이 문서가 어긋나면 코드가 진실.**

---

## 1. 앱 개요

**Daniel Body Plan** — 식단·운동·체성분 기록 PWA. 1인 사용자(Daniel)가 실제로 매일 사용 중.

| 항목 | 내용 |
|------|------|
| 프론트 | React 18 + Vite 5, recharts, 인라인 스타일 (CSS 파일 없음) |
| PWA | vite-plugin-pwa (Workbox). 수동 sw.js/manifest 없음 — 빌드 시 자동 생성. vite.config의 `manualChunks`로 firebase·recharts·vendor 청크 분리(앱 코드만 바뀌면 큰 라이브러리는 SW 캐시 유지 → 업데이트 재다운 최소) |
| 데이터 | Firebase Firestore(주 저장소) + localStorage(캐시/오프라인 폴백). `src/store.js`가 추상화 |
| 인증 | **Firebase Auth Google 로그인 + 초대 코드**(경로 B, 2026-07). 흐름: 로그인 → `members/{uid}`(규칙이 `invites/{code}` 검증) → 온보딩(`data/profile`) → MainApp. `src/auth.js`가 seam. 규칙·배포 순서는 `docs/DEPLOY-PATH-B.md` |
| 백엔드 | Vercel 서버리스 `api/*` — Claude API로 음식/운동/체성분 AI 분석 |
| 배포 | main에 머지 → Vercel 자동 배포 (https://daniel-tracker.vercel.app) |
| 사용자 프로필 | 175cm · 1984년생(42세) · ~77kg · 목표: 근육 유지하며 완만~표준 감량. 멀티유저 전환 후에도 Daniel 계정의 캘리브레이션 값은 §3 그대로 |

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
├── adaptiveTDEE.js  적응형 유지칼로리 역산(순수). estimateTDEE: 최근 4주 섭취+추세체중(회귀)으로 실제
│                    소모 역산 → 보정치 delta(=measuredMaint − BMR×1.05). 데이터 게이트·±300 클램프
├── syncQueue.js     오프라인 쓰기 대기열(키 이름만 보관). set이 "로컬 기록+선등록 → setDoc → 성공 시 해소"
│                    순서(⚠️ Firestore는 오프라인에서 reject가 아니라 무한 대기라, await 뒤에 두면 앱 종료 시 유실).
│                    flushPendingSync가 localStorage "현재 값"을 재전송. ⚠️ flush는 반드시 getAllData "이전"에
│                    (순서 바뀌면 Firestore 옛값이 로컬 최신을 덮음 — MainApp Phase 2와 online 이벤트에 배선됨)
├── firebase.js      Firebase 초기화 + App Check(reCAPTCHA v3, VITE_RECAPTCHA_SITE_KEY) + Auth(getAuth)
├── auth.js          Firebase Auth 래퍼(watchAuth·signInWithGoogle·getIdToken·OWNER_EMAIL).
│                    App.jsx/push.js가 firebase/auth를 직접 안 만지는 seam — 테스트는 이 모듈만 mock
├── data.js          기본 음식/운동 DB, DEFAULT_TARGETS, COLORS
├── importMerge.js   워치 사서함 → day 문서 병합(순수). importKey 멱등 — ack 유실·다중 기기에도 중복 없음
├── bodyDraft.js     체성분 사서함 → "완성 대기 초안" 병합·잠금·스윕(순수). bodylog를 절대 쓰지 않는다
│                    (muscle 미입력이 통계를 0으로 오염하지 않는 불변 조건의 구현). 자동 확정도 여기
├── analysisExport.js 클로드 분석 패키지 생성(순수 문자열). 공유 링크 본문도 이 산출물
├── backup.js        JSON 백업/복원(순수). ⚠️ goals.shareLink는 제외한다 — 파일 유출 = 링크 유출
├── shareLink.js     공유 링크 클라이언트 헬퍼(발급·폐기·남은 시간)
├── healthEvents.js  컨디션(부상·질병·휴식) — goals.healthEvents. exclude가 적응형 계산에서 날짜 제외
├── reminders.js     리마인더 판단(순수). 인앱 배너와 밤 8시 크론이 **같은 함수**를 공유
├── bodyMetrics.js   체성분 파생 지표(BMI·체지방량·표준체중 등). ⚠️ 컴포넌트에 인라인 재구현 금지
└── main.jsx         진입점
api/                 서버리스
├── health-import.js  ⌚ 워치 운동 자동 수신 검문소 (X-Import-Token)
├── body-import.js    🧬 체성분 HAE 수신 검문소 (같은 토큰, 별도 함수 = 런타임 격리)
├── import-inbox.js   앱의 사서함 창구(pull/ack) + **인바디 클라우드 직수신**이 여기 편승
├── export-view.js    공유 뷰 SSR (checkOrigin 미적용 — §6-11)
├── share-create/revoke.js · push-sync.js · cron-reminders.js · analyze-{food,exercise,body}.js
└── _lib/             import-rules(운동 규칙 단일 출처) · body-import-rules(체성분 B1~B9) ·
                      inbody-cloud(비공식 API 클라이언트) · body-inbox-store · kv · security ·
                      share-store · verify-auth · verify-uid · sample-state
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

### ★ 적응형 유지칼로리 (실측 TDEE 자동 보정) — 제안형, 2026-07 도입
- **개념**: `BMR×1.05` 고정 기준선 위에, 최근 4주 섭취+추세체중으로 역산한 실측 유지칼로리로 **기준선만** 미세보정. 캘리브레이션 절대값(175·2.2·0.6) 불변, 탄수는 나머지라 자동 흡수(단백질·지방은 체중 함수라 불변).
- **구현**: `calcTargets(...,adjust)`가 `baseMaintenance = BMR×1.05 + adjust`. `adjust`는 `goals.tdeeHistory`([{from,adjust}])에서 `adjustForDate(date)`로 조회. 홈/오늘 = `adjustForDate(today)`, `adaptiveOn` OFF면 0.
- **제안형·되돌리기**: 신뢰도 높음 + 현재 보정과 40kcal↑ 벌어질 때만 제안(설정 목표 탭 카드). [적용]=이력에 {from:today, delta} 추가. 되돌리기 2단계 — ① 토글 OFF=공식 복귀 ② "공식으로 되돌리기"=오늘부터 adjust 0(과거 이력·판정 보존).
- **과거 판정 보존(⚠️ 필수)**: 통계/달력은 `dayTargetK(mode, ds) = targetsByMode[mode].k − appAdjust + adjustForDate(history, ds)`로 **그 날 유효 보정치** 기준 판정 → 보정 적용해도 과거 등급/dot 재칠 없음(§6 "그 날 모드" 원칙의 확장). 체성분 탭은 칼로리 목표 미사용이라 무관.
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

## 3.5. ★ 자동 유입 (2026-08 도입 — 이 앱의 성격을 바꾼 변화)

원래 이 앱은 **모든 데이터가 사용자 손으로만 들어오는 동기 시스템**이었다. 지금은 아니다.
전체 구조·리스크·근거는 `docs/system-audit-2026-08.md`(구조 감사)에 있다. 여기는 요약이다.

### 유입 경로 4종

| 경로 | 트리거 | 인증 | 착지 |
|---|---|---|---|
| 수동 입력 | 사용자 조작 | Firebase Auth | `day:*` / `bodylog` 확정 |
| ⌚ 워치 운동 | iOS 단축어·HAE가 POST | `X-Import-Token` | KV 사서함 → 앱 pull → `day.exercises`에 **확정**(`source:"watch"`) |
| 🧬 체성분 HAE | 별도 단축어가 지표 POST | 같은 토큰 | KV 사서함 → **초안**(`body-drafts`) |
| 🧬 인바디 클라우드 | **앱이 사서함을 pull할 때 서버가 능동 호출** | 인바디 계정 ID/PW(env) | 사서함 → 초안 → 4종 완비 시 **자동 확정**(`auto:true`) |

**서버는 Firestore 자격증명을 갖지 않는다.** 검문소는 KV 사서함까지만 쓰고, day/bodylog 문서를
쓰는 주체는 앱 하나로 유지된다 — 그래서 유효목표·판정·통계가 수동 입력과 같은 단일 경로로 흐른다.

### ⚠️ 비공식 API 의존 (가장 중요한 리스크)

`api/_lib/inbody-cloud.js`는 **인바디 앱 트래픽을 모사한다** — 하드코딩된 AppVersion(`2.8.31_914`)·
기기명(Pixel 6 Pro)·UA(okhttp/Dalvik)·엔드포인트 경로. 공개 API가 아니므로 **인바디가 언제
바꿔도 이상하지 않다.** 깨지면 자동 확정이 멈추고 HAE(3종)+수동 폴백으로 내려간다.

- 전역 `fetch`를 쓰지 말 것 — Node의 fetch가 브라우저 지문 헤더를 자동 주입해 `ID_BLOCK`을 유발한다.
  `node:https.request`를 직접 쓰는 이유가 그것이다(파일 상단 주석 참조).
- **감사 중에도 실계정 로그인 금지** — 인바디는 3회 실패로 계정을 잠근다. 테스트는 전부 모킹.
- 계정 잠금 방어 3중: 동시 실행 선점(`SET NX`) · 연속 실패 상한 3 · 인증 실패 1회 즉시 봉인(24h,
  크리덴셜 지문에 묶여 env 수정 시 자동 해제). **이 방어를 약화시키지 말 것.**

### 저장소

- **KV**(서버 전용): `import:inbox`·`import:seen`(TTL 없음 = insert-only의 근거)·`import:log` /
  `import:body-inbox`·`import:body-seen`·`import:body-log` / `import:body-cloud-{at,fail,authblock,lock}` /
  `push:*` / `share:{token}`(TTL 1h~7d)
- **Firestore**: `users/{uid}/data/{day:*, bodylog, body-drafts, goals, profile, …}` — 규칙은 **경로 단위**
  (`isSelf && isMember`)이고 필드 검증은 없다. 즉 `auto:true`는 클라이언트가 붙이는 값이다(본인 데이터 한정).
- **localStorage**: `dt_{uid}_*` 미러 + `dt_pendingSync_{uid}`(재전송 큐) + `dt_tombstones_{uid}`(삭제 흔적)

### 소비처 — 이 데이터를 읽어 무언가를 산출하는 곳 (14)

| # | 소비처 | 무엇을 읽고 무엇을 만드나 |
|---|---|---|
| 1 | 홈 요약·도넛·진행바·NetCalCard·식단 팁 | 선택일 `day` + 그 날짜 목표 → 잔여·신호등 |
| 2 | 링 캘린더 일별 dot | `allDays` + 컨디션 → 링 진행률·적자/초과·😴 |
| 3 | 주간 성적표 / 4 8주 등급 트렌드 | `allDays` 7일×N → pHit/dHit/eHit·등급(A+~F) |
| 5 | 기간 요약 + 코멘트 | `bodyLog` + 같은 기간 `allDays` → 체중/체지방/골격근 델타 |
| 6 | 패턴 분석 / 7 인사이트 | 주 단위 그룹 → 음식·운동 효과, 이상치, 상관관계 |
| 8 | 커뮤니티 챌린지 | 이번 주 단백질·운동 횟수 → 달성률 |
| 9 | 체성분 탭 (차트·측정 사이 요약·초안 카드) | `bodyLog` + `bodyDrafts` → 추이·AI 코칭 입력 |
| 10 | **운동 스트릭 도장** | `exercises.length`만 → 연속일 (⚠️ 휴식일 도장을 보지 않는다) |
| 11 | 섭취 밴드 차트 / 요일 레이더 | `allDays` 전 기간 → 일별 섭취선·요일별 소모 |
| 12 | **적응형 TDEE 카드·제안** | `bodyLog`(28일 회귀) + `allDays` → 실측 유지칼로리·보정 제안 |
| 13 | **분석 패키지 / 공유 링크** | 전부 → 마크다운 문서 (공유 링크는 이 산출물의 스냅샷) |
| 14 | **크론 푸시** | KV `push:state` + 수신 로그 → 리마인더·주간 성적표·침묵 알림 |

전수·근거는 감사 문서 §0-3. **초안(`bodyDrafts`)을 읽는 곳은 9와 백업 둘뿐이다** — 통계·내보내기에
넣지 말 것(불변 조건 1).

### 소급 전파 — 늦게 도착한 기록이 무엇을 바꾸나

```
체성분 자동 확정 1건 → 그 달 평균 체중 → 목표 kcal·매크로 → 판정(✓/✗) → 달성률·주간 성적표
                    → 추세 회귀 기울기 → estimateTDEE → 적응형 보정 제안
운동 자동 수신 1건   → 소모 kcal → 되먹기 → 유효목표 → 판정 / 휴식일 도장 자동 복귀(>300kcal)
```

**파생값을 저장하는 곳은 5군데뿐이고 나머지는 전부 매번 재계산된다** — 그래서 소급 유입이
자동 반영된다. 저장되는 것: `goals.tdeeHistory`(의도된 이력) · `share:{token}` 스냅샷(설계상 고정) ·
`push:state.weekReport` · `body-coaching` 캐시 · **운동 항목의 kcal·m**(입력 시점 값으로 고정).

### 지켜야 할 불변 조건

1. **초안은 `bodylog` 밖에 산다** — muscle 미입력이 골격근 통계를 0으로 오염시키지 않는 유일한 구조적 보장.
   `draftToRecord`는 `muscle > 0`을 강제한다. 초안을 통계·내보내기에 넣지 말 것.
2. **insert-only(운동)**: `seen` 조회 → 사서함 기입 → `seen` `SET NX` 순서. 순서를 바꾸면
   "도장은 찍혔는데 사서함에 없음"이라는 영구 유실 창이 생긴다.
3. **잠금은 파생 상태다** — `locked` 필드는 없다. 사용자가 편집하면 `auto`·`sampleTs`를 **지워서**
   잠근다(`lockedAgainst` 참조). 수동 입력·카드 확정분도 자동으로 잠긴다.
4. **집합 문서는 덮어쓰지 말 것** — `bodylog`·`body-drafts`는 배열/맵 하나가 문서 하나다. 오프라인
   재전송은 원격과 병합해야 한다(`mergeForFlush`). 통째로 덮으면 다른 기기의 확정분이 사라진다.
5. **판정 기준 체중은 "그 날짜가 속한 달"의 평균** — `makeDayTargets` 단일 출처. 보고 있는 날짜의
   달을 쓰면 같은 과거 날의 ✓/✗가 달력을 넘길 때마다 달라진다.

### 관측성

자동화의 최대 위험은 **고장이 조용하다는 것**이다. 현재 장치:
설정 → 데이터 → ⌚/🧬 카드(최근 수신 20건·클라우드 상태 한 줄) · 밤 8시 크론의 **자동 수신 침묵
알림**(수신 로그의 최신 시각이 5일 이상 조용하면 푸시, `reminders.sync` 토글).

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
| components/ProfileSetup.jsx | ProfileSetup | 온보딩(경로 B): 이름·키·나이·목표체지방 → `data/profile` 저장. 비밀번호 필드는 Auth 대체로 제거. uid 시드 결정적 색상 |
| components/LoginScreen.jsx | LoginScreen | Google 로그인 버튼 + 오류 표시(경로 B 전면 재작성). 프로필 선택·PBKDF2·마스터키 로직 제거 — 인증은 auth.js/Firebase가 전담 |
| components/InviteGate.jsx | InviteGate | 초대 코드 입력(비멤버 로그인 후). 코드 검증은 클라이언트가 아니라 보안 규칙(invites/{code}.active) |

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
10. **공유 뷰 URL은 반드시 경로형(`/export/view/<32자hex>`)을 유지할 것** — 쿼리형(`?t=`)은 외부 AI 리더가 읽지 못한다(2026-07-28 실측: 브라우저·curl은 200, Claude 웹 리더만 404 — 쿼리스트링이 유실되어 토큰 없는 요청으로 처리됨). 쿼리형은 하위호환으로만 남겨두고(서버는 계속 받음), **신규 링크 발급은 경로형으로만** 할 것 (`shareUrlOf`·`share-create`의 `path`가 단일 출처)
11. **`api/export-view.js`에 `checkOrigin`을 적용하지 말 것** — 외부 리더·주소창 직접 방문은 Origin 헤더가 없어 전부 403이 된다. 대신 토큰 게이트 + rateLimit + noindex/no-store로 통제한다 (파일 상단 주석에도 있으나 여기에도 남긴다)
13. **자동 유입 관련 불변 조건은 §3.5를 먼저 읽을 것** — 초안/bodylog 분리, insert-only 순서,
    잠금이 파생 상태라는 점, 집합 문서 병합, 판정 기준 체중. 이 다섯을 모르고 손대면 조용히 데이터가 샌다
14. **인바디 클라우드에 실제 로그인 시도 금지**(개발·테스트·감사 전부) — 3회 실패로 계정이 잠긴다.
    `pullRecentMetrics`를 모킹할 것. 계정 잠금 방어(선점 `SET NX`·상한 3·1회 봉인)를 약화시키지 말 것
15. **정적 검사는 `eslint src api`** — `src`만 돌리면 서버리스 2,000여 줄이 no-undef 방어 밖에 있게 된다
    (2026-08 감사 R-41에서 확장). 훅(`.claude/hooks/check.mjs`)·CI·`package.json`의 lint가 같은 범위여야 한다
16. **`.env.example`은 실제 env 집합과 어긋나 있다** — `IMPORT_*`·`INBODY_*`·`SHARE_TEST_TOKEN`이
    빠져 있다. 롤백 스위치의 실질 단일 출처는 `docs/inbody-setup.md`와 감사 문서다(백로그 R-31)

12. **`robots.txt`에 `/export` 관련 `Disallow`를 추가하지 말 것** — 검색 노출 차단은 뷰 페이지의 noindex 메타(+`X-Robots-Tag`)가 담당하며, Disallow는 규칙을 지키는 외부 리더의 접근까지 막아 공유 기능을 무력화한다. 초기 기획서 Phase 3 체크리스트에 이 항목이 있었으나 **폐기 확정**. 참고로 `vite.config.js`의 `navigateFallbackDenylist`에 `/^\/export\//`가 있는 이유: 설치된 PWA의 서비스워커가 공유 링크 내비게이션을 앱 화면(index.html)으로 가로채지 않게 하기 위함 — 이것도 제거 금지

## 7. 검증 방법

```bash
npm install && npm run build     # 에러 0 + PWA 산출물(sw.js, manifest.webmanifest 각 1개)
npm test                         # Vitest (CI/비대화형에선 1회 실행, 터미널에선 watch)
npm run dev                      # localhost:5173
```
수동 체크리스트(리팩토링 후): 로그인 → 홈(도넛 3개·섭취바·NetCalCard 신호등) → 식단 탭(추가/어제복사/시간대 그룹) → 운동 탭 → 체성분(차트 기간버튼·AI코칭 버튼 존재) → 통계(주간성적표·기간요약 코멘트·달력 dot) → DB관리/CSV 내보내기.
숫자 스모크 테스트: 체중 77.3/175/42 → K=1570, P=170, F=46, C=119. 운동 1070 → 목표 2105, 탄수보충 +134.

## 8. 변경 이력

**PR #1~#16 (2026-06까지)** — #1 보안/PWA/문서 4건(MET 미리보기 fix, SW/manifest 일원화, 비번 PBKDF2, README) · #2 시간대 5구간 · #3 칼로리 재설계(실측 보정) · #4 운동 50% 되먹기 · #5 지방 0.6(탄수 정상화) · #6 적자판정 전화면 통일 · #7 체성분 차트 기간선택+날짜비례 · #8 NetCalCard 보정섭취+막대 · #9 통계 스파크라인 기간반영 · #10 통계 코멘트 식단연계 · #11 매크로 스마트안내(→#13에서 제거) · #12 어제복사 시간유지 · #14 개별=현재/전체=어제시간 · #15 식단탭 섭취합계 · #16 반올림 판정 통일

**#17~#74 (2026-07)** — Firebase Auth + 초대 게이트(경로 B) · 오프라인 재동기화 큐 · JSON 백업/복원 ·
클로드 분석 패키지(analysisExport) · 공유 링크(발급/폐기/경로형 URL) · 진행 사진 · 컨디션 이력 ·
**적응형 유지칼로리**(#79~) · 웹푸시 + 밤 8시 크론 · 휴식일 프리셋(dayType 도장, #71~#74)

**#75~#100 (2026-08) — 자동 유입 3경로**
- #75~#87 ⌚ **워치 운동 자동 수신**: 검문소(health-import) + KV 사서함 + 앱 병합(importMerge) +
  HAE 폴백 파서 + 화이트리스트 실측 대조(근력·쿨다운 편입, 오인 수입 차단)
- #88 🧬 **체성분 HAE 수신**: C안(완전 격리 초안 저장소) — body-import + bodyDraft
- #89~#96 🧬 **인바디 클라우드 직수신**: 골격근·인바디점수까지 무접촉 자동 확정.
  ID_BLOCK 대응(node:https + 서울 리전) · 계정 잠금 방어 · 관측성(상태 한 줄·크리덴셜 형태 로그)
- #97~#100 하루 종일 최신 채택(B1 완화) · 초안 버리기 · 본문 상한 4MB(GPS 경로 대응)

**2026-08 구조 감사** (`docs/system-audit-2026-08.md`) — 축 A~S 19개 전수 + 시나리오 S1~S14.
P0 2건·P1 10건 수정: 클라우드 선점 원자화 · 재전송 병합(유실 차단) · 토큰 brute-force 상한 ·
분석 계약의 출처/측정 규칙 전달 · 부위 구성비 정정 · 침묵 감지 · 공유 토큰 유출·부활 차단 ·
시간 예산 · 판정 기준 체중 고정 · 이 문서 갱신. P2 25건·P3 13건은 감사 문서에 백로그로 남아 있다.

## 9. 운영 규칙

- 개발 브랜치에서 작업 → 커밋(한국어, 배경+이유 포함) → push → **PR 생성 → head sha 확인 후 머지** (#3에서 stale head 머지 사고 있었음 — 머지 전 head 확인 습관화)
- 머지 = Vercel 자동 배포 = 실사용자 폰에 반영. **빌드 깨진 채 머지 절대 금지**
- 사용자는 한국어로 소통, 변경 전 컨셉 미리보기(정적 HTML, JS 없이)를 선호함
