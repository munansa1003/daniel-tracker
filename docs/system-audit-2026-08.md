# 시스템 구조 감사 — 자동 유입 3경로 + 적응형 TDEE 도입 후 (2026-08)

> **성격**: 기능 개발이 아니라 **구조 감사(architecture audit)**.
> 지시 프롬프트: `docs/prompts/system-audit-2026-08-prompt.md`
> 감사 대상은 기능이 아니라 **경계와 교차점**이다.

## 감사 진행 상태

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 필독 + 구조 인벤토리 + 전파 그래프 | ✅ 완료 |
| 1 | 감사 축 A~S 전수 조사 | ⏳ 대기 |
| 2 | 시나리오 S1~S14 스트레스 테스트 | ⏳ 대기 |
| 3 | 리스크 레지스터 + 정상 확인 목록 → **승인 대기 지점** | ⏳ 대기 |
| 4 | 승인된 P0/P1 수정 | ⏸ 승인 전 착수 금지 |
| 5 | R1~R4 검증 → PR → 머지 | ⏸ |

**감사 기준 커밋**: `475bed6` (branch `claude/system-audit-2026-08-43ufzv`)
**코드 규모**: `api/` 2,173줄 (21파일) · `src/` 7,553줄 (48파일, 테스트 제외) · 테스트 35파일

### 문서 무결성 확인 (Phase 0 착수 전)

- 섹션 헤더 13개 (H1 1 + H2 10 + H3 2) — 프롬프트 원문과 일치
- **감사 축 19개 (A~S)** — 신규 8(A~H) + 기존 10(I~R) + 구조 부채 1(S)
- **시나리오 14개 (S1~S14)**
- 마지막 줄: `- [ ] CI 녹색 · 프리뷰 확인 후 머지`
- ⚠️ **원문 내부 불일치 1건**: H2 제목·「진행 방식」 Phase 1은 "A~R"이나, 본문에 S가 존재하고 「완료 기준」·R1은 "A~S"를 요구. → **A~S 19축 전수**로 진행한다.

---

# Phase 0 — 구조 인벤토리

## 0-1. 데이터 유입 경로 전수 (6경로)

원래 이 앱은 **모든 데이터가 사용자 손으로만 들어오는 동기 시스템**이었다(P1·P2). 지금은 P3~P5가 비동기로 추가됐고, 그중 P5는 **제3자 비공식 API에 계정 크리덴셜로 로그인**해 당겨온다.

| ID | 경로 | 트리거 | 인증 | 빈도 | 최종 착지 형태 | 진입점 |
|---|---|---|---|---|---|---|
| **P1** | 수동 식단·운동 | 사용자 조작 | Firebase Auth(클라이언트) | 임의 | `day:{YYYY-MM-DD}` 확정 | `src/App.jsx:303`(addMeal)·`:317`(addExercise) → `saveDay` `:282` |
| **P2** | 수동 체성분 | 사용자 조작 | Firebase Auth | 임의 | `bodylog` 확정 (**auto 없음 → 영구 잠금**) | `src/App.jsx:332` addBody |
| **P2'** | 초안 수동 확정 | 사용자가 골격근 입력 | Firebase Auth | 초안 있을 때 | `bodylog` 확정 (`source:"import"`, auto 없음) | `src/App.jsx:357` confirmBodyDraft → `src/bodyDraft.js:101` draftToRecord |
| **P3** | **워치 운동 자동 수신** | iOS 단축어/HAE의 POST (운동종료·저녁백업·원탭) | `X-Import-Token` 헤더 = env `IMPORT_TOKEN` | 이벤트 구동(운동 종료 시 등) | KV 사서함 → 앱 pull 시 `day:*`의 `exercises[]`에 **확정 추가**(`source:"watch"`) | `api/health-import.js:34` |
| **P4** | **체성분 HAE 수신** | 별도 단축어의 지표 POST | `X-Import-Token` (P3와 **공용 토큰**) | 이벤트 구동 | KV 체성분 사서함 → **초안**(`body-drafts`) | `api/body-import.js:30` |
| **P5** | **인바디 클라우드 직수신** | **앱 시작 동기화 / "지금 확인" 버튼** 안에서 서버가 능동 pull | 인바디 계정 ID/PW (env `INBODY_LOGIN_ID`·`INBODY_LOGIN_PW`) + 호출자 uid == `IMPORT_UID` | 자동은 30분 스로틀, force는 즉시(실패 3회 미만일 때) | KV 체성분 사서함 → 초안 → **4종 완비 시 자동 확정(`auto:true`)** | `api/import-inbox.js:46` cloudPullIfDue ← `:167` |

