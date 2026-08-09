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
**코드 규모**: `api/` 2,173줄 (21파일) · `src/` 7,553줄 (48파일, 테스트 제외) · 테스트 34파일 (+ 픽스처 2)

### 문서 무결성 확인 (Phase 0 착수 전)

- 섹션 헤더 13개 (H1 1 + H2 9 + H3 3) — 프롬프트 원문과 일치
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

## 0-3. 소비처 전수 (14곳)

| # | 소비처 | 읽는 것 | 산출 | 캐시/저장? | 근거 |
|---|---|---|---|---|---|
| C1 | 홈 요약·도넛·진행바·NetCalCard·식단팁 | 선택일 `day`, `bodyLog`(monthWeight 경유) | 유효목표·잔여·판정 | ❌ 매번 재계산 | `App.jsx:795-805` |
| C2 | 유효목표 `dayTargetK` | `targetsByMode`, `tdeeHistory` | 그 날 목표 kcal | ❌ | `App.jsx:667` · `StatsTab.jsx:16` · `analysisExport.js:74` |
| C3 | 판정 `isCalOk` | 섭취·운동·유효목표·모드 | ✓/✗ | ❌ | `utils.js:64` |
| C4 | 통계 탭 (기간요약·주간 성적표·달력·차트) | `bodyLog`, `allDays` | 추세·달성률·등급 | ❌ | `StatsTab.jsx` 전역 |
| C4' | 운동 스트릭 도장 | `allDays[*].exercises.length` | 연속일·최장·최근 7칸 | ❌ | `WorkoutStamp.jsx:12-30` |

> **정정 (Phase 1에서 발견)**: 최초 작성 시 C4에 "MA7"을 넣었으나 **틀렸다.**
> `calcMovingAvg`(`utils.js:139`)는 **어느 파일도 import하지 않는 죽은 코드**다(`src`·`api`·`bench` 전수 grep — 정의부 1건뿐).
> 이 앱에 7일 이동평균 소비처는 존재하지 않는다. 체중 추세를 만드는 것은 BodyTab의 원시 선그래프와
> `adaptiveTDEE`의 회귀 기울기(`linRegSlope`)다. 따라서 프롬프트가 여러 축에서 묻는 "MA7 영향"은
> **모두 회귀 기울기 영향으로 읽어야 한다**(축 F②·G①의 정량표가 그것이다).
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

---

# Phase 1 — 감사 축 A~S 전수 조사

**표기**: ✅ 문제없음 · ⚠️ 결함 · ❓ 미확인(재현 경로 확보 실패)
**검증 방식**: 순수 계층은 실제 모듈을 import해 실행, 서버리스는 **실제 핸들러**(`api/import-inbox.js`)를
in-memory KV로 구동. 인바디 클라우드에는 **실제 로그인을 한 번도 시도하지 않았다**(전부 모킹 — 금지사항 준수).

## 신규 위험 (A~H)

### A. 제3자 비공식 API 의존 ⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| 프로토콜·앱 버전 정책이 바뀌면? | `postJson`이 throw → `cloudPullIfDue` catch → `bodyCloudStatus:"failed"` + KV 로그 1줄. **자동 유입만 조용히 멈춘다** | `inbody-cloud.js:124-134` · `import-inbox.js:91-105`,`:167-168` |
| 조용히 실패하나, 사용자가 알아채나 | ⚠️ **능동 알림 없음.** 설정 → 데이터 → 🧬 카드를 열어야 보인다. 유일한 간접 신호는 7일 뒤 "체중 잴 시간" 푸시(체중 유입이 멈춰 `lastWeighDate`가 안 갱신되므로) | `App.jsx:2072-2112` · `reminders.js:27-30` |
| HAE가 살아있는 폴백인가 | ✅ **살아있다.** `INBODY_LOGIN_*`만 지우면 클라우드만 꺼지고 HAE·운동은 유지됨을 실제 핸들러로 확인. 문서상 자동화 C가 상시 운영 | 감사 테스트 `[R①]` · `docs/inbody-setup.md:130-136` |
| 단, 폴백의 성능 | ⚠️ HAE는 **3종만**(골격근·점수 없음) → 클라우드가 죽으면 자동 확정이 멈추고 "초안 + 수동 골격근 입력" 모드로 격하. 문서화됨 | `inbody-cloud.js:3-5` · `docs/inbody-setup.md:22-27` |
| 의존이 문서화됐나 | 부분 ✅/⚠️ — `docs/inbody-setup.md:37` "비공식 API라 언제든 깨질 수 있음"은 있다. **그러나 인수인계 문서 `docs/ARCHITECTURE.md`에는 자동 유입 3경로가 한 줄도 없다** — §2 파일 구조에 `bodyDraft.js`·`importMerge.js`·`inbody-cloud.js`·`health-import.js`·`body-import.js`·`import-inbox.js` 전부 누락, §8 변경 이력은 PR #16까지(현재 #100) | `docs/ARCHITECTURE.md:24-50`,`:188` |

### B. 크리덴셜 보안·blast radius ✅⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| ① 값이 새는 경로 | ✅ **값은 새지 않는다.** `credShape`는 `ID 11자(010…) · PW 10자` 형태만 남긴다. 감사 테스트로 `secret1234`가 응답에 없음을 확인 | `import-inbox.js:111-113` · 테스트 `[B①]` |
| ①' 다만 노출 지점 | ⚠️ 그 "형태"가 `import:body-log` → pull 응답 `bodyLog` → 설정 카드까지 나간다. 의도된 진단 창구이나 **응답 계약에 크리덴셜 파생 정보가 실린다**는 사실은 기록돼 있지 않다 | `import-inbox.js:96` → `:190` → `App.jsx:2097` |
| ② 다른 코드가 env를 읽나 | ✅ `process.env.INBODY_LOGIN`을 읽는 파일은 **`api/import-inbox.js` 단 1곳** | 테스트 `[B②]` |
| ③ JWT는 어디 남나 | ✅ **아무 데도 안 남는다.** `pullRecentMetrics` 지역변수로만 살고 반환값은 `{payload, scanCount}`뿐. KV 덤프에 토큰 흔적 없음 확인 | `inbody-cloud.js:181-186` · 테스트 `[B③]` |
| ③' 부수 효과 | ⚠️ 토큰(24h)을 캐시하지 않아 **pull마다 새로 로그인**한다. 30분 스로틀이 상한이라 하루 최대 ~48회 로그인 | `inbody-cloud.js:182-184` |
| ④ 탈취 시 blast radius | ⚠️ 인바디 계정 전체 측정 이력 + 계정 자체. env는 Vercel Sensitive지만 **탈취 시 무엇이 열리는지가 어느 문서에도 없다** | `docs/inbody-setup.md:101-103` |

### C. 계정 잠금 방어의 실효성 ⚠️ — **최우선**

| 질문 | 판정 | 근거 |
|---|---|---|
| ① 스로틀 선점이 `SET`인가 `SET NX`인가 | ⚠️ **`SET`이다.** GET→SET 사이가 열려 있어 동시 요청 2건이 **둘 다 통과**하고 로그인을 2번 시도한다. 실제 핸들러로 재현 | `import-inbox.js:72-75` · 테스트 `[C①]` |
| ①' 실효 영향 | ⚠️ 비밀번호가 틀린 상태에서 동시 pull 2건 → **봉인이 걸리기 전에 3-strike 중 2개를 한 번에 소모.** 순차였다면 1개만 소모(대조 테스트로 확인) | 테스트 `[S2]`·`[대조]` |
| ①'' 같은 저장 계층은 올바르다 | 대조: `storeBodyEntries`는 `SET … NX`를 쓴다 — 패턴을 아는 코드베이스에서 **스로틀만 빠졌다** | `body-inbox-store.js:17` |
| ② 봉인 키 쓰기 실패 시 | ⚠️ `try { await kv("SET", authBlockKey…) } catch { /* 무시 */ }` — KV 오류면 **봉인이 안 걸린 채 조용히 지나가고** 다음 force가 다시 로그인 | `import-inbox.js:100-103` · 테스트 `[C②]` |
| ③ "지금 확인"의 실제 상한 | ✅ 일시 오류 **3회**, 인증 실패 **1회**로 봉인. 연타 10회 시뮬레이션으로 확인 | 테스트 `[S6]` ×2 |
| ③' 단, 버튼 가드 비대칭 | ⚠️ 체성분 카드 버튼은 `syncingImports` 가드가 있으나 **운동 카드 버튼(`App.jsx:2057`)에는 없다.** 둘 다 같은 `force:true`를 보내므로 운동 버튼 연타가 클라우드 로그인을 유발하고 ①의 동시 요청을 만든다 | `App.jsx:2057` vs `:2089` |
| ④ 방어 키 유실 시 | ⚠️ `failKey`·throttle이 사라지면 카운터가 초기화돼 **다시 3회까지 두드린다**. 이 키들에는 TTL이 없어 자연 만료는 없으나 KV 장애·삭제 시 재현 | 테스트 `[S11]` |
| 보너스 | ✅ 크리덴셜을 고치면 지문이 바뀌어 **봉인이 즉시 해제**된다(24h 대기 불필요) | 테스트 `[C]` |

### D. 앱 시작 경로의 외부 네트워크 ⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| ① 인바디가 느리면 앱 시작 동기화가 지연되나 | ⚠️ **그대로 지연된다.** 300ms 지연을 주입하니 pull 응답이 정확히 그만큼 늦어짐. `pullRecentMetrics`는 순차 3요청 × 타임아웃 20초 = **최악 60초**, 함수 `maxDuration`은 **30초** → 504로 pull 전체 실패 | `inbody-cloud.js:103`,`:182-185` · `vercel.json` · 테스트 `[D①③]` |
| ② 운동 사서함 병합까지 막나 | 논리적으로는 ✅ **격리됨**(try/catch로 감싸 실패해도 `entries` 정상 반환 — 테스트로 확인). 시간적으로는 ⚠️ **격리 없음** — 함수가 타임아웃으로 죽으면 앱은 `if (!r.ok) return`이라 그 세션의 운동 병합도 못 한다 | `import-inbox.js:167-168` · `App.jsx:729` · 테스트 `[D②]` |
| ③ 30초 초과 시 사서함 pull 유실? | ✅ **데이터 유실은 없다** — ack하지 않으므로 다음 pull에서 멱등 재처리. ⚠️ 다만 스로틀 도장은 **시도 전에** 찍히므로 죽어도 30분 창이 소모된다 | `import-inbox.js:75` · 테스트 `[D③]` |
| ④ 오프라인·모바일 회선 | ✅ fetch 실패 시 조용히 return, 다음 시작에 재시도 | `App.jsx:728-731` |

### E. 자동 확정(auto:true) 레코드 ✅⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| ① "muscle 미입력이 통계를 0으로 오염" 불변 조건 | ✅ **성립한다.** `draftToRecord`가 `m > 0`을 강제하고, 초안은 `bodylog` 밖 별도 키에 산다. 초안을 읽는 곳은 **BodyTab 카드와 백업 2곳뿐** — 통계·MA7·TDEE·분석 어디에도 안 들어간다(전수 grep) | `bodyDraft.js:103` · `BodyTab.jsx:196` · `backup.js:23` |
| ② auto 레코드가 통계에 구분 없이 섞이나 | ⚠️ **섞인다.** `estimateTDEE`는 `b.weight > 0`만 보고, StatsTab·MA7·공유 링크 어디에도 `auto` 필터가 없다. 자동도 실측이므로 설계상 정상이지만, **provenance가 분석 계약까지 못 가는 것**(N④)과 결합해 문제가 된다 | `adaptiveTDEE.js:40` |
| ③ 편집 후 영영 반영 안 되는 것이 의도인가 | ✅ **의도.** 편집 시 `auto`·`sampleTs`를 삭제해 영구 잠금. 문서에 명시 | `App.jsx:343` · `docs/inbody-setup.md:44-45` |
| ③' 문서에 없는 부작용 | ⚠️ **B채널 폴백으로 수동 확정한 날도 같은 영구 잠금**이 된다(`draftToRecord`는 `auto`를 붙이지 않음). 클라우드가 복구돼도 그 날짜는 영영 자동 갱신 대상이 아니다 — 문서에 없다 | `bodyDraft.js:101-115`,`:50` |
| ④ auto 구분이 어디까지 살아남나 | 저장·백업 ✅ / 체성분 탭 배지 ✅(`source` 기반) / **분석 계약·공유 링크 ✗** | Phase 0 사슬 (c) |

### F. 측정 규칙 변경의 파급 (B1 완화) ⚠️ — **정량 확인**

