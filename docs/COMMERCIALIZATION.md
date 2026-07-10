# Daniel Body Plan — 상업화 검토 문서

> **목적**: 이 앱의 상업화(판매) 가능성 평가와 실행 로드맵. 새 세션에서 작업을 이어받는
> AI/개발자가 이 문서 하나로 맥락을 복원할 수 있도록 작성.
> **작성일**: 2026-07-08 · **기준 커밋**: main `6a14bfd` (PR #50까지 머지된 상태)
> **선행 문서**: `docs/ARCHITECTURE.md` (기술 구조 — 먼저 읽을 것)

---

## 0. 한 줄 결론

**지금 그대로는 판매 불가. "개념"(실측 기반 정직한 캘리브레이션)에는 차별점이 있으나,
상품화는 2~3개월급 전환 작업 + 낮은 시장 성공 확률을 감수하는 결정이다.
추천 경로: B(소수 무료 공유로 반응 검증) → 반응이 진짜일 때만 C(유료화).**

---

## 1. 현재 상태 스냅샷 (2026-07-08)

- **본질**: 사용자 1명(Daniel)을 위한 개인 식단·운동·체성분 PWA. 7개월 실사용 데이터로
  칼로리 상수를 경험적으로 캘리브레이션한 것이 핵심 가치.
- **스택**: React 18 + Vite PWA(vite-plugin-pwa) · Firestore + localStorage(offline-first,
  syncQueue) · Vercel(Hobby, 서버리스 api/ + 하루 1회 크론) · Web Push(VAPID) · recharts.
- **규모**: src 약 6,500줄, 테스트 143개(vitest), 컴포넌트 분리 완료
  (App.jsx 1,764줄 / StatsTab 1,113 / BodyTab 508).
- **주요 기능**: 감량/유지 모드(그날 모드 스탬프) · 적응형 유지칼로리(실측 TDEE 역산,
  제안형·되돌리기) · 컨디션 기록(부상·질병, 계산 제외) · 리마인더(인앱+예약 푸시) ·
  주간 성적표 푸시(월 20:00 KST) · 진행 사진 · JSON 백업/복원 · CSV 열람용 내보내기.

---

## 2. 객관 평가 요약

### 2.1 치명 블로커 (판매 전 반드시 해결)

| # | 블로커 | 코드 위치 / 사실 |
|---|---|---|
| 1 | **보안 모델이 1인용** | `firestore.rules`: `users/{uid}/data/{document=**}` 가 `request.app != null` 만 검사 → **App Check를 통과한 어떤 클라이언트든 타인 데이터 읽기/쓰기 가능**. 진짜 인증(Firebase Auth) 없음 — `LoginScreen.jsx`는 프로필 선택 방식. 유료 고객 2명부터 개인 건강정보 유출 사고. |
| 2 | **개인 캘리브레이션 상수가 하드코딩** | `utils.js calcTargets`: BMR×1.05, 감량 적자 −175, 운동 반영 ×0.5(감량)/×1.0(유지), 단백질 2.2g/kg, 지방 0.6g/kg — 전부 **Daniel의 몸에 7개월간 맞춘 값**이지 보편 공식이 아님. 상품은 사용자별 온보딩 + 적응형 수렴이 필요(§4.C-2). |
| 3 | **인프라 약관·비용** | Vercel **Hobby 플랜은 상업적 사용 금지** → 판매 시작 즉시 Pro($20/월)+ 필수. Firebase Spark 무료 한도(읽기 5만/일 등)는 수백 명 규모에서 초과. 크론도 Hobby는 하루 1회 제한. |
| 4 | **법적 요건 전무** | 건강 데이터 유료 서비스 = 개인정보처리방침·이용약관·(한국) 개인정보보호법 대응 필수. 현재 없음. |

### 2.2 시장 현실

- 다이어트 트래커는 최고 경쟁 카테고리(MyFitnessPal, 삼성헬스, FatSecret, Lose It 등
  거대 무료 앱 + 수백만 건 음식 DB). 이 앱의 음식 DB는 직접 입력 기반 소규모.
- **"일반 칼로리 앱"으로 정면 승부하면 진다.** 니치 포지셔닝만 유효.

### 2.3 판매 가능한 차별점 (진짜 자산)

- **철학**: "공식을 믿지 말고 네 몸의 실측으로 보정하라" — 적응형 TDEE(에너지 밸런스
  역산), 컨디션 기간 계산 제외, 그날 모드 판정(과거 불변). 거대 앱들이 안 주는 것.
- 광고·소셜·게임화 없는 미니멀리즘, PWA(앱스토어 불필요), 오프라인 우선.
- 소구 대상: "숫자에 진심인 소수" (셀프 실험형 감량러, 린매스업/커팅 반복하는 운동인).

---

## 3. 경로 선택지

| 경로 | 내용 | 노력 | 평가 |
|---|---|---|---|
| **A** | 지금처럼 개인 도구 유지 | 0 | ⭐ 이미 목적 달성. 가장 합리적 |
| **B** | 지인·소수 대상 무료 공유 (반응 검증) | ~2주 | 상업화 첫 관문. 아래 §4.B |
| **C** | 니치 유료 상품화 | 2~3개월+ | B에서 반응 확인된 경우만. §4.C |
| **D** | 포트폴리오/오픈소스 공개 | ~1주 | 개발 역량 증명용으로 훌륭 |

**의사결정 규칙**: C는 B를 건너뛰고 시작하지 말 것. B에서 "돈 내겠다"는 사람이
실제로 나타나는지가 유일하게 믿을 수 있는 신호.

---

## 4. 실행 체크리스트

### 4.B 경로 B — 멀티유저 전환 (소수 공유, ~2주)

> **2026-07-08 구현 완료** (브랜치 `claude/daniel-tracker-commercialization-uj2nxs`).
> 실배포는 Firebase 콘솔 작업이 병행돼야 함 — **`docs/DEPLOY-PATH-B.md`의 순서를 따를 것.**

1. ✅ **Firebase Auth 도입** — Google 로그인 (popup + 불가 환경 redirect 폴백)
   - `LoginScreen.jsx` 전면 재작성 (프로필 선택·PBKDF2·마스터키 제거), `src/auth.js` 신설(테스트 seam)
   - uid 배선: `watchAuth` → `setUserId(authUser.uid)` — store의 localStorage 캐시 구조는 유지(offline-first)
   - Daniel 데이터 마이그레이션: `store.migrateFrom` 강화(진행사진 서브컬렉션 + 미동기화 로컬 승계) +
     운영자 전용 "기존 데이터 가져오기" 메뉴
2. ✅ **Firestore 규칙 강화** — App Check + `request.auth.uid == uid` + 멤버 게이트
   - `_shared` 처리: 프로필 목록 **삭제**(Auth 대체, 콘솔에서 문서 제거 필요), 공용 음식/운동 DB는
     **멤버 읽기 전용 + 운영자만 쓰기** (지인 추가분은 개인 DB로 — `keepAnalyzedFood/Ex`)
3. ✅ **푸시 개인화**: Auth uid로 자연 전환 + `api/push-sync.js`에 **Firebase ID 토큰 검증** 추가
   (uid 사칭 차단). `VAPID_SUBJECT` 교체는 배포 시 Vercel env 작업(체크리스트 §5)
4. ✅ **하드코딩 정리**: 앱 이름 "Body Plan" 중립화(`APP_NAME`), `api/verify-master.js` 삭제,
   기본 프로필(175/35) → 온보딩 필수 입력(`ProfileSetup` 개편)
5. ✅ **초대 제한**: `invites/{code}` + `members/{uid}` — 코드 유효성을 **보안 규칙이 강제**
   (env 화이트리스트 대신 Firestore 방식 채택: 코드 발급·폐기에 재배포 불필요, 규칙 레벨 차단)

### 4.C 경로 C — 유료화 (B 완료 + 반응 확인 후, +6~10주)

1. **사용자별 캘리브레이션 온보딩** ← 가장 큰 제품 작업
   - 시작 시 Mifflin-St Jeor 표준 공식으로 출발(개인 보정치 0)
   - 기존 **적응형 TDEE 모듈(`adaptiveTDEE.js`)을 전면 승격**: 4주 데이터가 쌓이면
     자동으로 개인 보정 제안 → "Daniel의 상수"가 아니라 "각자의 상수"를 찾아주는
     것이 곧 상품의 핵심 스토리가 됨
   - 운동 반영률(×0.5/×1.0)·단백질 g/kg도 프리셋+조정 UI로
2. **결제**: Stripe(글로벌) or 토스페이먼츠(국내). 구독 게이트는 Firestore 커스텀
   클레임 or 결제 상태 문서로
3. **법무**: 개인정보처리방침·이용약관·건강 조언 면책 문구("의료 조언 아님")
4. **인프라 전환**: Vercel Pro, Firebase Blaze(예산 알람 설정), 크론 분 단위 활용
5. **운영 최소셋**: 오류 모니터링(Sentry), 문의 채널, 계정 삭제(개인정보법 필수)
6. **가격 가설**: 국내 니치 기준 월 3,000~5,000원 or 연 3만원대 — B 반응으로 검증

### 4.D 경로 D — 공개용 정리 (~1주)

- 시크릿/개인정보 스캔(커밋 이력 포함), README 영문화, 데모 모드(가짜 데이터),
  라이선스 선택. **주의**: Firebase 설정값은 공개돼도 되지만 규칙 강화(§4.B-2) 선행.

---

## 5. 새 세션 작업 관례 (이 레포의 규칙 — 반드시 준수)

1. **절대 규칙**: `calcTargets`의 칼로리·매크로 상수(BMR×1.05, −175, ×0.5/×1.0,
   2.2g/kg, 0.6g/kg, 7700kcal/kg)는 **Daniel 개인용 앱인 동안은 절대 변경 금지**.
   상품화(C-1)에서 "사용자별 값"으로 일반화할 때도 Daniel 계정의 기존 값은 보존.
2. 판정은 `Math.round` 기준, 과거 날짜 판정은 그날 스탬프(mode·adjust) 보존.
3. **워크플로**: UI 변경은 프리뷰 먼저(정적 HTML을 `previews/`에 커밋 →
   htmlpreview 링크, 구현 시 net-zero 제거 / 또는 Vercel Preview) → 사용자 선택 →
   구현 → lint+test+build 검증 → 브랜치 푸시 → **사용자 확인 후** PR·머지.
   PR 머지 전 head sha 일치 확인. 커밋 메시지는 한국어(배경+이유).
4. 사용자와 한국어로 소통, 애매한 설계는 반드시 몇 가지 안으로 물어볼 것.
5. 테스트 143개(2026-07-08 기준)가 안전망 — 순수 로직 변경 시 테스트 먼저.

## 6. 참고 파일 맵

| 영역 | 파일 |
|---|---|
| 계산 핵심(불변 상수) | `src/utils.js` (calcTargets·isCalOk·exFeedback·adjustForDate) |
| 적응형 TDEE | `src/adaptiveTDEE.js` (+ `components/AdaptiveTdeeCard.jsx`) |
| 저장/동기화 | `src/store.js` · `src/syncQueue.js` · `firestore.rules` |
| 인증(현 프로필 방식) | `src/components/LoginScreen.jsx` |
| 푸시/크론 | `src/push.js` · `api/push-sync.js` · `api/cron-reminders.js` · `public/push-sw.js` · `vercel.json` |
| 리마인더/성적표 | `src/reminders.js` |
| 컨디션(계산 제외) | `src/healthEvents.js` (+ `components/HealthEvents.jsx`) |
| 백업/복원 | `src/backup.js` (복원은 온라인 전용 가드 있음) |
| 서버 보안 공용 | `api/_lib/security.js` (origin 화이트리스트·rate limit) · `api/_lib/kv.js` |