**부수 경로(데이터 유입은 아니나 상태에 관여)**

| 경로 | 트리거 | 인증 | 대상 |
|---|---|---|---|
| 앱 pull/ack | 앱 시작·"지금 확인" | Firebase idToken 검증(`api/_lib/verify-uid.js`) + `checkOrigin` | KV 사서함 읽기/HDEL |
| 푸시 상태 동기 | pushState 변화 시 | Firebase idToken | `push:state:{uid}` |
| 크론 알림 | Vercel Cron `0 11 * * *` (=20:00 KST) | `CRON_SECRET` Bearer | KV 읽기 → web-push 발송 |
| 공유 링크 발급/열람 | 사용자 발급 / 외부 리더 GET | 발급=idToken, 열람=32자 hex 토큰 | `share:{token}` (TTL 1h/24h/7d) |
| 백업 복원 | 사용자 파일 선택 | Firebase Auth | 전 키 덮어쓰기 `src/App.jsx:576-582` |

### P5의 프로토콜 의존 (Axis A의 근거)

`api/_lib/inbody-cloud.js`는 인바디 안드로이드 앱 트래픽을 **하드코딩으로 모사**한다:

| 모사 요소 | 값 | 근거 |
|---|---|---|
| AppVersion | `2.8.31_914` | `inbody-cloud.js:28` |
| 기기명 | `Google Pixel 6 Pro` / `DeviceType: "Pixel 6 Pro 14"` | `:28`, `:158` |
| UA(로그인) | `okhttp/4.12.0` | `:30` |
| UA(조회) | `Dalvik/2.1.0 (…Pixel 6 Pro…)` | `:31` |
| 엔드포인트 | `/CommonAPI/GetCountryInfoV2` → `/V2/Main/GetLoginWithSyncDataPartV2` → `/V2/InBody/GetInBodyData` | `:146`, `:155`, `:173` |
| 동기화 센티넬 | `1990-01-01 11:11:11` | `:23` |
| 전송 스택 | **`node:https` 직접**(전역 fetch 금지 — 브라우저 지문 헤더가 `ID_BLOCK`을 유발) | `:95-101` |

응답 파싱 필드: `BCA.WT`(체중)·`MFA.PBF`(체지방률)·`BCA.FFM`(제지방)·`MFA.SMM`(골격근)·`WC.FS`(인바디 점수)·`DATETIMES`(로컬 벽시계 문자열) — `:64-68`, `:59`.

## 0-2. 저장소 인벤토리

### (a) Upstash KV — 서버 전용