| 질문 | 판정 | 근거 |
|---|---|---|
| 규칙이 실제로 완전 개방됐나 | `MORNING_END_HOUR = 24`, 가드는 `hour >= 24` — hour∈0..23에서 **절대 참이 아니다**. 시각 상한 무효, NaN 방어만 남음 | `body-import-rules.js:42`,`:156` |
| ① 시즌 1과 다른 규칙임이 기록됐나 | ✅ 코드 주석(`:37-42`)과 `docs/inbody-setup.md:39-50`에 있다. ⚠️ **분석 계약(analysisExport)에는 없다** | — |
| ② 저녁 비공복 측정이 MA7·TDEE·목표를 얼마나 흔드나 | ⚠️ **정량 측정 결과 (28일 창, 저녁=아침+1.0kg 가정)** — 아래 표 | `adaptiveTDEE.js` 실행 |
| ③ 분석 계약이 규칙 변화를 전달하나 | ⚠️ **전달하지 않는다.** "설정 변경 이력" 섹션은 `tdeeHistory`와 모드 전환만 담는다 | `analysisExport.js:113-138` |
| ④ 되돌림 시 재해석 필요한가 | ⚠️ `MORNING_END_HOUR=12`로 되돌려도 **이미 `bodylog`에 확정된 저녁 값은 그대로 남는다.** 새 측정만 필터되어 과거는 두 규칙이 혼재. 문서는 "되돌리면 오전만 채택"이라고만 하고 이 점을 언급하지 않음 | `docs/inbody-setup.md:46-47` |

**F② 정량 — 적응형 보정치(delta) 이동폭** (기준선 delta = +173kcal, 클램프 ±300)

| 혼입 패턴 | delta | 기준 대비 이동 |
|---|---|---|
| 전부 아침 공복 (기준선) | +173 | — |
| 마지막 1건만 저녁 | +116 | **−57 kcal** |
| 무작위 50% 저녁 (200회 시뮬레이션) | 평균 +164 · 범위 −52 ~ +300 | 평균 −9, **폭 352 kcal** |
| 전반 14일 아침 → 후반 14일 저녁 (측정 습관 전환) | **−240** | **−413 kcal** |
| 전반 14일 저녁 → 후반 14일 아침 (역방향) | +300 (클램프 포화) | **+127 kcal** |

> 측정 습관이 아침→저녁으로 바뀌는 **한 번의 전환만으로 칼로리 목표가 413kcal 움직인다.**
> B1 완화의 목적("몇 번을 재든 마지막이 이긴다")이 정확히 이 전환을 허용한다 — 하루 여러 번 재면
> 저녁값이 항상 채택되기 때문이다. ±300 클램프는 delta의 절대값만 묶을 뿐 **이동폭을 묶지 못한다.**

### G. adaptiveTDEE 결합 ⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| ① 이상 체중 1건이 목표를 얼마나 흔드나 / 클램프가 충분한가 | ⚠️ **충분하지 않다** — 아래 표. `measuredTDEE = 평균섭취 − slope×7700`이라 **기울기 0.01kg/day 오차 = 77kcal** | `adaptiveTDEE.js:50-56` 실행 |
| ② 소급 유입이 이미 판정된 과거 날의 목표를 바꾸나 | ✅ **적응형 보정 경로로는 안 바꾼다** — `tdeeHistory`는 사용자가 "적용"해야 기록되고 `from: today()`라 과거 구간이 보존된다. ⚠️ **그러나 다른 경로로 바뀐다**: 새 체중 1건이 `monthWeight`(그 달 평균)를 즉시 바꿔 `targetsByMode` 전체가 이동하고, `dayTargetK`가 그 값을 쓰므로 **그 달 모든 날의 판정 기준이 소급 변경된다** | `App.jsx:777-783`(보존) vs `:642-659`,`:667`(소급) |
| ③ 보정치가 캐시되나 | ✅ `tdeeHistory`(의도된 이력)만 저장, 나머지는 전부 매번 재계산 | `App.jsx:639`,`:663` |
| ④ 결측·부족 시 | ✅ `loggedDays < ceil(28×0.6)=17` 또는 `weighs < 4`면 `valid:false` → 공식 폴백. 제안 배너는 `confident`(17→21일 + 8측정)일 때만 | `adaptiveTDEE.js:46`,`:57` · `App.jsx:671` |
| ④' 자동 유입의 부작용 | ⚠️ 체중 측정이 **희소 → 매일**로 바뀌어 `valid`/`confident` 게이트가 상시 통과된다. 게이트가 사실상 무력화되어 **불량 데이터가 곧바로 제안으로 이어지는 빈도가 급증** | `adaptiveTDEE.js:46`,`:57` |
| ⑤ 결합이 문서화됐나 | ⚠️ `ARCHITECTURE.md §79`에 적응형은 있으나 **자동 체성분 유입과의 결합은 없다** | `docs/ARCHITECTURE.md:79-85` |

**G① 정량 — 이상 체중 1건의 목표 이동폭** (28일 창, 기준선 delta +173)

| 이상치 | 창 최신일 | 창 중앙 | 창 최고참일 |
|---|---|---|---|
| +1 kg | −57 kcal | −2 kcal | +57 kcal |
| +3 kg | −171 kcal | −6 kcal | +127 kcal (포화) |
| +5 kg | **−284 kcal** | −10 kcal | +127 kcal (포화) |
| −3 kg | +127 kcal (포화) | +6 kcal | −171 kcal |
| +10 kg | **−473 kcal** (delta −300 포화) | — | — |

> 창 **양 끝**의 1건이 지배적이다(회귀 기울기의 레버리지). 검문소가 통과시키는 범위(40~150kg) 안의
> +5kg 오차 — 옷·기기 오인식·다른 사람 측정 — 하나가 목표를 **284kcal** 움직인다. 창 중앙은 거의 무해.

### H. 이중 유입 중복 (HAE 지표 ↔ 클라우드) ⚠️

사서함 키가 `{date}|{sampleTs}`라, **같은 측정이라도 타임스탬프가 1ms만 달라도 둘 다 accepted** 된다(`body-import-rules.js:171`).
문서화된 실제 설정 — HAE는 **분(minute) 단위**라 초가 `00`으로 절삭되고(`docs/inbody-setup.md:120`, 판별법 예시 `08:24:00`),
클라우드 `DATETIMES`는 초까지 살아 있다(`082433`) — 을 그대로 재현했다.

| # | 시나리오 | 결과 |
|---|---|---|
| ① | HAE 적재 후 앱 열어 클라우드 pull (**둘 다 같은 pull**) | ✅ 정상 — `import-inbox.js:177`이 `sampleTs` 오름차순 정렬, `bodyDraft.js:85`가 **존재하는 필드만** 덮으므로 골격근·점수 보존 → 자동 확정 |
| ② | 클라우드 먼저 확정 → 다음 pull에 HAE | ✅ 정상 — HAE ts가 더 이르므로 `lockedAgainst`가 폐기 |
| ③ | 클라우드 스로틀/실패로 HAE만 먼저 착지 → 30분 뒤 클라우드 | ✅ 정상 — 초안에 필드 병합 후 자동 확정 (자가 치유) |
| ④ | **측정 시각의 초가 정확히 `00`** → 사서함 키 충돌 | ⚠️ **HAE가 먼저 적재되면 클라우드 항목이 `seen`에 막혀 `ignored`** → 골격근·점수가 유입되지 않고 초안만 남는다. `import:body-seen`은 TTL이 없어 **그날은 영구히 자동 확정 불가**. 발생 확률 ≈ **1/60** |
| ⑤ | 초 `00` + 클라우드가 먼저 | ✅ 정상 |
| ⑥⑦ | **HAE ts > 클라우드 ts**인 경우 | ❓ **미확인 — 문서화된 분 단위 절삭에서는 발생 불가**(절삭은 내림만 한다). 만약 HAE를 초 단위로 바꾸거나 HealthKit이 동기화 시각을 기록하면: ⑥ 고아 초안 잔류, ⑦ **클라우드 항목이 착지 없이 ack되어 골격근·점수 영구 유실**(`bodyDraft.js:83`,`:92`) |

| 질문 | 판정 |
|---|---|
| ② 값 불일치가 생기나 | ✅ 검증 범위에서는 동일. 두 경로 모두 `r1()`로 소수 1자리 반올림 (`body-import-rules.js:44`) |
| ③ 두 경로 동시 활성이 의도인가 | ✅ **의도다** — 문서가 자동화 C(InBody 앱 닫힐 때)와 21:30 백업 자동화 양쪽에 B채널을 등록시킨다. 즉 **S8은 예외가 아니라 기본 운영 상태** |
| ③' 코드가 강제하나 | ⚠️ **강제할 수 없다.** `IMPORT_BODY_CUTOVER_DATE`가 HAE·클라우드 **둘 다**의 게이트라, HAE 체성분만 끄는 스위치가 존재하지 않는다(실제 핸들러로 확인) |
| 문서 주장의 정확성 | ⚠️ `docs/inbody-setup.md:34`의 "같은 측정이 양쪽으로 와도 필드별 최신 채택으로 **자연 통합(중복 없음)**"은 ④에서 성립하지 않는다 — **문서가 코드보다 강하게 보장한다** |

## 기존 축 (I~R)

### I. 사서함 원자성·부분 실패 ✅⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| 일부만 병합 성공하면 ack는 | ✅ 성공분만 ack. 저장(`store.set`)이 ack보다 **먼저** 실행돼 "ack했는데 저장 안 됨" 창이 없다 | `App.jsx:746` → `:750` |
| 실패분 유실·재시도 | ✅ 사서함에 남아 다음 pull에서 재처리 | `App.jsx:751` |
| 크래시·단절 시 최종 상태 | ✅ ack 전 중단 → 재pull → 멱등 재처리. 실증 | 테스트 `[S3]` 계열 |
| 병합이 멱등인가 | ✅ 운동은 `importKey` 대조(`importMerge.js:47`), 체성분은 `sampleTs` 비교(`bodyDraft.js:83`) |
| ⚠️ 비대칭 1건 | ⚠️ **구조가 깨진 운동 항목은 `ackKeys`에 안 들어가 사서함에 영구 잔류**한다. 체성분은 같은 상황에서 ack해 정리한다 | `importMerge.js:41-43` vs `bodyDraft.js:73` · 테스트 `[I]`·`[대조]` |

### J. 멀티 기기·동시성 ⚠️ — **유실 경로 존재**

| 질문 | 판정 | 근거 |
|---|---|---|
| 사서함 pull·ack 경합 | ✅ HDEL 멱등, `seen`은 `SET NX`로 승자 1명 | `body-inbox-store.js:17` · 테스트 `[대조]` |
| 클라우드 pull 중복 로그인 | ⚠️ **발생한다** — 축 C① | 테스트 `[C①]` |
| `flushPendingSync`가 만드는 유령 부활 | ⚠️ **초안 유령은 스윕이 청소하지만, `bodylog` 자체의 유실은 막지 못한다.** `store.set`은 키 단위 **last-write-wins**(문서 통째 교체)이고 `bodylog`는 배열 전체가 문서 1개다. 기기 A가 오프라인에서 8/8을 확정(pending 등록) → 기기 B가 온라인에서 8/9 확정 → A 복귀 시 `flushPendingSync`가 A의 localStorage `bodylog`(8/9 없음)를 **통째로 push** → **8/9 유실** | `store.js:253-269`,`:274-290` · `bodyDraft.js:63-68`(초안 스윕만) |
| 자동 유입이 이 위험에 미치는 영향 | ⚠️ 선행 결함이나, **자동 확정은 사용자 조작 없이 앱을 여는 것만으로 `bodylog`를 쓴다** → 두 기기가 각자 `bodylog`를 쓰는 빈도가 구조적으로 상승 | `App.jsx:764` |

### K. 지속성·수명 ✅⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| `import:seen:*` 무한 증가 비용 | ✅ **실질 무해.** 키+값 ≈ 100바이트, 운동 ~2건/일 + 체성분 ~1~3건/일 → 연 **약 1,200키 ≈ 120KB**. Upstash 한도 대비 무시 가능 | 키 형식 `health-import.js:125` |
| 만료 시 중복 재유입 | ✅ **무해.** seen이 사라져 같은 항목이 재수신돼도 `mergeImports`/`mergeBodyDrafts`가 멱등이라 중복이 생기지 않는다 | `importMerge.js:47` · `bodyDraft.js:80-83` |
| ⚠️ 진짜 위험 | ⚠️ 만료·유실이 위험한 것은 **방어 키**다 — `import:body-cloud-fail`·`-at`·`-authblock`이 사라지면 잠금 방어가 초기화돼 다시 3회 두드린다 | 테스트 `[S11]` |
| 앱 미개봉 2주 | ✅ 운동 ~28건 + 체성분 ~14건 누적 → 한 번에 병합. ⚠️ `ack`는 **500건 상한**이 있어(적재에는 상한 없음) 초장기 미개봉(6개월+) 시 ack가 400으로 실패해 교착 가능 — 현실성 낮음 | `import-inbox.js:206-208` |

### L. 시간·날짜 귀속 ⚠️

시간 기준이 **4가지**다. 같은 유틸을 공유하지 않는다.

| 주체 | 기준 | 근거 |
|---|---|---|
| 운동(네이티브 단축어) | `w.start` 문자열의 **기기 오프셋 그대로** | `import-rules.js:131` |
| 운동(HAE)·체성분(HAE·클라우드) | **서버 고정 오프셋**(`IMPORT_TZ_OFFSET`, 기본 +09:00)으로 재표기 | `import-rules.js:182-195` · `inbody-cloud.js:43-50` |
| 크론 | **KST 고정**(`Date.now() + 9h`) | `cron-reminders.js:16` |
| 앱 판정·통계 | **기기 로컬 시각** | `utils.js:1-5` |