| 키 | 자료형 | 용도 | TTL | 쓰는 곳 | 읽는 곳 |
|---|---|---|---|---|---|
| `import:inbox:{uid}` | Hash | 운동 사서함 (field=importKey) | 없음 (앱 ack 시 HDEL) | `health-import.js:128` | `import-inbox.js:151`, HDEL `:212` |
| `import:seen:{uid}:{importKey}` | Str | 운동 접수 도장 (insert-only 근거) | **없음(영구)** | `health-import.js:129` (`SET NX`) | `:126` |
| `import:log:{uid}` | List | 운동 수신 요약 (LTRIM 20건) | 없음 | `health-import.js:140-143` | `import-inbox.js:160` (최근 5건) |
| `import:body-inbox:{uid}` | Hash | 체성분 사서함 (field=`{date}\|{sampleTs}`) | 없음 (ack 시 HDEL) | `body-inbox-store.js:16` | `import-inbox.js:173`, HDEL `:213` |
| `import:body-seen:{uid}:{date}\|{sampleTs}` | Str | 체성분 접수 도장 | **없음(영구)** | `body-inbox-store.js:17` (`SET NX`) | `:14` |
| `import:body-log:{uid}` | List | 체성분 수신 요약·오류 (LTRIM 20건) | 없음 | `body-inbox-store.js:29`,`:40` | `import-inbox.js:182` (최근 5건) |
| `import:body-cloud-at:{uid}` | Str | 클라우드 pull 스로틀 도장 | **없음** | `import-inbox.js:75` (**`SET` — NX 아님**) | `:72` |
| `import:body-cloud-fail:{uid}` | Str | 연속 실패 카운터 (상한 3) | **없음** | `:88`(리셋), `:99`(증가) | `:70` |
| `import:body-cloud-authblock:{uid}` | Str | `{credFingerprint}\|{ISO}` 인증 봉인 | **없음** (24h는 값 내부 시각 비교) | `:102` | `:64-68` |
| `push:uids` | Set | 푸시 구독 uid 목록 | 없음 | `push-sync.js:66` | `cron-reminders.js:37` |
| `push:sub:{uid}` | Str | PushSubscription JSON | 없음 | `push-sync.js:65` | `cron-reminders.js:41` |
| `push:state:{uid}` | Str | `{lastRecordDate,lastWeighDate,lastBackup,accountCreatedAt,weekReport,reminders}` | 없음 | `push-sync.js:78` | `cron-reminders.js:42` |
| `share:{token}` | Str | **분석 패키지 문자열 스냅샷** | **1h/24h/7d** (`share-store.js:22`) | `share-create.js` | `export-view.js:99` |
| `rl:{key}:{ip}` | Str(INCR) | rate limit 카운터 | `windowSec`(=60) | `security.js:58-69` | 동상 |

> 관측: **자동 유입 관련 KV 키 9종 중 TTL이 있는 것은 0개.** `share:*`·`rl:*`만 만료 정책이 있다. → Axis K·Q에서 정량 평가.

### (b) Firestore

| 경로 | 내용 | 규칙 |
|---|---|---|
| `users/{uid}/data/day:{YYYY-MM-DD}` | `{meals[], exercises[], mode?, dayType?}` | `firestore.rules:73-76` — 경로 단위만 검증 |
| `users/{uid}/data/bodylog` | 확정 체성분 배열 `[{date,weight,muscle,fatPct,score,lbm?,sampleTs?,source?,auto?}]` | 동상 |
| `users/{uid}/data/body-drafts` | 완성 대기 초안 맵 `{date:{weight,fatPct,lbm,muscle,score,sampleTs,receivedAt}}` | 동상 |
| `users/{uid}/data/goals` | 모드·리마인더·`tdeeHistory`·`healthEvents`·`shareLink`·`adaptiveOn` | 동상 |
| `users/{uid}/data/{profile,custom-foods,custom-exercises,lastBackup,body-coaching}` | 설정·사용자 DB·AI 코칭 캐시 | 동상 |
| `users/{uid}/data/photos/items/{id}` | 진행 사진 dataURL | 동상 |
| `users/_shared/data/shared-{foods,exercises}` | 공용 DB | 읽기=멤버, 쓰기=운영자 `:65-68` |
| `members/{uid}` · `invites/{code}` | 초대 게이트 | `:44-60` |

> 관측: `users/{uid}/data/{document=**}`는 `allow read, write: if isSelf(uid) && isMember()` **한 줄**이다(`firestore.rules:74`). **필드 수준 검증이 전혀 없다** — `auto`·`sampleTs`·`source`를 포함해 임의 shape 쓰기가 규칙상 허용된다. → Axis P에서 blast radius 판정.

### (c) localStorage (미러 + 메타)