| 시나리오 | 결과 |
|---|---|
| 국내 자정 경계 (23:40 시작 운동) | ✅ 두 경로 모두 `2026-08-09` — 일치 |
| **해외 UTC−10에서 현지 오전 운동** | ⚠️ 네이티브 `2026-08-09` vs HAE `2026-08-10` — **같은 운동이 경로에 따라 다른 날짜.** dedup 키가 epoch 기반이라 중복은 막히지만 **먼저 도착한 경로의 날짜가 이긴다** |
| 10월 오사카 · 11월 오키나와 | ✅ **무영향** — JST = +0900 = KST |
| 해외에서 크론 vs 앱 | ⚠️ 크론의 "오늘"(KST)과 앱의 "오늘"(현지)이 갈려 리마인더 판정이 하루 어긋날 수 있다 |

### M. 소급 변경 파급 ✅⚠️

**파생값을 저장·캐시하는 코드 전수 (4곳)** — 나머지는 전부 매번 재계산이라 소급 유입이 자동 반영된다.

| 저장처 | 화석이 되나 | 판정 |
|---|---|---|
| `goals.tdeeHistory` | 의도된 이력(과거 판정 보존이 목적) | ✅ |
| `share:{token}` 스냅샷 | ⚠️ 최대 7일 화석. **다만 설계상 "공유 시점 스냅샷"으로 명시·문서화**돼 있고 뷰에 생성 시각이 표시된다 | ✅ 의도 |
| `push:state.weekReport` | ⚠️ 앱을 열어야 갱신. **그러나 `weeklyReportPush`가 `weekStart === 지난주 월요일`을 검증해 옛 주면 수치 없는 일반 문구로 폴백** — 틀린 수치를 보내지 않는다 | ✅ 안전 |
| `body-coaching` | AI 코칭 캐시. 수동 정리 UI 있음 | ✅ |
| **`monthWeight` 경유** | ⚠️ **저장이 아니라 반대 방향 문제.** 새 체중 1건이 그 달 평균을 바꿔 `targetsByMode` → `dayTargetK`가 이동, **그 달 모든 날의 판정이 소급 변경**된다. 게다가 `monthWeight`는 `date`(선택 날짜)의 달을 쓰므로 **달력을 넘길 때마다 기준이 달라진다** | ⚠️ `App.jsx:642-648`,`:667` |

### N. 통계·분석 정합성 ⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| ① 초안이 통계에 새는 경로 | ✅ **0개.** `bodyDrafts`를 읽는 곳은 BodyTab 카드·백업·App 상태뿐(전수 grep) | `BodyTab.jsx:196` · `backup.js:23` |
| ② 부위 구성비 인사이트가 거짓을 말하나 | ⚠️ **말한다.** 워치 자동 수신 대표명 9종 중 상체·하체·코어로 분류되는 것이 **0종** — `근력 운동`·`스트레칭`은 "기타", 나머지 7종은 "유산소". 즉 자동 수신만 쓰면 주간 구성비 표의 **상체/하체/코어가 항상 0%**로 출력되고, 분석 클로드는 "상·하체 운동을 전혀 안 함"으로 읽는다. 표 어디에도 경고가 없다 | `analysisExport.js:49-58`,`:194-206` · 실행 확인 |
| ③ 자동 유입 전후로 의미가 달라진 지표 | ⚠️ 3종 — **(a)** 체중 측정 빈도(희소→매일) → MA7·추세·`confident` 게이트 상시 통과 **(b)** 운동 종목 해상도(개별 종목→"근력 운동" 덩어리) → 구성비·빈도 집계 **(c)** 측정 시각 규칙(아침 고정→하루 최신) → 추세 자체의 의미 |
| ④ `analysisExport`가 provenance와 규칙 변경을 전달하나 | ⚠️ **전달하지 않는다.** 체성분 섹션은 `auto`·`source`·`sampleTs`를 출력하지 않고, 운동 상세도 `source:"watch"`·`device`를 출력하지 않는다. "설정 변경 이력"에도 B1 완화가 없다 | `analysisExport.js:294-316`,`:233-239`,`:113-138` |

### O. 이중 계상 방어 ⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| 유산소를 수동으로도 적으면 | ⚠️ **방어가 문서에만 있고 코드에는 없다.** `importKey` 멱등은 **자동분끼리의 중복**만 막는다. 수동 입력 항목에는 `importKey`가 없어 같은 운동을 손으로 또 넣으면 그대로 이중 계상된다 | `importMerge.js:47` · 수칙 `import-rules.js:38-39` |
| 체성분 수동/자동 충돌 | ✅ **잠금으로 충분.** 수동·편집분은 `auto` 없음 → `lockedAgainst`가 항상 잠금 → 자동분은 조용히 폐기. 실증 | `bodyDraft.js:48-52` · `[S9]` 재현 |

### P. 보안·권한 ✅⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| `IMPORT_TOKEN` 공용의 blast radius | ⚠️ 한쪽이 유출되면 운동·체성분 양쪽 위조 가능. 완화: 검문 규칙(범위·컷오버·화이트리스트)이 임의값을 거르고, 착지는 **사서함 경유**라 Firestore 직접 오염은 불가 | `health-import.js:48` · `body-import.js:43` |
| rate limit 실효성 | ⚠️ 30회/분/IP. **KV 미설정 시 fail-open**. `.env.example`이 KV를 "선택 — 미설정 시 rate limit fail-open"이라 적었지만, 실제로는 KV 없이 사서함 자체가 동작하지 않는다(500) — 설명이 낡음 | `security.js:44-52` · `.env.example` |
| `firestore.rules`가 새 필드를 덮나 | ⚠️ **덮지 않는다** — `users/{uid}/data/{document=**}`는 경로 단위 `isSelf && isMember` 한 줄뿐, 필드 검증이 전혀 없다 | `firestore.rules:73-76` |
| 클라이언트가 `auto:true`를 위조할 수 있나 | ⚠️ **가능하다.** 다만 `isSelf(uid)` 때문에 **본인 데이터 한정**이라 실효 blast radius는 자기 기록 조작뿐. 문서 지향 저장소의 의도된 트레이드오프로 보이나 기록돼 있지 않다 | 동상 |
| 로그 위생 | ✅ 본문 전문 없음, 미매칭 지표명·건수 요약만. 크리덴셜은 "형태"만 | `health-import.js:140-142` · `body-inbox-store.js:38-50` |
| 공유 뷰 | ✅ 32자 hex 토큰 검증·`noindex`·`no-store`·404/410 구분·분당 30 | `export-view.js:27`,`:95`,`:86-88` |
| 유입 인증 | ✅ 다른 uid로는 클라우드 pull 트리거 불가, idToken 위조는 401 | 테스트 `[P]` ×2 |

### Q. 침묵 실패·관측성 ⚠️ — **가장 큰 구조적 공백**

| 질문 | 판정 | 근거 |
|---|---|---|
| ① "N일간 유입 없음"을 감지하는 장치가 있나 | ⚠️ **능동 감지 장치는 0개.** 유일한 간접 신호는 크론의 7일 체중 리마인더 — 체성분 유입이 멈추면 `lastWeighDate`가 안 갱신돼 푸시가 온다. **운동 자동 수신의 침묵은 감지기가 전혀 없다** — `record` 리마인더는 식단만 기록해도 충족되므로 워치 수신이 2주 죽어도 아무 일도 일어나지 않는다 | `reminders.js:24-32` |
| ② 수신 로그 20건·설정 카드가 충분한가 | ⚠️ **불충분.** `syncImports()`는 앱 시작마다 돌아 `importInfo`를 갱신하지만, 표시는 **설정 → 데이터 모달 안**에만 있다. 사용자가 찾아가야 보이는 수동 창구다 | `App.jsx:261`,`:2045-2112` |
| ③ 가장 싼 구현 | 크론(`cron-reminders`)이 이미 KV를 읽는다. `import:log:{uid}`·`import:body-log:{uid}`의 **최신 `at`을 `LRANGE 0 0`으로 직접 읽어** N일 이상 조용하면 푸시 1건 — **앱 개입도 새 저장소도 필요 없다** | `cron-reminders.js:37-43` |

### R. 롤백·수습 ✅⚠️