| 키 | 용도 | 비고 |
|---|---|---|
| `dt_{uid}_{dataKey}` | Firestore 값 미러 — **세션 중 최신 진실** | 병합 기준으로 사용 `App.jsx:740`, `:358` |
| `dt_pendingSync_{uid}` | 오프라인 재전송 대기 **키 이름만** | `syncQueue.js` — 값은 전송 시점 localStorage에서 읽음 |
| `dt_currentUser` · `dt_migrated_{uid}` · `dt_{uid}_member` · `dt_{uid}_createdAt` | 세션·마이그레이션·멤버·계정 생성일 메타 | 데이터 프리픽스 밖/안 혼재 |
| `dt_shared_foods` · `dt_shared_exercises` | 공용 DB 캐시 | uid 무관 |

## 0-3. 소비처 전수 (13곳)

| # | 소비처 | 읽는 것 | 산출 | 캐시/저장? | 근거 |
|---|---|---|---|---|---|
| C1 | 홈 요약·도넛·진행바·NetCalCard·식단팁 | 선택일 `day`, `bodyLog`(monthWeight 경유) | 유효목표·잔여·판정 | ❌ 매번 재계산 | `App.jsx:795-805` |
| C2 | 유효목표 `dayTargetK` | `targetsByMode`, `tdeeHistory` | 그 날 목표 kcal | ❌ | `App.jsx:667` · `StatsTab.jsx:16` · `analysisExport.js:74` |
| C3 | 판정 `isCalOk` | 섭취·운동·유효목표·모드 | ✓/✗ | ❌ | `utils.js:64` |
| C4 | 통계 탭 (기간요약·주간 성적표·달력·차트·MA7) | `bodyLog`, `allDays` | 추세·달성률·등급 | ❌ | `StatsTab.jsx` 전역 |
| C5 | 체성분 탭 | `bodyLog`, `bodyDrafts` | 기록 목록·초안 카드·🧬 배지 | ❌ | `BodyTab.jsx:562` |
| C6 | **적응형 TDEE** `estimateTDEE` | `bodyLog`(28일 체중), `allDays`(섭취·운동), `healthEvents` | `delta`(±300 클램프) | ❌ 재계산. 단 **사용자가 "적용"하면 `goals.tdeeHistory`에 영구 기록** | `adaptiveTDEE.js:30` · `App.jsx:663`, `:777-783` |
| C7 | AdaptiveTdeeCard / 보정 제안 | `tdeeEstimate` | 제안 배너(±40kcal 이상 벌어질 때) | ❌ | `App.jsx:670-675` |
| C8 | **AI 분석 패키지** `buildAnalysisPackage` | `allDays`, `bodyLog`, `goals`, `tdeeHistory`, `healthEvents` | 마크다운 문서 | ❌ 생성 시점 계산 | `analysisExport.js:61` |
| C9 | **공유 링크** | C8 산출 문자열 | 외부 리더용 SSR 뷰 | ⚠️ **KV에 스냅샷 저장(최대 7일 화석)** | `share-store.js:39` · `export-view.js:116` |
| C10 | **크론 알림** | `push:state:{uid}` (앱이 올린 값) | 리마인더·주간 성적표 푸시 | ⚠️ **KV 저장 — 앱을 열어야 갱신** | `cron-reminders.js:51-67` |
| C11 | 인앱 리마인더 배너 | `allDays`, `bodyLog`, `lastBackup` | 배너 | ❌ | `App.jsx:609-614` |
| C12 | **백업 JSON** | `allDays`, `bodyLog`, `goals`, `bodyDrafts`, 커스텀DB | 복원 가능 파일 | 파일로 고정 | `backup.js:15` |
| C13 | AI 코칭(analyze-body) | `bodyLog` | 코칭 텍스트 | ⚠️ `body-coaching` 키에 저장 | `App.jsx:148` |

> **파생값을 저장·캐시하는 코드 (Axis M 사전 식별) — 4곳**: C6의 `tdeeHistory`(의도된 이력) · C9 공유 스냅샷 · C10 `push:state.weekReport` · C13 코칭 캐시.
> 나머지 전부는 매번 재계산이라 소급 유입이 자동 반영된다.

## 0-4. 전파 그래프

### 사슬 (a) — 체성분 자동 확정 1건 → 칼로리 목표까지

```
[P5] 인바디 클라우드 측정 1건 (WT/PBF/FFM/SMM/FS)
  │  inbody-cloud.js:54 scanToSamples → :81 scansToMetricsPayload
  ▼
검문 planBodyImport  body-import-rules.js:96
  │  B4 소수형·B5 단위/범위·B7 컷오버 통과 · B1 시각 상한은 MORNING_END_HOUR=24라 무효화(:42,:156)
  ▼
KV 사서함 import:body-inbox  body-inbox-store.js:16   (key = `{date}|{sampleTs}`)
  ▼
앱 pull  App.jsx:728 → mergeBodyDrafts  bodyDraft.js:54
  │  잠금 판정 lockedAgainst :48 — 수동/편집분(auto 없음)은 잠금, 자동 확정분은 더 최신이면 갱신
  ▼
초안 body-drafts
  ▼
autoConfirmDrafts  bodyDraft.js:125   ← muscle>0 && weight>0 && SMM/LBM 0.53~0.61 통과
  ▼
bodylog 레코드 { …, auto:true, sampleTs, source:"import" }   :141
  │
  ├─▶ monthWeight (선택 날짜가 속한 달의 평균 체중)  App.jsx:642-648
  │     ├─▶ bmr = 10·W + 6.25·H − 5·A + 5            App.jsx:649
  │     └─▶ calcTargets(monthWeight,…,appAdjust)      utils.js:71 → targetsByMode  App.jsx:652-659
  │           └─▶ **모든 날짜의 dayTargetK 이동**      App.jsx:667
  │
  └─▶ estimateTDEE(bodyLog, allDays, today, bmr, 28)  adaptiveTDEE.js:30
        │  회귀 기울기 linRegSlope :18 → deltaWeight = slope×28 :51
        │  measuredTDEE = 평균섭취 − deltaWeight×7700/28 :52
        │  measuredMaint = measuredTDEE − 평균운동 :53
        │  delta = clamp(measuredMaint − bmr×1.05, ±300) :55-56
        ▼
      tdeeEstimate.delta  →  제안 배너(신뢰도 높음 && |delta−appAdjust|≥40)  App.jsx:670-675
        ▼  **사용자가 "적용" 클릭해야만**
      goals.tdeeHistory ← { from: 오늘, adjust: delta }   App.jsx:777-783
        ▼
      appAdjust = adjustForDate(tdeeHistory, 오늘)  utils.js:84 · App.jsx:639
        ▼
      dayTargetK(m, ds) = targetsByMode[m].k − appAdjust + adjustForDate(tdeeHistory, ds)
        ▼
      isCalOk(섭취, 운동, dayTargetK, 모드)  utils.js:64
        ▼
      ┌ 홈 판정(C1) · 달력 ✓/✗ · 주간 성적표 · 달성률(C4)
      ├ 월별 집계 적정일 · 일별 요약 판정 (C8 analysisExport:171,:226)
      └ 공유 링크 스냅샷(C9) · 주간 성적표 푸시(C10)
```

**정량 감각 (Phase 1·2에서 정밀 재검산 예정)**: `measuredTDEE = 평균섭취 − slope×7700`. 즉 **회귀 기울기 0.01kg/day 오차 = 목표 77kcal 오차**. ±300 클램프는 약 slope ±0.039kg/day(=28일에 ±1.1kg)에서 포화.

### 사슬 (b) — 운동 자동 수신 1건 → 판정·휴식일 복귀까지