| 질문 | 판정 | 근거 |
|---|---|---|
| env 스위치가 실제로 독립인가 | ✅ **코드로 확인.** `INBODY_LOGIN_*` 삭제 → 클라우드만 off(운동·HAE 유지). `IMPORT_CUTOVER_DATE` → 운동만. 실제 핸들러로 검증 | 테스트 `[R①]` ×2 |
| ⚠️ 예외 1건 | ⚠️ `IMPORT_BODY_CUTOVER_DATE`는 **HAE·클라우드 2채널 공통 게이트** — HAE 체성분만 끄는 스위치가 없다(축 H③'과 같은 원인) | 테스트 `[R①]` |
| ① 즉시 차단 | ✅ env 삭제 + Redeploy. 문서화됨(단 `.env.example`엔 변수 자체가 없음) | `docs/inbody-setup.md:105-107` |
| ② 유입분만 골라 일괄 삭제 | ⚠️ **식별은 가능**(체성분 `source:"import"`/`auto:true`, 운동 `source:"watch"`)하나 **일괄 삭제 UI·유틸이 없다.** 1건씩 수동 삭제하거나 백업 복원이 유일한 경로 | `BodyTab.jsx:562` · `App.jsx:348` |
| ③ 삭제 후 복구 | ✅ 통계·TDEE·목표가 전부 재계산이라 **자동 복구**. 캐시 화석은 M에서 확인한 대로 실질 없음 | — |

### S. 구조 부채 ⚠️

| 항목 | 판정 | 근거 |
|---|---|---|
| 두 파서·두 병합 사이 복붙 드리프트 | ✅ **대체로 양호.** 규칙은 단일 출처(`body-import-rules.js`가 `import-rules.js`의 `haeDateToIso` 재사용), 사서함 기입도 `body-inbox-store.js`로 단일화 | `body-import-rules.js:23` · `body-inbox-store.js:3-6` |
| ⚠️ 드리프트 2건 | ⚠️ (a) **ack 정책 비대칭**(축 I) (b) **`SET NX` 패턴이 스로틀에만 미적용**(축 C①) | — |
| 전 구간 관통 통합 테스트 | ⚠️ **없다.** 35개 테스트 중 `inbody-cloud.test.js`가 pull→병합→자동확정까지 가고 `golden.test.js`가 순수 계산 계층을 고정하지만, **유입 → 병합 → 통계 → 목표 → 판정 → 공유 링크 전 구간을 관통하는 테스트는 0개** | `src/__tests__/` 전수 |
| ESLint 규칙 범위 | ⚠️ 활성 규칙 3개뿐이라 `no-dupe-keys`가 없다. 실제로 **중복 키가 게이트를 통과해 있다** — `bodyCloudEnabled`가 두 번 지정됨(값이 같아 무해) | `eslint.config.js:19-21` · `App.jsx:736-737` |
| 인수인계 문서 | ⚠️ `ARCHITECTURE.md`가 최근 2주(자동 유입 3경로 + 자동 확정 + 클라우드 직수신)를 **전혀 반영하지 않았다.** §2 파일 구조에 새 모듈 6개 누락, §8 변경 이력 PR #16까지(현재 #100) | `docs/ARCHITECTURE.md:24-50`,`:188` |

---

# Phase 2 — 시나리오 스트레스 테스트 (S1~S14)

각 항목 **기대 → 실제 → 판정**. 재현 가능한 것은 실제 모듈·실제 핸들러를 실행했고,
불가능한 것은 코드 추적으로 표기했다. 인바디 클라우드 실제 로그인은 **0회**(전부 모킹).

| # | 시나리오 | 기대 | 실제 | 판정 |
|---|---|---|---|---|
| **S1** | 앱 5일 미개봉 후 첫 실행 (운동 8건 + 체성분 5일치 + 클라우드 5건 동시 착지) | 전부 각자 날짜에 병합, 중복 0 | 운동 8건 → 4일치 `updatedDays`, ack 8건. 과거 날짜는 `mode` 스탬프를 건드리지 않고 보존(`undefined` 유지 → 판정 시 `day.mode\|\|"cut"` 폴백). 클라우드는 최근 **5건**만 가져오므로(`count:5`) 6일 이상 미개봉이면 **가장 오래된 측정부터 유실**된다 — 단 그 사이 HAE 단축어가 매일 돌았다면 사서함에 남아 있다 | ⚠️ 부분 — 6일+ 미개봉 시 클라우드 단독으로는 누락. 실행 확인 |
| **S2** | 두 기기 동시 실행 — 사서함 경합 + 클라우드 pull 중복 로그인 | 사서함 원자, 로그인 1회 | 사서함: `SET NX`로 승자 1명 ✅. **클라우드: 동시 요청 2건이 둘 다 스로틀을 통과해 로그인 2회 — 실제 핸들러로 재현.** 비밀번호 오류 상태면 **3-strike 중 2개를 한 번에 소모**(순차였다면 1개) | ⚠️ **결함** — 테스트 `[C①]`·`[S2]` |
| **S3** | 병합 도중 강제 종료 / 네트워크 단절 → 재실행 | 중복 없이 이어서 완료 | 저장(`store.set`)이 ack보다 먼저 실행되므로 "ack했는데 저장 안 됨" 창이 없다. ack 유실 후 재pull → `importKey` 대조로 중복 추가 0건 (실행 확인). 체성분도 `sampleTs` 비교로 멱등 | ✅ 정상 |
| **S4** | 인바디 응답 20초 지연 또는 500 → 앱 시작 동기화와 운동 병합 | 클라우드만 실패, 운동은 정상 | **500 → 운동 `entries` 정상 반환 + `bodyCloudStatus:"failed"`** (논리 격리 ✅). **지연 → pull 응답 전체가 그대로 지연**(300ms 주입 → 300ms 지연 실측). 순차 3요청 × 20초 = 최악 60초 > `maxDuration` 30초 → 504로 **운동 병합도 그 세션에서 실패**. 데이터 유실은 없음(ack 안 함) | ⚠️ 시간 격리 없음 — 테스트 `[D②]`·`[D①③]` |
| **S5** | 비밀번호 변경/오타로 인증 실패 → 봉인, 사용자 인지, env 수정 후 즉시 해제 | 1회로 봉인, 즉시 해제 | 인증 실패 **1회로 봉인**, 이후 force도 `authBlocked` ✅. 사용자 인지: 카드에 `⚠ 비밀번호 오류로 24시간 중단` + 로그에 `PW_FAIL_2 — ID 11자(010…) · PW 10자` ✅. env 수정 → 지문 변경 → **즉시 해제** 확인 ✅. ⚠️ 단 봉인 KV 쓰기가 실패하면 조용히 지나감 | ✅ 정상 (⚠️ 예외 1건) — 테스트 `[S6]`·`[C]`·`[C②]` |
| **S6** | "지금 확인" 연타 10회 + 실패 상태 → 인바디 실패 카운터를 몇 번 깎나 | 최소 횟수 | **일시적 오류(네트워크·5xx): 3회** (`CLOUD_FAIL_CEILING`), **인증 실패: 1회**로 봉인. 10회 연타 시뮬레이션으로 확인 ✅. ⚠️ 다만 **운동 카드 버튼(`App.jsx:2057`)에 진행중 가드가 없어** 빠른 연타가 S2의 동시 요청을 만들 수 있다 | ✅ 방어 작동 (⚠️ 가드 비대칭) |
| **S7** | 같은 날 3회 측정 (08:24 · 09:19 · 21:40) → 최종 채택값과 추세·TDEE 영향 | 최신 채택 | **21:40 저녁값(77.2kg)이 채택**되고 아침 75.7kg은 버려진다. `excluded=0`(시각 창 무효). 회귀 기울기에 저녁값이 들어가 축 F②의 정량표대로 목표가 이동 | ✅ 규칙대로 동작 · ⚠️ 파급은 F② |
| **S8** | HAE 지표 경로와 클라우드 경로 동시 활성 → 이중 착지 | 자연 통합 | 문서화된 설정(HAE 분 단위 절삭)에서 **3개 도착 순서 모두 정상**(같은 pull / 클라우드 선착 / HAE 선착 후 30분 뒤 클라우드 — 자가 치유). ⚠️ **측정 초가 정확히 `00`이면 키가 충돌**해 HAE 선착 시 클라우드 항목이 `seen`에 막혀 골격근·점수가 유입되지 않는다(≈1/60, `seen`은 TTL 없어 그날 영구). ❓ HAE ts > 클라우드 ts 조건에서는 골격근 영구 유실이 가능하나 **현 설정에서 도달 불가 — 미확인** | ⚠️ 경계 결함 — 7케이스 실행 확인 |
| **S9** | 사용자가 값을 편집한 날에 더 최신 자동 측정 도착 | 편집분 보호 | 편집 시 `auto`·`sampleTs` 삭제 → `lockedAgainst`가 항상 잠금 → 자동분은 초안도 안 만들고 **ack만 하고 폐기**. 실행 확인 ✅ | ✅ 의도대로 |
| **S10** | 단축어·클라우드 2주 침묵 → 사용자는 언제·어떻게 알아채나 | 며칠 내 감지 | **체성분: 7일째 "체중 잴 시간 ⚖️" 푸시**가 유일한 감지기(실행 확인: 2일·6일 → 알림 0, 7일·14일 → 푸시). **운동만 죽으면 알림 0건 — 영원히 모른다**(식단 기록이 `record` 리마인더를 충족). 주간 성적표는 `weekStart` 검증으로 옛 수치를 보내지 않고 일반 문구로 폴백 ✅ | ⚠️ **결함** — 운동 침묵 감지기 0개 |
| **S11** | KV 장애/만료 (사서함·seen·throttle·authblock 각각) | 방어 유지 | **사서함 유실** → 미병합분 유실(재전송으로 복구, HAE는 주기 재전송이라 자동 복구). **seen 유실** → 재유입되나 병합이 멱등이라 **무해** ✅. **throttle·failKey 유실** → 방어 초기화, 다시 3회 두드림 ⚠️(실행 확인). **authblock 유실** → 봉인 해제, 재시도 재개 ⚠️. KV 전면 장애 → `import-inbox` 500, rate limit은 fail-open | ⚠️ 방어 키만 취약 — 테스트 `[S11]` |
| **S12** | 해외 체류 중 측정·운동 (기기 타임존 변경) | 현지 날짜 일관 | **UTC−10에서 현지 오전 운동**: 네이티브 경로 `2026-08-09` vs HAE 경로 `2026-08-10` — **경로별로 하루 차이**. dedup은 epoch 기반이라 중복은 없으나 **먼저 도착한 경로의 날짜가 이긴다**. 크론의 "오늘"(KST)과 앱의 "오늘"(현지)도 갈린다. **10월 오사카·11월 오키나와는 JST=+0900=KST라 무영향** | ⚠️ 구조적 드리프트 (예정 여행엔 무영향) |
| **S13** | 잘못된 값 대량 유입(단위 오설정 1주치) → 차단·정리·통계 복구 | 검문소가 차단 | **차단 성공**: lb↔kg 오표기(7/7 거부), 체지방 소수형(7/7), 범위 밖 체지방·골격근·점수(7/7), 미지 단위 stone(7/7), 운동 kJ 오염(거부). ⚠️ **정상 범위 안의 틀린 값(옷 입고 +2kg)은 7/7 통과** — 검문소의 구조적 한계, LBM 가드가 일부만 방어. **정리**: `source:"import"`/`auto:true`·`source:"watch"`로 식별은 가능하나 **일괄 삭제 UI가 없다**(1건씩 또는 백업 복원). **복구**: 전부 재계산이라 자동 ✅ | ⚠️ 차단 양호 · 정리 경로 부재 |
| **S14** | 휴식 선언일에 늦게 도착한 유산소 350kcal → 목표·판정·주간·인사이트·TDEE 일관 반영 | 전 화면 일관 | `effectiveDayMode`가 단일 기준이라 **운동 300kcal 초과 시 훈련일 공식(1,582)으로 자동 복귀**. 홈·달력·주간 성적표·밴드차트·내보내기가 전부 같은 함수를 호출. 소급 도착도 매번 재계산이라 동일 반영. 경계값 실측(0/250/300 → rest, 301/350 → cut) ✅ | ✅ 정상 (⚠️ 단 스트릭·운동 챌린지는 아래) |

## Phase 2 부수 발견 (시나리오 실행 중 드러난 것)

| # | 발견 | 근거 |
|---|---|---|
| X1 | **운동 스트릭이 휴식일 도장을 보지 않는다.** `dayHasEx`는 `exercises.length > 0`만 확인 → 쉬기로 도장 찍은 날이 "연속 끊김"으로 집계된다. 자동 수신 도입으로 반대 방향 왜곡도 생겼다: **워치 자동 기록만으로 스트릭이 올라간다** | `WorkoutStamp.jsx:12`,`:16-30` |
| X2 | **주간 등급 산식이 StatsTab 안에 두 번 복붙**돼 있다(주간 성적표용·8주 트렌드용, 동일 공식). 한쪽만 고치면 두 화면의 등급이 조용히 갈린다 | `StatsTab.jsx:151-162` vs `:198-208` |
| X3 | **`dayTargetK` 공식이 3곳에 복붙**돼 있다 — `App.jsx:667`·`StatsTab.jsx:16`·`analysisExport.js:74`. 규칙 자체(`isCalOk`·`effectiveDayMode`)는 단일 출처지만 "현재 보정 빼고 그날 보정 더하기"는 각자 구현 | 3파일 |
| X4 | **미확정 초안이 있어도 "체중 재세요" 독촉이 계속된다.** `pendingRmd`·`pushState.lastWeighDate`가 `bodyLog`만 보기 때문. 클라우드가 죽어 초안만 쌓이는 상황에서 사용자가 받는 유일한 신호가 "체중을 안 쟀다"는 (틀린) 메시지다 | `App.jsx:612`,`:701` |
| X5 | **AI 코칭 캐시 정리가 localStorage만 지운다** — Firestore 사본은 남아 다음 `getAllData`에서 되살아난다 | `App.jsx:2037` vs `store.js:342-357` |
| X6 | `importInfo`는 **세션 한정 메모리**라 새로고침하면 "상태 미확인"으로 돌아간다 — 관측 창구의 지속성이 없다 | `App.jsx:716`,`:2052` |
| X7 | `goals` 문서 하나가 목표·모드·`tdeeHistory`·알림·컨디션·공유 링크를 전부 담고 **매번 통째로 덮어쓴다** → 두 탭·두 기기에서 편집하면 마지막 쓰기가 이긴다 | `App.jsx:405` |
| X8 | 클라우드 pull은 **최근 5건 고정**(`count:5`)이라 6일 이상 앱을 안 열면 클라우드 단독으로는 가장 오래된 측정부터 못 가져온다 | `import-inbox.js:82` · `inbody-cloud.js:172` |

---

# Phase 3 — 리스크 레지스터 + 정상 확인 목록

> **여기서 멈추고 승인을 기다린다.** Phase 4(수정)는 승인된 P0/P1에만 착수한다.
> 심각도 정의는 프롬프트 §3을 그대로 따른다.

## 3-1. 리스크 레지스터

### P0 — 데이터 유실·오염 가능 / 계정 잠금·크리덴셜 노출

| ID | 축 | 발견 | 근거 | 재현 | 처방 | 규모 |
|---|---|---|---|---|---|---|
| **R-01** | C·J | **클라우드 pull 스로틀 선점이 비원자(`SET`).** GET→SET 사이가 열려 동시 요청 2건이 둘 다 통과 → 인바디 로그인 2회. 비밀번호 오류 상태면 **3-strike 중 2개를 한 번에 소모**한다(순차면 1개). 같은 저장 계층의 `storeBodyEntries`는 `SET…NX`를 올바로 쓴다 | `import-inbox.js:72-75` vs `body-inbox-store.js:17` | ✅ 실제 핸들러 재현 `[C①]`·`[S2]` | 스로틀 도장을 `SET … NX EX 1800`으로 교체하고 **반환이 `null`이면 `throttled`로 반환**(선점 실패 = 다른 요청이 이미 진행 중). `force`는 별도 키로 분리하거나 동일 선점을 따르게 | **1~2줄** + 동시성 테스트 1개 |
| **R-02** | J·M | **`flushPendingSync`가 `bodylog`를 통째로 덮어 다른 기기의 확정분을 유실시킨다.** `store.set`은 키 단위 last-write-wins이고 `bodylog`는 배열 전체가 문서 1개. 기기 A가 오프라인에서 8/8 확정(pending 등록) → 기기 B가 8/9 확정 → A 복귀 시 A의 localStorage 사본이 통째로 push되어 **8/9가 사라진다.** 선행 결함이나, **자동 확정이 "앱을 여는 것만으로 `bodylog`를 쓰게" 만들어 발생 확률을 구조적으로 올렸다** | `store.js:253-269`,`:274-290` · `App.jsx:764` | 코드 추적(경로 확정적) | `bodylog`·`body-drafts`처럼 **집합 성격 문서는 flush 시 원격 값과 병합**해 보내기(날짜 키 union, 같은 날짜는 `sampleTs`/수동 우선 규칙 적용 — `mergeMigrated`에 이미 유사 로직 있음) | **중** (`store.js` + `syncQueue` 테스트) |

### P1 — 정합성 붕괴·잘못된 지표·침묵 실패 (판단을 오도)

| ID | 축 | 발견 | 근거 | 재현 | 처방 | 규모 |
|---|---|---|---|---|---|---|
| **R-03** | F | **B1 완화가 칼로리 목표를 최대 413kcal 흔든다.** 측정 습관이 아침→저녁으로 바뀌는 **한 번의 전환**만으로 delta가 +173 → −240으로 이동. ±300 클램프는 절대값만 묶고 이동폭을 못 묶는다. 규칙의 목적("몇 번을 재든 마지막이 이긴다")이 정확히 이 전환을 허용한다 | `body-import-rules.js:42`,`:156` · `adaptiveTDEE.js:50-56` | ✅ 정량 실행 (F② 표) | ①(권장) 채택 샘플의 **시각을 사용자에게 보이게** — 체성분 카드·히스토리에 `sampleTs` 시각 표기 + 저녁(예: 12시 이후) 채택 시 경고 배지 ②분석 계약에 측정 시각 전달(R-04와 통합) ③되돌림 시 과거 데이터가 두 규칙 혼재임을 문서화 | **소~중** |
| **R-04** | N④·F③·E④ | **provenance와 측정 규칙이 분석 계약·공유 링크에 전혀 전달되지 않는다.** 체성분 섹션은 `auto`·`source`·`sampleTs`를 출력하지 않고, 운동 상세도 `source:"watch"`를 출력하지 않으며, "설정 변경 이력"에 B1 완화가 없다. **다음 시즌 분석이 조용히 틀린다** — 자동/수동, 아침/저녁을 구분할 근거가 문서에 없다. 반면 **백업은 100% 보존**한다(계약 비대칭) | `analysisExport.js:294-316`,`:233-239`,`:113-138` vs `backup.js:18-19` | 코드 추적 + 출력 확인 | `analysisExport`에 ①체성분 줄에 **측정 시각 + 자동/수동 표기** ②운동 상세에 ⌚ 표기 ③"측정 규칙" 한 줄 추가(`하루 종일 최신 채택(2026-08-08~)`) | **소** (`analysisExport.js` + 골든셋 갱신) |
| **R-05** | N② | **주간 부위 구성비 표가 거짓을 말한다.** 워치 자동 수신 대표명 9종 중 상체·하체·코어로 분류되는 것이 **0종**(`근력 운동`·`스트레칭`→기타, 나머지 7종→유산소). 자동 수신만 쓰면 표의 상체/하체/코어가 **항상 0%**로 출력되고, 분석 클로드는 "상·하체 운동을 전혀 안 함"으로 읽는다. 경고 문구가 없다 | `analysisExport.js:49-58`,`:194-206` | ✅ 실행 확인(9종 전수) | ①표에 **"근력" 열을 분리**해 `근력 운동` 덩어리를 담고 ②"자동 수신 근력은 부위 미분류 — 구성비는 총량 기준" 각주 추가 | **소** |
| **R-06** | Q·S10 | **운동 자동 수신의 침묵을 감지하는 장치가 0개.** 2주간 죽어도 알림이 없다(식단 기록이 `record` 리마인더를 충족하므로). 체성분은 7일 체중 리마인더가 유일한 간접 감지기 | `reminders.js:24-32` | ✅ 실행 확인(S10) | 크론이 이미 KV를 읽는다 → `import:log:{uid}`·`import:body-log:{uid}`의 **최신 `at`을 `LRANGE 0 0`으로 직접 읽어** N일(예: 5일) 이상 조용하면 푸시 1건. **앱 개입도 새 저장소도 불필요** | **소** (`cron-reminders.js` ~15줄) |
| **R-07** | P | **백업 JSON에 살아있는 공유 토큰이 들어간다.** `goals.shareLink = {token, expiresAt}`이고 `buildBackup`은 `goals`를 통째로 담는다. 백업 파일을 클라우드·메일로 옮기면 **로그인 없이 열리는 URL의 전체 권한**이 잔여 TTL(최대 7일)만큼 함께 나간다 | `App.jsx:2024-2025` · `backup.js:20` | ✅ 코드 확인 | `buildBackup`에서 `shareLink`를 제외(`const { shareLink, ...safeGoals } = goals`)하고 복원 시에도 복원하지 않는다 | **1~2줄** + 테스트 |
| **R-08** | P | **폐기한 공유 링크가 되살아날 수 있다.** 뷰가 `getShare` 후 `touchShare(share, rec)`로 **재검증 없이 rec 전체를 되쓴다**(fire-and-forget). 그 사이 사용자가 폐기하면 뒤늦은 `touchShare`가 tombstone을 **pkg가 담긴 옛 rec로 덮어써** 링크가 TTL까지 계속 열린다. "폐기"를 누르는 순간은 보통 상대가 링크를 보고 있는 순간이라 창이 비현실적이지 않다 | `export-view.js:99-113` · `share-store.js:60-63` · `share-revoke.js:27` | 코드 추적(경로 확정적) | `touchShare`가 쓰기 직전 `revoked`를 재확인하거나, 접근 통계를 **별도 카운터 키**(`share:hits:{token}` INCR)로 분리해 스냅샷 문서를 건드리지 않게 | **소** |
| **R-09** | D·S4 | **인바디 지연이 앱 시작 동기화 전체를 인질로 잡는다.** 순차 3요청 × 타임아웃 20초 = **최악 60초** > 함수 `maxDuration` **30초** → 504로 pull 응답 자체가 실패해 **그 세션의 운동 병합도 안 된다.** 논리 격리는 되어 있으나 시간 격리가 없다. 게다가 스로틀 도장은 시도 **전에** 찍혀 죽어도 30분 창이 소모된다 | `inbody-cloud.js:103`,`:182-185` · `vercel.json` · `App.jsx:729` | ✅ 실측 `[D①③]`·`[D③]` | ①`cloudPullIfDue` 전체를 **총 예산 타임아웃**(예: `Promise.race` 8~10초)으로 감싸 초과 시 `failed`로 즉시 반환 ②또는 `REQUEST_TIMEOUT_MS`를 20초→6초로 낮춰 3요청 합이 여유 안에 들어오게 | **소** |
| **R-10** | G②·M | **새 체중 1건이 그 달 전체의 판정을 소급 변경한다.** `monthWeight`(그 달 평균) → `targetsByMode` → `dayTargetK`. 적응형 보정은 `from` 날짜로 과거를 보존하는데 **체중 기준선은 보존되지 않는다.** 게다가 `monthWeight`는 **"선택 날짜"의 달**을 쓰므로 달력을 넘기면 기준 자체가 바뀐다 | `App.jsx:642-648`,`:667` | 코드 추적 + 조사원 교차확인 | 판정용 체중을 **그 날짜 기준으로 고정**(그 날 이전 최근 측정, 또는 월별 확정 스냅샷). ⚠️ 판정 전반에 영향 → **골든셋 + 297일 실데이터 diff 필수**. 단독 라운드 권장 | **중~대** |
| **R-11** | A·S | **인수인계 문서가 최근 2주를 전혀 반영하지 않는다.** `ARCHITECTURE.md` §2 파일 구조에 `inbody-cloud.js`·`health-import.js`·`body-import.js`·`import-inbox.js`·`bodyDraft.js`·`importMerge.js` **6개 모듈 전부 누락**, §8 변경 이력은 PR #16까지(현재 #100). 비공식 API 의존은 `inbody-setup.md`에만 있고 인수인계 문서에는 없다 | `docs/ARCHITECTURE.md:24-50`,`:188` | ✅ 문서 확인 | 유입 4경로·저장소·소비처·소급 전파·**비공식 API 의존과 리스크**를 §2/§3/§6에 추가 (프롬프트 산출물 2번) | **중**(문서) |

### P2 — 운영 불편·수동 개입 필요

| ID | 축 | 발견 | 근거 | 처방 |
|---|---|---|---|---|
| R-12 | C③' | 운동 카드 "지금 확인"에 `syncingImports` 가드가 없어 연타가 동시 요청(R-01)을 만든다. 체성분 카드에는 있다 | `App.jsx:2057` vs `:2089` | 같은 가드 적용 (1줄) |
| R-13 | C② | 인증 봉인 KV 쓰기 실패를 삼켜, 봉인이 안 걸린 채 조용히 지나간다 | `import-inbox.js:100-103` | 실패 시 `console.error` + 그 실행은 보수적으로 `throttled` 처리 |
| R-14 | H④ | 측정 시각의 초가 정확히 `00`이면 HAE·클라우드 사서함 키가 충돌해 **골격근·점수가 유입되지 않는다**(≈1/60, `seen` TTL 없어 그날 영구) | ✅ 재현 | 사서함 키에 소스 구분 추가(`{date}\|{ts}\|{src}`) 또는 병합 시 "필드 보강"을 허용 |
| R-15 | E③' | B채널 폴백으로 **수동 확정한 날도 영구 잠금**된다(`draftToRecord`가 `auto`를 안 붙임). 클라우드 복구 후에도 그 날짜는 영영 자동 갱신 대상이 아니다 — 문서에 없다 | `bodyDraft.js:101-115`,`:50` | 문서화, 또는 카드 확정분에 `auto:true` 유지 여부를 사용자 선택으로 |
| R-16 | I | 구조가 깨진 **운동** 항목은 ack되지 않아 사서함에 영구 잔류(체성분은 정리함) | ✅ 재현 | `mergeImports`도 구조 불량 항목을 `ackKeys`에 넣기 |
| R-17 | L·S12 | 해외(비-JST)에서 **같은 운동이 경로별로 다른 날짜**에 귀속. 크론(KST)과 앱(현지)의 "오늘"도 갈림 | ✅ 재현 | 귀속일 기준을 한 곳으로 통일하거나, 최소한 문서에 명시 |
| R-18 | O | 수동으로 같은 유산소를 또 넣으면 **이중 계상 방어가 코드에 없다**(문서 수칙뿐) | `importMerge.js:47` | 같은 날 ±15분·동일 종목이면 경고 표시 |
| R-19 | R②·S13 | 자동 유입분 **일괄 삭제 UI·유틸이 없다**. 식별은 가능(`source`)하나 1건씩 또는 백업 복원뿐 | — | 설정에 "자동 수신분 기간 일괄 삭제" (확인 다이얼로그 + 안전본 자동 백업) |
| R-20 | X1 | 운동 스트릭이 **휴식일 도장을 무시**해 쉬기로 정한 날이 "끊김"으로 잡히고, 반대로 **워치 자동 기록만으로 스트릭이 오른다** | `WorkoutStamp.jsx:12` | `dayHasEx`에 `dayType==="rest"` 예외 추가 |
| R-21 | X4 | 미확정 초안이 쌓여 있어도 "체중 재세요" 독촉이 계속된다(`bodyLog`만 보므로). 클라우드가 죽었을 때 사용자가 받는 유일한 신호가 **틀린 메시지**다 | `App.jsx:612`,`:701` | `lastWeighDate`를 `max(bodyLog, bodyDrafts)`로 |
| R-22 | P | 공유 뷰에 **컨디션 자유기술(`label`·`note`)이 그대로 실린다.** UI 경고는 "진행 사진·이름은 포함되지 않습니다"라고만 안내 | `analysisExport.js:146` · `ClaudeExport.jsx:251` | 경고 문구에 추가하거나 컨디션 메모를 선택적 포함으로 |
| R-23 | P | 앱은 `goals.shareLink` **한 칸**만 들고 있어, 두 기기에서 발급하거나 백업 복원으로 goals가 교체되면 **이전 토큰을 폐기할 방법이 없다**(TTL까지 생존) | `App.jsx:2024-2025` · `share-store.js` | uid→토큰 역색인(Set) 추가 또는 발급 시 이전 토큰 자동 폐기 |
| R-24 | K·S11 | `import:body-cloud-fail`·`-at`·`-authblock`이 유실되면 잠금 방어가 초기화돼 다시 3회 두드린다 | ✅ 재현 `[S11]` | 방어 키에 TTL을 **명시적으로 부여**(의미 있는 만료)하고 유실을 실패로 간주 |
| R-25 | B④ | 크리덴셜 탈취 시 무엇이 열리는지(인바디 전체 측정 이력·계정)가 **어느 문서에도 없다** | — | `inbody-setup.md`에 blast radius 한 문단 |
| R-26 | X5 | "AI 분석 캐시 정리"가 localStorage만 지워 Firestore 사본이 다음 동기화에 되살아난다 | `App.jsx:2037` | `store.delete("body-coaching")` 사용 |
| R-27 | 병합 | `discardBodyDraft`로 버린 초안이라도 그 항목의 **ack fetch가 실패하면** 다음 pull에서 재착지한다(잠금 레코드가 없으므로 통과) | `App.jsx:373-379`,`:767-769` | 폐기 시 ack를 별도로 보장하거나 로컬 "폐기 목록"을 유지 |
| R-28 | 순수 | `aggregateDay`가 `serving` 결측 시 **NaN을 전파**하고, `estimateTDEE`의 `a.k>0` 게이트에서 그 날이 **조용히 통째 누락**된다(exercises는 `||0`로 방어됨) | `utils.js:130-136` | meals도 `||0` / `serving||1` 방어 |
| R-29 | G | `adaptiveOn`을 껐다 켜면 `tdeeHistory`가 되살아나 **과거 날짜 판정도 함께 바뀐다** — "과거 판정 보존" 의도와 충돌 | `App.jsx:638`,`:665-666` | 토글 OFF를 `{from: today, adjust: 0}` 이력으로 기록 |
| R-30 | X8 | 클라우드 pull이 **최근 5건 고정**이라 6일 이상 앱을 안 열면 클라우드 단독으로는 오래된 측정부터 누락(HAE가 돌았다면 사서함에 남음) | `import-inbox.js:82` | 마지막 성공 시각 기준으로 `count`를 동적 산정 |
| R-31 | R·P | `.env.example`에 유입 관련 env **8종이 전부 없다**(`IMPORT_TOKEN`·`IMPORT_UID`·`IMPORT_CUTOVER_DATE`·`IMPORT_BODY_CUTOVER_DATE`·`INBODY_LOGIN_ID/PW`·`INBODY_COUNTRY`·`IMPORT_TZ_OFFSET`·`SHARE_TEST_TOKEN`). KV 설명("선택 — 미설정 시 rate limit fail-open")도 낡았다 — 지금은 KV 없이 사서함 자체가 동작하지 않는다 | `.env.example` | 8종 추가 + KV 설명 갱신 (롤백 스위치 목록의 단일 출처) |

### P3 — 개선·부채

| ID | 축 | 발견 | 근거 |
|---|---|---|---|
| R-32 | S | ESLint 활성 규칙 3개뿐이라 `no-dupe-keys`가 없고, 실제로 중복 키가 게이트를 통과해 있다(`bodyCloudEnabled` 2회, 값 동일해 무해) | `eslint.config.js:19-21` · `App.jsx:736-737` |
| R-33 | S | **`CLAUDE.md` 지침 위반**: "체성분 파생 지표는 컴포넌트에 인라인으로 다시 넣지 말고 `bodyMetrics.js`의 순수 함수를 사용한다"인데 `analysisExport`가 체지방량을 인라인 재구현(현재 값은 동일) | `analysisExport.js:297` vs `bodyMetrics.js:13` |
| R-34 | S | 주간 등급 산식이 `StatsTab` 안에 **2곳 복붙**, `dayTargetK` 공식이 **3파일 복붙** | `StatsTab.jsx:151-162`/`:198-208` · `App.jsx:667`·`StatsTab.jsx:16`·`analysisExport.js:74` |
| R-35 | S | **유입 → 병합 → 통계 → 목표 → 판정 → 공유 링크 전 구간 관통 통합 테스트가 0개.** 35개 테스트는 단위·계약 위주이고, 가장 긴 사슬을 도는 것이 `inbody-cloud.test.js`(pull→자동확정)까지다 | `src/__tests__/` 전수 |
| R-36 | P | `firestore.rules`에 필드 검증이 전혀 없어 클라이언트가 `auto:true`를 위조할 수 있다. **다만 `isSelf(uid)`라 본인 데이터 한정** — 문서 지향 저장소의 트레이드오프로 보이나 기록돼 있지 않다 | `firestore.rules:73-76` |
| R-37 | K | ack는 500건 상한이 있으나 사서함 적재에는 상한이 없다 — 초장기(6개월+) 미개봉 시 ack가 400으로 실패해 교착 가능(현실성 낮음) | `import-inbox.js:206-208` |
| R-38 | B③' | 인바디 JWT(24h)를 캐시하지 않아 pull마다 재로그인한다(30분 스로틀이 상한이라 하루 최대 ~48회) | `inbody-cloud.js:182-184` |

## 3-2. 정상 확인 목록 — 검사했고 문제없었던 것

> 발견 목록만으로는 안심의 근거가 못 된다. **무엇을 검사했는지**를 남긴다.

### 핵심 불변 조건 (전부 성립)

| # | 확인 항목 | 검증 방식 | 결과 |
|---|---|---|---|
| ✅1 | **"muscle 미입력이 통계를 0으로 오염하지 않는다"** | `draftToRecord`가 `m>0` 강제 + 초안이 `bodylog` 밖 별도 키 | 성립 (`bodyDraft.js:103`) |
| ✅2 | **초안이 통계에 새는 경로 0개** | `bodyDrafts` 소비처 전수 grep — BodyTab 카드·백업·App 상태뿐. StatsTab·ClaudeExport·pushState·estimateTDEE는 전부 `bodyLog`만 받는다 | 누수 0 |
| ✅3 | **insert-only(운동) 계약** | `GET seen → HSET inbox → SET NX seen` 순서로 "도장은 찍혔는데 사서함에 없음" 창이 없다 | 성립 (`health-import.js:126-131`) |
| ✅4 | **병합 멱등성** | ack 유실 후 재pull → 운동 중복 추가 0건, 체성분 재착지 0건 | 실행 확인 |
| ✅5 | **사용자 편집분 잠금** | 편집 시 `auto`·`sampleTs` 삭제 → `lockedAgainst` 항상 잠금 → 자동분 폐기 | 실행 확인 (S9) |
| ✅6 | **저장·ack 순서** | `store.set` → `ack` 순서라 "ack했는데 저장 실패" 유실 창이 없다 | `App.jsx:746`→`:750` |
| ✅7 | **`flushPendingSync` → `getAllData` → `syncImports` 순서 계약** | `resyncAll`이 강제. 순서가 바뀌면 옛값이 오프라인 수정을 덮거나 병합 결과가 되돌려진다 | `App.jsx:245-262` |

### 보안·인증

| # | 확인 항목 | 결과 |
|---|---|---|
| ✅8 | 인바디 **크리덴셜 값**이 로그·응답·KV·백업·공유 링크 어디에도 나가지 않는다 | 확인 (`[B①]` — `secret1234` 부재 검증) |
| ✅9 | 인바디 **JWT**가 KV·응답 어디에도 남지 않는다(지역변수) | 확인 (`[B③]`) |
| ✅10 | `process.env.INBODY_LOGIN`을 읽는 코드는 `api/import-inbox.js` **1곳뿐** | 확인 (`[B②]`) |
| ✅11 | 클라우드 pull은 **기록 주인 uid**(`IMPORT_UID`)에서만 트리거된다 | 확인 (`[P]`) |
| ✅12 | `idToken` 위조는 401 | 확인 (`[P]`) |
| ✅13 | 크리덴셜 수정 시 지문 변경으로 **봉인 즉시 해제**(24h 대기 불필요) | 확인 (`[C]`) |
| ✅14 | 인증 실패는 **1회로 봉인** — 3-strike 카운트다운을 보호한다(순차 요청 기준) | 확인 (`[S6]`) |
| ✅15 | 로그 위생 — 본문 전문 없음, 건수·미매칭 지표명 요약만 | `health-import.js:140-142` |
| ✅16 | 공유 뷰 방어 4중 — 32자 hex 토큰·`noindex`·`no-store`·404/410 구분·분당 30 | `export-view.js` |

### 검문소(입력 검증)

| # | 확인 항목 | 결과 |
|---|---|---|
| ✅17 | 단위 오표기(lb↔kg), 소수형 체지방률, 범위 밖 체지방·골격근·점수, 미지 단위(stone) — **1주치 대량 유입 전량 차단** | 실행 확인 (S13, 7/7 거부 × 7케이스) |
| ✅18 | 운동 kJ 오염(×4.184)이 `KCAL_MAX=2000`에서 차단 | 실행 확인 |
| ✅19 | 오인 수입 차단 — `미식축구`·`호주 축구`·`휠체어 걷기`가 unknown, `요가`·`필라테스`는 화이트리스트 밖 | 실행 확인 |
| ✅20 | 수식어 포함 매칭 — `오후 실외 걷기`→걷기, `저녁 기능성 근력 훈련`→근력 운동 | 실행 확인 |

### 격리·복원력

| # | 확인 항목 | 결과 |
|---|---|---|
| ✅21 | **클라우드 실패가 운동 사서함 pull을 논리적으로 막지 않는다** | 확인 (`[D②]`) |
| ✅22 | 롤백 스위치 독립 — `INBODY_LOGIN_*`만 지우면 클라우드만 꺼지고 운동·HAE 유지 | 확인 (`[R①]`) |
| ✅23 | `seen` 키 유실 → 재유입되나 병합이 멱등이라 **무해** | 실행 확인 (S11) |
| ✅24 | `import:seen:*` 무한 증가 비용 — 연 약 1,200키 ≈ **120KB**, 실질 무해 | 계산 |
| ✅25 | 주간 성적표 푸시가 **화석 수치를 보내지 않는다** — `weekStart` 검증 후 불일치 시 일반 문구로 폴백 | 실행 확인 (S10) |
| ✅26 | 소급 유입이 통계·목표·판정에 **자동 반영**된다 — 파생값 캐시가 실질적으로 없다 | 소비처 전수 확인 |
| ✅27 | 대량 오유입 삭제 후 통계·TDEE가 **자동 복구**된다(전부 재계산) | 구조 확인 |
| ✅28 | 휴식일 자동 복귀가 **전 화면 단일 기준**(`effectiveDayMode`) — 홈·달력·주간·밴드차트·내보내기가 같은 함수 호출. 소급 도착도 동일 반영 | 실행 확인 (S14, 경계값 300/301) |
| ✅29 | 백업이 **provenance를 100% 보존**한다(`auto`·`sampleTs`·`source`·`importKey`·`device`) | 코드 확인 |
| ✅30 | 규칙 단일 출처 — 체성분 검문소가 운동 검문소의 날짜 파서를 재사용, 사서함 기입은 `body-inbox-store.js`로 단일화 | 코드 확인 |

## 3-3. 검증 과정에서 **기각된** 지적

정직성을 위해, 조사 중 제기됐으나 재현에 실패해 레지스터에 넣지 않은 것을 남긴다.

| 지적 | 검증 | 결론 |
|---|---|---|
| "HAE 경로가 나중에 도착하면 골격근·점수가 영구 유실된다" | 문서화된 실제 설정(HAE **분 단위 절삭** → `ts_HAE ≤ ts_cloud`)에서 3개 도착 순서를 모두 재현 → **전부 정상**. 유실은 `ts_HAE > ts_cloud`에서만 발생하는데 절삭은 내림만 한다 | **기각** (단 R-14의 초=00 경계는 실재) |
| "`estimateTDEE`가 식단 미기록일의 운동을 함께 버려 `measuredMaint`가 과대평가된다" | 최근 3·6·10일을 식단 미기록 + 운동 자동수신으로 두고 실행 → **delta 이동 0kcal**. `avgIntake`와 `avgExercise`가 같은 기록일 부분집합에서 나와 내부적으로 정합 | **기각** (잔여 이슈: `deltaWeight`는 28일 전체를 보는데 `avgIntake`는 기록일만 본다 — 선행 사안, 자동 유입과 무관) |
| "부위 구성비 인사이트가 코드베이스에 없다" | `StatsTab`에는 없는 것이 맞으나 **`analysisExport.js:194-206`에 주간 구성비 표가 있다** | **부분 기각** → R-05로 확정 |

## 3-4. 승인 요청

**Phase 4에서 수정할 것을 골라 주세요.**

- **P0 2건** (R-01 스로틀 원자성 · R-02 bodylog 유실) — R-01은 1~2줄, R-02는 `store.js` 중간 규모
- **P1 9건** (R-03~R-11) — 이 중 **R-04·R-05·R-06·R-07·R-08·R-09는 전부 소규모**라 한 라운드로 가능.
  **R-10(monthWeight 소급)은 판정 전반에 영향**하므로 골든셋 + 297일 실데이터 diff가 필수 — **단독 라운드를 권장**합니다.
  **R-11(ARCHITECTURE.md)**은 프롬프트 산출물 2번이라 어차피 필요합니다.
- **P2 20건 · P3 7건** — 백로그 문서화만 하고 넘어가는 것이 기본입니다. 이 중 올리고 싶은 것이 있으면 지정해 주세요
  (R-12는 1줄이고 R-01과 같은 원인이라 **함께 고치는 것을 권합니다**).

권장 묶음: **① R-01 + R-12 (계정 잠금, 최소 변경) → ② R-04·R-05·R-06 (분석·관측 정합성, 소규모) → ③ R-07·R-08 (공유 링크 보안, 소규모) → ④ R-09 (타임아웃 예산) → ⑤ R-02 (bodylog 병합) → ⑥ R-10 단독 라운드 → ⑦ R-11 문서**

---

## 3-5. 부록 — 병렬 조사원 교차 대조 결과 (Phase 3 보강)

Phase 0~3과 **독립적으로** 7개 서브시스템을 정독한 조사원 8명의 결과(교차점 24건 · gap 20건)를
대조했다. 아래는 **내가 직접 재확인해 실재를 확정한 것만** 레지스터에 올린 것이다.
조사원이 제기했으나 재현되지 않은 것은 §3-3(기각)에 이미 반영돼 있다.

### 추가 P1

| ID | 축 | 발견 | 근거 | 처방 | 규모 |
|---|---|---|---|---|---|
| **R-39** | P·B | **`IMPORT_TOKEN` 추측 시도에 횟수 제한이 없다.** 토큰 대조가 rate limit **보다 먼저** 실행되어, 토큰 불일치 요청(401)은 rate limit 카운터에 **전혀 집계되지 않는다.** 두 검문소 모두 같은 순서다. 비교도 상수시간(`!==`)이 아니다. 이 토큰 하나가 운동·체성분 양쪽 유입 권한이다 | `health-import.js:48` → `:52` · `body-import.js:43` → `:47` | **`rateLimit` 호출을 토큰 대조 앞으로 이동**(순서 교환). 필요하면 실패 전용 카운터를 더 낮은 상한으로 분리 | **각 파일 1줄** |

### 추가 P2

| ID | 축 | 발견 | 근거 | 처방 |
|---|---|---|---|---|
| R-40 | P·Q | **`CRON_SECRET`이 선택적이라 미설정 시 크론 엔드포인트가 무인증으로 열린다.** `if (secret && ...)` 형태라 secret이 falsy면 인증 자체를 건너뛴다. 이 핸들러는 `_lib/security.js`를 import조차 하지 않아 `checkOrigin`·`rateLimit`도 없다. 외부인이 반복 호출하면 푸시 발송·KV 읽기를 유발할 수 있다. ❓ 배포 env의 실제 설정 여부는 저장소에서 확인 불가 | `cron-reminders.js:21-24` · import 목록 `:11-13` | `CRON_SECRET`을 **필수화**(미설정 시 500) + `rateLimit` 추가. `.env.example`의 "선택" 표기도 정정 |
| R-41 | S | **품질 게이트와 CI가 `api/`를 정적 검사하지 않는다.** `eslint.config.js:25-35`에 `files:["api/**/*.js"]` 블록이 있는데, 훅(`check.mjs:10`)과 CI(`ci.yml:30`) 모두 `npx eslint src`만 실행한다. `package.json:11`의 `"lint": "eslint src api"`는 **어디서도 호출되지 않는다.** 즉 자동 유입 코드 **2,173줄 전체가 정적 검사 밖**이다 | `check.mjs:10` · `ci.yml:30` · `package.json:11` | 두 곳을 `eslint src api`로. ⚠️ **`CLAUDE.md`가 게이트 변경을 "사용자가 직접 지시한 경우에만"으로 제한하므로 별도 승인 항목으로 분리한다** |
| R-42 | E·M | **자동 수신 운동을 편집하면 워치 실측 kcal이 추정값으로 바뀐다.** 병합 시 `m = deriveM(kcal, duration, monthWeight)`를 역산해 저장하는데(`monthWeight`는 그때 선택돼 있던 날짜의 달 평균), `EditExForm`은 저장된 `m × 현재 체중 × 분/60`으로 **kcal을 재계산**한다. 워치가 측정한 실제 소모가 MET 근사로 대체된다 | `importMerge.js:11-22` · `App.jsx:328` | 편집 시 `source==="watch"` 항목은 kcal 재계산을 건너뛰거나, 사용자에게 "실측값을 덮어씁니다" 확인 |
| R-43 | K·N | **`profile`(키·나이)이 백업 계약 밖에 있다.** `buildBackup` 인자에 없어 백업→복원만으로는 복원되지 않는다. 복원 후 `calcTargets`가 **기본값 175cm/35세로 폴백**하므로 실제 체형이 다르면 목표 kcal이 조용히 달라지고, 분석 패키지 첫 줄도 `?cm · ?세`가 된다. (진행 사진 제외는 용량 보호로 **의도 명시**됨) | `backup.js:12` vs `App.jsx:110` · `utils.js:71` | `buildBackup`/복원에 `profile` 포함 |
| R-44 | M·Q | **`push:state`에 TTL이 없고, 인앱 배너와 크론 푸시의 입력 출처가 다르다.** 인앱은 Firestore 원본, 크론은 앱이 마지막에 올린 KV 스냅샷 — 같은 순수 함수를 쓰지만 **"앱에서는 배너가 사라졌는데 밤에 푸시가 온다"가 구조적으로 가능**하다 | `App.jsx:610-613` vs `cron-reminders.js:47-58` | 크론이 KV 대신 최신 신호(`import:*log`의 `at`)를 함께 보게 하거나(R-06과 통합), `push:state`에 TTL 부여 |

### 추가 P3

| ID | 발견 | 근거 |
|---|---|---|
| R-45 | `IMPORT_TZ_OFFSET`을 바꾸면 같은 측정의 **`sampleTs`(epoch)가 달라져 사서함 키가 새로 생긴다** — 이미 확정된 날이 새 초안으로 되돌아올 수 있다(date·hour는 불변) | `inbody-cloud.js:43-50` → `body-import-rules.js:119`,`:171` |
| R-46 | `accountCreatedAt`이 **기기 로컬 값**이라 새 기기·브라우저 데이터 삭제 후 `accountMature=false`가 되어 **백업 리마인더가 15일간 침묵**한다 — 정작 백업이 가장 필요한 상황에서 | `App.jsx:229-231`,`:598-605` · `reminders.js:31` |
| R-47 | `vercel.json`에 `cron-reminders`의 `maxDuration`이 없다. uid 수만큼 순차 루프(각 KV GET 2회 + web-push 최대 2회)라 구독자가 늘면 기본 타임아웃 위험(현재 1인이라 잠재) | `vercel.json:3-5` · `cron-reminders.js:38-85` |
| R-48 | **CSV 내보내기에 provenance가 없고 체성분 `score`도 빠져 있다**(운동에 `source`/`device` 없음). "사람이 보는 용도"로 문서화돼 있어 복원 계약은 아니나, 유일한 표 형태 산출물이다 | `App.jsx:502-513` · `backup.js:2` |
| R-49 | `VITE_OWNER_EMAIL`과 `firestore.rules:32`의 하드코딩 운영자 이메일이 **수동 동기화**다(규칙은 env를 못 읽음). 한쪽만 바꾸면 "클라이언트는 운영자로 보는데 규칙은 거부"가 조용히 생긴다. 정합성 검사 없음 | `src/auth.js:15-16` · `firestore.rules:30-34` |
| R-50 | `StatsTab`의 `dayTargets` 폴백이 **키·나이를 하드코딩(175/35)하고 목표 체중을 현재 체중 자리에 넣는다.** 실앱에서는 App이 항상 `targetsByMode`를 넘겨 미발현이지만, prop이 빠지면 조용히 다른 목표로 판정한다 | `StatsTab.jsx:11`,`:13` |

### Phase 1 정정 1건

> **축 M "파생값을 저장·캐시하는 코드"는 4곳이 아니라 5곳이다.**
> 다섯 번째는 **운동 항목의 `kcal`·`m`**이다 — 입력·병합 시점에 계산되어 `day` 문서에 **영속화**되고
> 이후 체중이 바뀌어도 재계산되지 않는다(`App.jsx:319` · `importMerge.js:21-24`).
> 자동 수신분의 `kcal`은 워치 실측값이라 오히려 정확하지만, `m`이 그때의 `monthWeight`로 역산돼
> 저장되므로 **편집 시 실측 kcal이 추정값으로 대체되는 경로**(R-42)가 열린다.

### R-01 처방 보강

> `failKey`도 `GET → parseInt → SET`의 **read-modify-write**라(`import-inbox.js:70`,`:99`)
> 동시 실패 시 증분이 유실된다. R-01 수정 시 **`INCR`로 함께 교체**할 것.

### 조사원이 제기했으나 확인하지 못한 것 (미확인으로 남김)

배포 env의 실제 설정 상태(`CRON_SECRET`·`PRODUCTION_ORIGIN`·`VITE_RECAPTCHA_SITE_KEY`·KV 계열) ·
`IMPORT_UID`가 실제 기록 주인 uid와 일치하는지 · Upstash REST의 `SET … NX` 실패 반환값이 정확히 `null`인지
(멱등 계약 전체가 이 가정 위에 있고 근거는 테스트 목뿐) · `firestore.rules`의 실제 배포 여부(CI에 배포 단계 없음) ·
인바디 프로토콜의 현재 유효성(네트워크 요청 금지로 미검증) · `content-length` 위조로 본문 상한을 우회할 수 있는지.
**이들은 저장소만으로는 판정할 수 없다 — 필요하면 Phase 4에서 별도 확인 절차를 정해야 한다.**

## 3-6. 갱신된 승인 요청

| 심각도 | 건수 | ID |
|---|---|---|
| **P0** | 2 | R-01 · R-02 |
| **P1** | 10 | R-03 ~ R-11, **R-39** |
| **P2** | 25 | R-12 ~ R-31, R-40 ~ R-44 |
| **P3** | 13 | R-32 ~ R-38, R-45 ~ R-50 |

**권장 묶음 (갱신)**

1. **계정 잠금·유입 인증** — R-01(+`INCR`) · R-12 · **R-39** ← 전부 소규모, 원인이 같은 계열
2. **분석·관측 정합성** — R-04 · R-05 · R-06 (+R-44 통합 가능)
3. **공유 링크 보안** — R-07 · R-08
4. **시간 예산** — R-09
5. **bodylog 병합** — R-02
6. **monthWeight 소급** — R-10 *(단독 라운드 · 골든셋 + 297일 diff 필수)*
7. **문서** — R-11 · R-31 · R-25

**별도 승인이 필요한 항목**: **R-41**(게이트를 `eslint src api`로 확장)은 `CLAUDE.md`가
"게이트 자체의 변경은 사용자가 직접 지시한 경우에만"으로 제한하므로, **명시적으로 지시해 주셔야 착수합니다.**

---

# Phase 4 — 승인된 수정 (P0 2건 · P1 10건 · R-41)

승인 범위: **P0 전부 + P1 전부 + R-41(게이트 확장, 별도 지시)**. P2 25건·P3 13건은 백로그로 남긴다.

| ID | 심각도 | 커밋 | 무엇을 고쳤나 | 회귀 방어 |
|---|---|---|---|---|
| **R-01** | P0 | `9079b9c` | 클라우드 pull 선점을 `SET NX EX`로 원자화. 실패 카운터도 `INCR`(read-modify-write는 동시 실패 시 증분 유실) | 동시 pull 2건 → 로그인 1회 · PW 오류 동시 2건도 3-strike 1개만 소모 · 순차 재시도는 기존과 동일 (3건) |
| **R-39** | P1 | `9079b9c` | rate limit을 토큰 대조 **앞으로** 이동 — 401이 카운터에 안 잡혀 토큰 추측에 상한이 없었다 | 기존 검문소 계약 테스트 유지 |
| **R-09** | P1 | `9079b9c` | 총 예산 12초 + 요청별 타임아웃 20→8초 (3단 순차 최악 60초 > `maxDuration` 30초 → 504로 운동 pull까지 죽던 경로) | 지연 주입 시 응답 지연 실측 · 타임아웃 후 스로틀 소모 확인 |
| **R-07** | P1 | `9079b9c` | 백업 JSON에서 `goals.shareLink` 제외. 복원은 현재 링크를 이월 | 토큰 문자열이 파일에 없음 + goals 나머지 보존 (2건) |
| **R-08** | P1 | `9079b9c` | 공유 뷰 접근 통계를 별도 카운터 키로 분리 — 읽기 경로가 스냅샷을 되쓰지 않는다 | 조회 중 폐기해도 pkg가 부활하지 않고 410 유지 |
| **R-06** | P1 | `fdd2a29` | 크론이 KV 수신 로그의 최신 시각을 직접 읽어 5일 침묵 시 푸시. 한 번도 안 쓴 경로는 제외 | 임계·경계·채널 분리·손상값 (7건) |
| **R-41** | — | `fdd2a29` | 훅·CI 정적 검사를 `eslint src api`로 확장 (서버리스 2,000여 줄이 검사 밖이었다) | 훅 실행 확인 · CLAUDE.md 정의 동기화 |
| **R-05** | P1 | `fcd93a5` | 주간 구성비 표에 **근력 열** 추가 — 자동 수신 근력이 '기타'로 떨어져 상·하체 0%가 거짓으로 읽혔다 | 297일 diff로 판정·기존 비중 불변 확인 후 기준선 갱신 |
| **R-04** | P1 | `fcd93a5` | 분석 계약에 출처(`[자동확정]`/`[자동수신]`)·측정 시각·⌚·**측정 규칙 줄** 추가 | 출처 3종 구분 · 시각 병기 · 규칙 줄 조건부 (3건) |
| **R-03** | P1 | `fcd93a5` | 체성분 히스토리·초안 카드에 측정 시각 병기, 오후 측정은 🌆 | 시각 포맷이 실행 타임존에 불변(TZ 변경 실행으로 확인) |
| **R-02** | P0 | `79cb6fa` | 재전송 시 `bodylog`·`body-drafts`를 원격과 **병합**. 원격 조회 실패면 전송하지 않음. 명시적 삭제는 흔적으로 보호 | 병합 규칙 6종 + 흔적 2종 + flush 경로 3종 (11건) |
| **R-10** | P1 | `5eee288` | 판정 기준 체중을 **그 날짜가 속한 달**의 평균으로 고정(`makeDayTargets` 단일 출처) | 보는 시점 비의존 · 다른 달 소급 차단 · 옛 산식과 수학적 동치 (12건) |
| **R-11** | P1 | 이 커밋 | `ARCHITECTURE.md`에 §3.5 자동 유입(경로 4종·비공식 API 리스크·저장소·소급 전파·불변 조건 5개·관측성) 신설, 파일 구조·지뢰 4건·변경 이력(#17~#100) 갱신 | — |

**테스트**: 34파일 **407건** 통과 (감사 전 **368건** → +39건). `eslint src api` 통과.

## Phase 4에서 드러난 것 (게이트가 잡아낸 실수)

감사 문서의 신뢰도를 위해, 수정 중 **내가 틀렸다가 게이트·검증에 걸린 것**을 남긴다.

| # | 무엇 | 어떻게 드러났나 |
|---|---|---|
| 1 | `INCR`로 바꾼 뒤 실패 카운터가 오르지 않아 연타 상한이 4회로 늘었다 | 기존 계약 테스트가 즉시 실패 — 테스트 KV 목이 `INCR`을 지원하지 않았다(목의 구멍) |
| 2 | 측정 시각을 `getHours()`로 뽑아 **서버(UTC)에서 08:24가 23:24로** 표시됐다 | 새 출력을 눈으로 확인하다 발견. 유입이 쓰는 고정 오프셋(+09:00) 기준으로 교정 |
| 3 | 297일 픽스처의 `targetsByMode`가 bodyLog와 무관한 하드코딩 값이라, R-10 영향이 1kcal로 **과소 측정**됐다 | 예상과 어긋나 픽스처를 열어봄 → 앱이 실제로 계산하는 방식으로 재측정(진짜 영향: 판정 5건 차이) |
| 4 | 테스트 단언에서 "인바디"를 문자열 검사해, 안내 문구의 "인바디 연결"에 걸렸다 | 테스트 실패 — 채널 라벨("인바디 체성분")로 정확히 검사하도록 수정 |

## 남은 백로그 (승인 범위 밖)

- **P2 25건** — R-12·R-13~R-31, R-40·R-42·R-43·R-44. 이 중 **R-12**(운동 카드 버튼 가드)는
  R-01이 동시 요청을 서버에서 원자적으로 막게 되어 **실효 위험이 사라졌다**(중복 요청은 이제
  `throttled`로 즉시 반환). 버튼 가드 자체는 UX 개선으로 남는다.
- **P3 13건** — R-32~R-38, R-45~R-50. 이 중 **R-34**(`dayTargetK` 3파일 복붙)는 R-10 수정으로
  **해소됐다**(단일 출처 `makeDayTargets`).
- 저장소만으로 판정 불가라 **미확인**으로 남은 6건(배포 env 실제 상태, Upstash `SET NX` 반환값 계약,
  `firestore.rules` 실배포 여부 등)은 §3-5 부록에 그대로 있다.

---

# Phase 5 — 검증 프로토콜 (R1~R4)

프롬프트 §4의 4중 검증을 수정 후 코드에 대해 실행했다. **인바디 클라우드 실제 로그인은 여전히 0회**(전부 모킹).

## R1 — 정적 재추적 (축 A~S 재점검 · 신규 결함 0)

수정이 불변 조건을 깨지 않았는지 코드로 재확인:

| # | 불변 조건 | 결과 |
|---|---|---|
| ① | 초안(`bodyDrafts`)이 통계·내보내기로 새는 경로 | **누수 0** — 읽는 곳은 App 상태·BodyTab·backup뿐 |
| ② | insert-only 순서 `GET seen → HSET inbox → SET NX seen` | 유지 |
| ③ | `draftToRecord`의 `muscle > 0` 강제 | 유지 |
| ④ | 잠금은 파생 상태(편집 시 `auto`·`sampleTs` 삭제) | 유지 |
| ⑤ | 집합 문서(`bodylog`·`body-drafts`)는 재전송 시 병합 | **신규 적용** |
| ⑥ | 판정 기준 목표가 단일 출처(`makeDayTargets`) | **신규 적용** (App·StatsTab·내보내기 공용) |

신규 결함: **0**. 수정 과정에서 새로 드러난 것 1건(`INCR` 실패 시 상한 방어가 조용히 죽는 경로)은
같은 라운드에서 로그를 남기도록 보강했다 — 막을 수는 없어도 침묵하지는 않는다.

## R2 — 시나리오 S1~S14 재실행

수정된 코드로 감사 시나리오를 다시 돌렸다 (감사 전용 테스트 **21건 전부 통과**).

| 시나리오 | 감사 시점 | 수정 후 |
|---|---|---|
| S2 동시 pull | ⚠️ 로그인 2회 · 3-strike 2개 소모 | ✅ **로그인 1회 · 1개만 소모** (진 쪽은 `throttled`로 이유가 실림) |
| S6 연타 10회 | ✅ 3회(일시 오류) / 1회(인증 실패) | ✅ 동일 유지 — 선점은 실행 후 해제되므로 순차 재시도는 그대로 |
| S4 인바디 지연·500 | ⚠️ 최악 60초 > 상한 30초 | ✅ 총 예산 12초 · 요청별 8초로 상한 안에 들어옴 (논리 격리는 기존대로 유지) |
| S5 인증 실패 | ✅ 1회 봉인 · 즉시 해제 | ✅ 동일 + 봉인 쓰기 실패가 로그로 드러남 |
| S10 2주 침묵 | ⚠️ 운동 침묵 감지기 0개 | ✅ **크론이 5일 침묵을 감지해 푸시**(한 번도 안 쓴 경로는 제외) |
| S1·S3·S7·S9·S11·S12·S13·S14 | ✅/⚠️ (Phase 2 표) | 변동 없음 — 재실행 결과 동일 |
| S8 이중 유입 | ①②③ ✅ / ④ ⚠️ / ⑥⑦ ❓ | 동일 — **R-14(초=00 키 충돌)는 P2라 승인 범위 밖**, 그대로 남아 있다 |

## R3 — 회귀 (골든셋 전량 + 297일 실데이터 diff)

- **전체 스위트 407건 통과** (감사 전 **368건** → +39건). `eslint src api` 통과. `npm run build` 정상.
- **297일 diff — R-05(근력 열)**: 줄 수 불변(요약 412 / 상세 834), 다른 줄 44개가 **전부 근력 열 삽입**.
  판정(✓/✗)·유효목표·기존 유산소/상체/하체/코어/기타 % 값은 **한 글자도 바뀌지 않았다.**
  확인 후 기준선 해시를 근거와 함께 갱신했다.
- **297일 diff — R-10(판정 기준 체중)**: 앱이 실제로 계산하는 방식으로 옛/새를 비교했다.
  - 옛 동작: **10월을 보며 만든 문서와 7월을 보며 만든 문서의 판정이 5건 달랐다** (같은 297일인데).
  - 새 동작: 보는 시점과 무관하게 항상 동일한 문서.
  - 이행 비용: 각 시점 대비 판정 2~4건 변화(297일 중), 유효목표 최대 차이 27~41kcal.
  - ⚠️ 이 과정에서 **297일 픽스처의 `targetsByMode`가 bodyLog와 무관한 하드코딩 값**임을 발견했다
    (그대로 썼다면 영향을 1kcal로 과소 측정할 뻔했다). 픽스처 자체의 개선은 백로그.

## R4 — 독립 재검산 (앱 코드 미사용)

보고서의 수치 주장을 **`adaptiveTDEE.js`를 import하지 않고** 문서화된 산식만으로 다시 계산해 대조했다.

| 주장 | 재검산 | 보고서 | |
|---|---|---|---|
| 기준선 delta | +173 | +173 | ✅ |
| F② 아침→저녁 전환 후 delta | −240 | −240 | ✅ |
| **F② 이동폭** | **−413** | **−413** | ✅ |
| F② 역방향 (클램프 포화) | +300 | +300 | ✅ |
| G① +1 / +3 / **+5** kg @최신일 이동폭 | −57 / −171 / **−284** | 동일 | ✅ |
| G① +1kg @최고참일 이동폭 | +57 | +57 | ✅ |
| G① +10kg @최신일 (포화) | −300 | −300 | ✅ |
| 기울기 0.01kg/day 당 kcal | 77 | 77 | ✅ |

**10/10 일치.** 불일치 0.

## 수정하지 않은 것 (그대로 남아 있음)

승인 범위가 P0+P1+R-41이었으므로 아래는 **의도적으로 남겼다** — 다음 라운드의 후보다.

- **R-14** 측정 초가 정확히 `00`이면 HAE·클라우드 사서함 키가 충돌해 골격근·점수가 유입되지 않는다(≈1/60)
- **R-16** 구조가 깨진 운동 항목이 사서함에 영구 잔류(체성분과 비대칭)
- **R-17** 해외(비-JST)에서 같은 운동이 경로별로 다른 날짜에 귀속
- **R-18** 수동 중복 입력의 이중 계상 방어가 코드에 없음
- **R-19** 자동 유입분 일괄 삭제 경로 없음
- **R-40** `CRON_SECRET` 미설정 시 크론이 무인증
- **R-31** `.env.example`에 유입 관련 env 8종 누락
- 그 외 P2·P3 전량, 그리고 저장소만으로 판정 불가한 **미확인 6건**

## Phase 5 후속 — 완결성 재점검에서 추가로 고친 것

수정 13건을 하나씩 되짚으며 "프롬프트가 요구한 것을 정말 다 했나, 부분적으로만 했나"를 다시 봤다.
승인 범위 자체는 전부 이행됐고, **불완전했던 지점 2건**을 같은 라운드에서 마저 고쳤다.

| # | 무엇이 불완전했나 | 조치 |
|---|---|---|
| 1 | `pushState`의 `useMemo` 의존성에 `dayTargets`가 빠져 있었다. 키·나이를 고치면 목표가 바뀌는데 재계산이 안 걸려, **주간 성적표의 단백질 달성일이 옛 기준으로 굳고 그 값이 크론 푸시로 나갈 수 있었다** | 의존성 추가 |
| 2 | `withBudget`의 타임아웃 타이머를 해제하지 않았다. pull이 빨리 끝나도 타이머가 이벤트 루프를 붙잡아 **서버리스 함수가 예산(12초)만큼 더 살아 있었다** | `finally`에서 `clearTimeout` |

### R-02의 잔여 범위 (정직한 한계)

`mergeForFlush`는 **오프라인 재전송(`flushPendingSync`) 경로에만** 적용된다 — 감사가 지목한 P0
시나리오(대기 창이 몇 시간~며칠)가 그것이기 때문이다. **온라인 `store.set` 경로는 여전히
last-write-wins**다: 두 기기가 각자 원격을 읽은 뒤 몇 초 안에 둘 다 `bodylog`를 쓰면 나중 쓰기가
이긴다. 창이 수 초로 좁아 우선순위를 낮췄을 뿐, 0은 아니다.

`store.set`까지 병합하려면 쓰기마다 원격 조회가 붙고(읽기 비용), 초안 확정처럼 "지우는 것이
정상인" 흐름과 병합이 부딪혀 초안이 잠깐 되살아나는 깜빡임이 생긴다. 그래서 이번 라운드에서는
**하지 않았다**. 필요해지면 별도 항목으로 다룬다.

### 되짚으며 확인한 것 (문제 없음)

- 13건 전부 코드에 실재 — 흔적 검색으로 개별 확인
- R-39는 **두 검문소 모두**에서 rate limit이 토큰 대조보다 앞에 온다
- `dayTargets`가 홈·통계 탭·푸시 상태·내보내기(공유 링크 포함) **네 소비처 전부**에 닿는다
- `targetsByMode.rest`를 읽는 곳이 더는 없다 — 휴식일 목표도 `dayTargets` 단일 출처를 탄다
- `analysisExport`가 `bodyDraft.js`를 import하게 됐지만 그 모듈은 **import 0개인 순수 모듈**이라
  서버리스 번들(`export-view`)에 안전하다 — 실제 로드로 확인

## 문서 수치 재검산 (PR 직전 자체 검증)

보고서가 스스로 주장하는 수치를 전부 다시 세어 대조했다. **4건이 틀렸고 정정했다.**

| 주장 | 실제 | 조치 |
|---|---|---|
| 테스트 기준선 "감사 전 374건" | **368건** (`origin/main`을 별도 워크트리에 체크아웃해 실측) — 374는 Phase 4-1 커밋 시점의 중간값이었다 | 368 → +39건으로 정정 |
| 프롬프트 헤더 "H2 10 + H3 2" | H2 **9** + H3 **3** (합계 13은 맞음) | 내역 정정 |
| "테스트 35파일" | `.test` 파일 **34개** + 픽스처 2개 | 정정 |
| "소비처 전수 (13곳)" | Phase 1에서 스트릭(C4')을 추가해 **14곳** | 정정 |

**대조해서 맞았던 것**: 레지스터 ID **R-01~R-50 빠짐없이 50개**(P0 2 + P1 10 + P2 25 + P3 13 = 50과 일치) ·
정상 확인 목록 **30건** · KV 키 표 **14개** · Phase 0의 코드 규모(`api` 2,173줄/21파일, `src` 7,553줄/48파일 —
기준 커밋 `475bed6`에서 실측) · 현재 테스트 **407건**.

### 산출물 명세 대조 (프롬프트 §5)

| 요구 | 상태 |
|---|---|
| ① `docs/system-audit-2026-08.md` — 인벤토리·전파 그래프·리스크 레지스터·정상 확인 목록·시나리오 결과·검증 로그·백로그 | ✅ 7개 항목 전부 |
| ② `docs/ARCHITECTURE.md` — 유입 4경로·저장소·**소비처**·소급 전파·비공식 API 의존과 그 리스크 | ✅ — 단 **「소비처」가 빠져 있던 것을 PR 직전 대조에서 발견해 채웠다**(§3.5 소비처 14) |
| ③ P0/P1 수정 PR (승인분 한정) | ✅ [#101](https://github.com/munansa1003/daniel-tracker/pull/101) — 13커밋 · 32파일 |