```
[P3] 워치 운동 1건
  ▼ health-import.js:109 planWorkout → classifyType(import-rules.js:68)
    · EXCLUDED → 근력 → 유산소 순 검사. 근력 전 변형은 대표명 "근력 운동"(:48)
  ▼ insert-only: GET seen → HSET inbox → SET NX seen  health-import.js:126-131
  ▼ KV import:inbox
  ▼ 앱 pull → mergeImports  importMerge.js:37  (importKey 멱등 :47)
  ▼ day.exercises[] 에 { n, kcal, duration, ts, hour, importKey, source:"watch" } 추가
  │
  ├─▶ aggregateDay(day).ex  utils.js:130
  │     ├─▶ effectiveDayMode: 휴식일 도장 + 운동 ≤300kcal → "rest", **초과하면 훈련일 공식 자동 복귀**  utils.js:57
  │     ├─▶ 되먹기 carbBonus = 운동×exFeedback(mode)/4  App.jsx:802
  │     ├─▶ effectiveTargetK = 목표K + round(운동×되먹기율)  App.jsx:805
  │     └─▶ isCalOk 판정 변화 → 달력·주간·달성률
  ├─▶ estimateTDEE의 avgExercise(:34-37) → measuredMaint 이동 → 사슬 (a)에 합류
  ├─▶ 운동 구성(주간) 유형 비중  analysisExport.js:183-209 ← **exCategory(e.n)**
  │     ⚠️ exCategory("근력 운동")·("스트레칭") 은 EX_CATS 어느 키워드에도 없어 **"기타"**  analysisExport.js:49-58
  └─▶ pushState.weekReport.workouts  App.jsx:694 → push:state → 월요일 성적표 푸시
```

### 사슬 (c) — provenance(출처)의 생존 경로

| 산출물 | `auto:true` | `sampleTs` | `source:"import"` | 운동 `source:"watch"`/`device` |
|---|---|---|---|---|
| Firestore `bodylog` / `day:*` | ✅ | ✅ | ✅ | ✅ |
| 백업 JSON (`backup.js:15`) | ✅ (배열 통째) | ✅ | ✅ | ✅ |
| 사용자 편집 후 (`App.jsx:343`) | ❌ **삭제됨** | ❌ **삭제됨** | ✅ 잔존 | — |
| 체성분 탭 표시 | ❌ 미표시 | ❌ | ✅ 🧬 배지 (`BodyTab.jsx:562`) | ✅ ⌚ 배지 (`App.jsx:1300`,`:1792`) |
| **analysisExport (C8)** | ❌ **미전달** | ❌ | ❌ **미전달** | ❌ **미전달** |
| **공유 링크 (C9)** | ❌ (C8 산출물이므로) | ❌ | ❌ | ❌ |
| 통계·MA7·adaptiveTDEE 집계 | ❌ **구분 없이 혼입** | — | — | ❌ 구분 없이 혼입 |

> **Phase 1로 넘기는 핵심 관찰**: 자동/수동 구분은 **저장·백업까지는 살아남지만, 분석 계약(analysisExport)과 공유 링크에서 완전히 소실**된다. 또한 B1 완화(하루 종일 최신 채택)라는 **측정 규칙 변경 자체가 분석 계약 어디에도 기록되지 않는다** — `analysisExport.js:113-138`의 "설정 변경 이력"은 `tdeeHistory`와 모드 전환만 담는다. → Axis E④·F③·N④에서 판정.

## 0-5. Phase 1이 반드시 파야 할 지점 (Phase 0 관찰 메모)

Phase 0에서 **코드로 확인했으나 아직 판정하지 않은** 관찰들. Phase 1에서 축별로 재현·정량화한다.

| # | 관찰 | 관련 축 | 근거 |
|---|---|---|---|
| O1 | 클라우드 pull 스로틀 선점이 `SET`이다 — `SET NX`가 아니다. 같은 파일 계열의 `body-inbox-store.js:17`은 `SET…NX`를 쓴다(패턴을 아는데 여기만 다름) | C, J, S2 | `import-inbox.js:75` vs `body-inbox-store.js:17` |
| O2 | 자동 유입 KV 키 9종 **전부 TTL 없음**. `import:seen:*`·`import:body-seen:*`는 영구 증가 | K, S11 | 위 0-2(a) 표 |
| O3 | `pullRecentMetrics`는 순차 3요청, 각 `REQUEST_TIMEOUT_MS=20000` → 최악 60초. `import-inbox`의 `maxDuration`은 **30초** | D, S4 | `inbody-cloud.js:103`,`:182-185` · `vercel.json` |
| O4 | 운동 카드 "지금 확인" 버튼에 `syncingImports` 가드가 없다(체성분 카드 `:2089`에는 있음). 둘 다 같은 `force:true`를 보내 클라우드 pull을 유발 | C③, S6 | `App.jsx:2057` vs `:2089` |
| O5 | `MORNING_END_HOUR=24` → `hour >= 24`는 hour∈0..23에서 절대 참이 아님 = 시각 창 완전 개방 | F | `body-import-rules.js:42`,`:156` |
| O6 | `credShape`(ID 길이+앞 3자, PW 길이)가 `import:body-log`에 기록되어 **pull 응답으로 클라이언트에 전달**되고 설정 카드에 표시됨 | B, P | `import-inbox.js:96`,`:111` → `:190`(bodyLog) → `App.jsx:2097` |
| O7 | `firestore.rules`는 `users/{uid}/data/**`에 필드 검증이 전혀 없음 → 클라이언트가 `auto:true` 위조 가능 | P | `firestore.rules:73-76` |
| O8 | ESLint 활성 규칙 3개(`no-undef`·`jsx-no-undef`·`rules-of-hooks`)뿐 → `no-dupe-keys` 미적용. 실제로 `bodyCloudEnabled` 중복 키가 게이트를 통과해 있음 | S | `eslint.config.js:19-21` · `App.jsx:736-737` |
| O9 | `exCategory("근력 운동")`·`("스트레칭")` → "기타". 워치 근력 자동 수신 이후 주간 구성비 표의 상체/하체/코어가 0%가 되며, 그 사실을 문서가 경고하지 않음 | N②, F③ | `analysisExport.js:49-58`,`:194-206` |
| O10 | `store.set`은 **키 단위 last-write-wins**(병합 없음). `bodylog`가 배열 전체 1문서라 두 기기 경합 시 통째 덮어쓰기 | J, M, S2 | `store.js:253-269` |
| O11 | `push:state`(주간 성적표 포함)는 앱이 열려야 갱신 → 소급 유입이 크론 푸시에 반영되지 않는 화석 창 | M, Q, S10 | `App.jsx:710` · `cron-reminders.js:65` |
| O12 | `.env.example`에 `IMPORT_TOKEN`·`IMPORT_UID`·`IMPORT_CUTOVER_DATE`·`IMPORT_BODY_CUTOVER_DATE`·`INBODY_LOGIN_*`·`INBODY_COUNTRY`·`IMPORT_TZ_OFFSET`·`SHARE_TEST_TOKEN`이 **하나도 없다**. 롤백 스위치가 어디에도 목록화돼 있지 않음 | R, A, S | `.env.example` 전문 |
| O13 | HAE 경로와 클라우드 경로는 사서함 키가 `{date}\|{sampleTs}`라 **타임스탬프가 1초만 달라도 둘 다 accepted** | H, S8 | `body-import-rules.js:171` |
| O14 | 자동 확정 후 초안이 삭제되므로(`bodyDraft.js:144`), 더 늦은 sampleTs의 muscle 없는 샘플이 오면 잠금이 풀려 **muscle 없는 초안이 다시 생성**되고 자동 확정 조건(`:133`)을 못 채워 잔류 | E, H, S8 | `bodyDraft.js:133`,`:138`,`:144` |
| O15 | 운동 자동 수신의 **침묵을 감지하는 장치가 없다**. 체성분은 `pendingReminders`의 7일 체중 리마인더가 간접 감지 역할을 함 | Q, S10 | `reminders.js:27-30` |

---

<!-- Phase 1 이후 산출물은 이 아래에 append -->
