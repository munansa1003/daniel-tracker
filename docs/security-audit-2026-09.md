# 보안 감사 — 상용화(유료 다중 사용자) 가능성 판정 (2026-09)

> **성격**: 기능 감사가 아니라 **상용화 전제의 보안 감사**. 판정 기준은 "개인용 앱으로 안전한가"가
> 아니라 **"돈을 받고 타인의 민감정보(건강 데이터)를 맡아도 되는가"**다. 같은 코드라도 이 두 기준의
> 답은 다르다.
> **기준 커밋**: `ea27d00` (main) · **브랜치**: `claude/clever-ramanujan-sdfjl0` · **작성일**: 2026-09-21
> **선행 문서**: `docs/ARCHITECTURE.md`(구조) · `docs/COMMERCIALIZATION.md`(사업) · `docs/system-audit-2026-08.md`(구조 감사)

---

## 0. 판정

### 0-1. 한 줄 결론

**지금 상태로 유료 출시하면 안 된다. 다만 "기초가 부실해서"가 아니라 "경계가 한 칸씩 어긋나 있어서"다.**
치명적 설계 결함(타인 데이터 열람·인증 우회·비밀값 유출)은 발견되지 않았다. 막아야 할 것은
**① 인증 경계가 '회원'이 아니라 '구글 로그인한 아무나'에 그어져 있는 것, ② 비용·가용성 방어가
조용히 무력화되는 fail-open 구조, ③ 법적 요건이 사실상 0건인 것** 세 가지다. ①②는 코드 작업
1~2주, ③은 법무 검토가 붙는 별도 트랙이다.

### 0-2. 세 문장 요약

1. **데이터 격리는 합격이다.** Firestore 규칙이 `isSelf(uid) && isMember()`로 타인 데이터를 막고,
   서버리스 함수는 Firestore 자격증명을 아예 갖지 않는다(사고 반경 최소화). 비인증 REST 읽기를
   실제로 시도해 3경로 모두 403을 확인했다.
2. **그런데 서버 API의 문턱이 낮다.** 토큰을 검증하는 API(`push-sync`·`import-inbox`·`share-*`)는
   토큰이 **유효한지**만 보고 **회원인지**는 보지 않는다. AI 분석 API 3종은 토큰조차 요구하지 않는다.
   초대 게이트가 Firestore 규칙에만 있어서, 서버 자원(Anthropic 과금·KV 저장소·푸시 크론)은
   구글 계정만 있으면 누구나 소비할 수 있다.
3. **상품이 되려면 코드보다 문서가 더 부족하다.** 민감정보 별도 동의·개인정보처리방침·이용약관·
   계정 삭제 경로·국외이전 고지·의료 면책이 전부 없다. 건강정보는 개인정보보호법상 민감정보라
   이건 "나중에"가 아니라 **결제 버튼보다 먼저**다.

### 0-3. 피해 모델 — 유출이 아니라 정지다

감사 전체를 관통하는 결론이 하나 있다. **이 앱에서 현실적으로 일어날 사고는 "데이터가 샌다"가
아니라 "서비스가 멈춘다"다.** 데이터 격리는 규칙이 실제로 막고 있고, 서버는 DB 권한조차 없다.
반면 한 사람이 전체를 멈출 수 있는 경로가 여럿이다.

| 경로 | 필요한 것 | 결과 |
|---|---|---|
| AI 엔드포인트 남용 (P0-1·P0-2) | 없음 (익명 curl) | Anthropic 월 상한 도달 → **전 회원 AI 기능이 익월 1일까지 정지** |
| 푸시 tarpit (P0-4) | 구글 계정 1개 | 매일 밤 구독자 절반가량이 알림 누락, 영구 반복 |
| 크론 예외 (P1-12) | 구글 계정 1개 | 한 명의 깨진 JSON이 **전원**의 그날 발송을 취소 |
| KV 고갈 (P0-3) | 구글 계정 1개 | 공유·사서함·푸시 동시 500 + rate limit 해제 |

금액 피해는 모든 경로에서 작다(최대 월 $500~$1,000 수준). **비용 방어가 아니라 가용성 방어로
설계해야 한다.** 유료 서비스에서 "한 명이 전원을 멈출 수 있다"는 것은 환불·이탈로 직결된다.

그리고 이 네 경로 중 셋은 **합쳐서 반나절이면 막힌다**(P0-2·P0-4·P1-12 전부 S등급).
가장 비싼 것은 코드가 아니라 법무 트랙이다.

### 0-4. 지금 태세가 감당 가능한 범위

| 운영 형태 | 판정 | 근거 |
|---|---|---|
| 개인 1인 사용 | ✅ 충분 | 현재 방어가 1인 전제에 맞게 설계됨 |
| 지인 소수 무료 공유(경로 B) | ⚠️ 조건부 | P0-2·P0-4·P1-12(전부 S등급, 반나절)를 먼저 막으면 가능. 무료라도 처리방침은 권장 |
| 유료 다중 사용자(경로 C) | ❌ 불가 | P0 10건 전부 + 법무 트랙 완료 전에는 불가 |

---

## 1. 감사 방법과 범위

### 1-1. 수행 방식

10개 보안 관점(Firestore 규칙 · 서버 API 인증 · 비밀값/설정 · 공유 링크/반출 · 자동 유입 파이프라인 ·
클라이언트 PWA · 가용성/비용 · AI 연동 · 푸시/크론 · 개인정보 법규)으로 독립 감사한 뒤, 각 발견을
**다렌즈 반박 검증**(코드 사실관계 / 악용 가능성 / 영향·심각도)에 통과시켰다. 기각된 항목은 이
문서에 싣지 않았다. 원시 발견 130건 → 중복 병합·검증 후 본문 항목으로 정리했다.

### 1-2. 직접 실측한 것

| 항목 | 방법 | 결과 |
|---|---|---|
| 배포된 Firestore 규칙의 인증 요구 | Firestore REST로 비인증 read 3경로 시도 | 전부 `403 PERMISSION_DENIED` — 과거의 `if true` 상태가 **아님** |
| Firebase 웹 API 키 제한 | `identitytoolkit v1/projects` 를 Referer 없이 호출 | `200` — HTTP 리퍼러 제한 **없음** |
| 승인된 Auth 도메인 | 같은 응답 | localhost · `*.firebaseapp.com` · `*.web.app` · 프리뷰 1개 · `daniel-tracker.vercel.app` |
| 저장소 공개 여부 | GitHub API | **public** (`private:false`) · 포크 허용 · 브랜치 보호 **없음**(10개 브랜치 전부 `protected:false`) |
| 커밋 이력 비밀값 | 전체 이력 정규식 스캔 | `sk-ant-`·개인키·비밀번호 **없음**. Firebase 웹 apiKey(공개값)만 하드코딩 |
| 커밋된 픽스처의 실데이터 | `golden-sample.json`·`bench/results.jsonl` 검사 | 합성 데이터. 식별정보 없음 |
| 의존성 취약점 | `npm audit` + `npm ls` 로 런타임 노출 추적 | 31건(critical 1·high 12) — §6 |
| 비용 상한 | Haiku 4.5 단가로 직접 재계산 | §2 P0-1 |

### 1-3. 실측하지 못한 것 (한계)

- **배포 도메인 실동작**: 감사 환경의 네트워크 프록시가 `daniel-tracker.vercel.app` 접근을 차단해
  응답 헤더·엔드포인트 실동작을 확인하지 못했다. 코드 기준 판정이다.
- **인증된 사용자의 타 uid 접근**: 유효한 ID 토큰이 없어 "로그인한 사용자가 남의 uid를 읽을 수
  있는가"는 실측하지 못했다. 규칙 코드상으로는 막힌다(§7-1에 실측 절차 제시).
- **운영 환경 설정값**: Vercel/Firebase/Upstash/Anthropic 콘솔의 실제 설정(요금제·env 주입 여부·
  App Check 강제 상태·리전)은 코드로 알 수 없다. **여러 발견의 심각도가 이 값들에 좌우된다** — §7.

---

## 2. 출시 차단 항목 (P0) — 유료 출시 전 반드시 해결

| # | 항목 | 심각도 | 위치 | 작업량 |
|---|---|---|---|---|
| P0-1 | AI 분석 API 3종이 **인증 없이** 호출 가능 | high | `api/analyze-*.js` | M |
| P0-2 | AI 입력 **길이·타입 무검증** — 호출 1건이 정상의 200배 | high | `analyze-food.js:21,57` 외 | S |
| P0-3 | 서버 API가 **멤버십을 검증하지 않음** | high | `verify-auth.js` · `verify-uid.js` | M |
| P0-4 | 푸시 구독 endpoint 무검증 + 크론 **타임아웃 없음** | high | `push-sync.js:65` · `cron-reminders.js:114` | S |
| P0-5 | **법적 요건 전무** (동의·처리방침·약관·삭제·면책) | high | 코드 전역 부재 | L |
| P0-6 | **Vercel Hobby 약관** — 상업적 사용 금지 | medium | 운영 설정 | S |
| P0-7 | 자동 유입 3경로가 **단일 사용자 전용 구조** | medium | `health-import.js:38` 외 | L |
| P0-8 | 운영자 이메일 1개에 **전 사용자 데이터 read** + 접근 로그 없음 | medium | `firestore.rules:75` | M |
| P0-9 | **firebase 10.x가 보안 패치 채널 밖** | medium | `package.json:14` | M |
| P0-10 | 유일한 인가 계층인 **Firestore 규칙의 게시본을 검증할 수단이 없음** | high | `firestore.rules` · 배포 절차 | M |

---

### P0-1. AI 분석 API 3종이 인증 없이 호출 가능

**사실**: `api/analyze-food.js` · `analyze-exercise.js` · `analyze-body.js`는
`checkOrigin` → `rateLimit` → Anthropic 호출 순서로만 진행하며 **`verifyIdToken`이 없다**.
같은 저장소의 `api/share-create.js:23-24`는 같은 패턴으로 토큰을 검증하므로, 검증 코드가
없어서가 아니라 이 3개에만 빠져 있다.

`checkOrigin`(`api/_lib/security.js:21-27`)은 `req.headers.origin` 문자열의 목록 포함 여부만
본다. Origin 헤더는 브라우저 밖에서 임의로 설정할 수 있으므로 **CSRF 방어이지 인증이 아니다**:

```bash
curl -X POST https://<프로덕션도메인>/api/analyze-food \
  -H 'Origin: https://<프로덕션도메인>' -H 'Content-Type: application/json' \
  -d '{"query":"닭가슴살 100g"}'
```

이 한 줄이 운영자의 `ANTHROPIC_API_KEY`로 과금되는 호출을 실행한다. 로그인·초대·결제 어느 것도
요구되지 않는다.

**영향 — 금액보다 가용성이 문제다.** 원 발견들은 "무제한 비용 폭탄"으로 기술했으나 재검증에서
교정했다. Anthropic 공식 한도가 피해 상한을 정한다:

| 구속 조건 | 값(Start 티어 기준) | 결과 |
|---|---|---|
| Haiku 4.5 ITPM | 2,000,000 토큰/분 | 입력 소비 상한 **$2.00/분 = $120/시** |
| 월 지출 상한 | **$500** (Build $1,000 / Scale $200,000) | 약 **4.2시간**이면 도달 |
| 상한 도달 시 | 429 `enforced_spend_limit_reached` | **조직 전체 API가 익월 1일 00:00 UTC까지 정지** |

- ITPM은 **조직 단위**라 공격자가 IP를 늘려도 총 소비율이 올라가지 않는다 → "IP 수에 비례해
  곱해진다"는 서술은 기각.
- 금전 피해 상한은 현실적으로 **월 $500~$1,000**이다.
- **진짜 피해는 그 다음이다**: 상한에 걸리면 유료 회원 전원의 AI 기능이 최대 4주간 죽는다.
  비용 공격이 아니라 **가용성 공격**으로 읽어야 한다.

**수정**
1. 세 파일에 `verifyIdToken` 추가(`share-create.js:20-24` 패턴 복사, 각 3줄).
2. 클라이언트 4곳(`src/App.jsx:954,1039,1092`, `src/components/BodyTab.jsx:132`)에
   `idToken`을 본문에 실어 보내기(`src/push.js:28-35`의 `post()` 패턴과 동일).
3. **앱 전용 Anthropic 워크스페이스를 만들고 그 워크스페이스에 자체 지출·rate limit을 설정**한다.
   조직 전체가 아니라 이 앱만 멈추게 하는 격벽이다(콘솔 → Workspaces).
4. 조직 지출 한도를 티어 상한보다 **낮게** 직접 설정한다(도달 시 400 반환, 상향으로 즉시 복구 가능).

---

### P0-2. AI 입력 길이·타입 무검증

**사실**: `analyze-food.js:21`은 `if (!isPhoto && (!query || !query.trim()))`로 **빈 값만** 거르고
`:57`에서 `음식: "${query.trim()}"`에 길이 검사 없이 보간한다. `analyze-exercise.js:16-18 → :41`도 같다.
`analyze-body.js:14-15`는 `current` 존재만 확인하고 `:23-38`에서 `current.weight`·`previous.*`·
`dietSummary.*`·`exerciseSummary.*`·`goals.*`를 **타입·범위 검증 없이** 문자열 보간한다 —
`{"current":{"weight":"<700KB 문자열>"}}`이 그대로 프롬프트가 된다.

**영향**: 호출 1건의 입력 토큰이 컨텍스트 한계(200K − `max_tokens`)까지 확장된다.

| | 입력 토큰 | 호출당 비용 |
|---|---:|---:|
| 정상 텍스트 분석 | ~300 | $0.001 |
| 정상 사진 분석 | ~1,900 | $0.004 |
| **악용 상한** | ~199,700 | **$0.20** (정상의 약 200배) |

> 참고: Vercel 본문 한도 4.5MB를 꽉 채우는 것은 무의미하다. 4.5MB ASCII는 약 110만 토큰으로
> 200K 컨텍스트를 넘겨 Anthropic이 400으로 거부하고 과금도 되지 않는다. 공격자는 700~800KB로
> 맞춰야 하며, 이는 "본문 크기 제한"이 방어가 되지 못한다는 뜻이기도 하다.

**이 항목은 P0-1을 고쳐도 사라지지 않는다.** 인증을 붙여도 정상 로그인 회원 1명이 같은 일을 할 수 있다.

**수정** (각 1~2줄)
```js
const MAX_QUERY = 200;              // 음식·운동 이름에 200자면 충분
if (typeof query !== "string" || query.length > MAX_QUERY)
  return res.status(400).json({ error: "bad request" });

// analyze-body: 숫자 필드는 숫자로 강제
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
```
사진 경로는 `image` 문자열 길이 상한(예: 8MB base64)과 `mediaType` 화이트리스트
(`image/jpeg|png|webp|gif`)를 함께 건다.

---

### P0-3. 서버 API가 멤버십을 검증하지 않음

**사실**: `push-sync` · `import-inbox` · `share-create` · `share-revoke`는
`verifyIdToken`/`verifyUid`로 **토큰이 유효한지**만 확인한다(`api/_lib/verify-auth.js:7-22`,
`verify-uid.js:8-22`). 서버 코드 어디에도 `members/{uid}` 확인이 없다(전수 grep 0건).

초대 게이트는 **Firestore 보안 규칙에만** 존재한다. 그런데 Firebase Auth의 Google 로그인은
프로젝트에 로그인만 하면 누구나 유효한 ID 토큰을 얻는다. 즉 **초대받지 않은 임의의 구글 계정이
서버 자원을 소비할 수 있다**:

| 경로 | 비초대 계정이 할 수 있는 것 |
|---|---|
| `share-create` | 600KB 스냅샷을 IP당 분당 10건 저장(TTL 최대 7일) → 하루 **8.64GB**, 정상상태 잔류 약 60GB |
| `push-sync` | `push:uids`에 등록 → 매일 밤 크론이 그 계정을 처리(→ P0-4와 결합) |
| `import-inbox` | ack로 KV 명령 소모. 설정 플래그(컷오버 날짜·boolean 4개) 노출 — 비밀값은 없다 |

KV가 가득 차면 쓰기가 실패하고, 그 순간 `rateLimit`이 fail-open으로 넘어가며(§3 P1-1),
공유·사서함·푸시가 동시에 500이 된다.

> **이 항목의 성격을 정확히 해둔다.** 재검증에서 두 가지가 교정됐다.
>
> - **"유료 기능 무임승차"가 아니다.** 비회원은 `firestore.rules:73-74` 때문에 **자기 데이터조차**
>   읽거나 쓸 수 없다. 즉 비회원의 `share-create`는 "자기가 타이핑한 문자열을 저장하는 것"이고
>   `push-sync`는 "기록이 하나도 없는 상태로 리마인더를 받는 것"이다. 게이트 뒤에 훔칠 기능이 없다.
>   타인 건강 데이터에 닿는 경로도 코드상 존재하지 않는다(실측 403과 일치).
> - **"요금 폭탄"도 아니다.** Upstash 종량 기준으로 저장 60GB ≈ 월 $15, 명령 ≈ 월 $1.8,
>   대역폭 ≈ 월 $8 → **합계 월 $20~25** 수준이다.
>
> 그러므로 이건 **기밀성 결함이 아니라 자격 경계(entitlement) 결함**이고, 피해는 금액이 아니라
> **가용성**이다. 플랜 용량에 닿는 순간 KV 쓰기가 실패해 공유·사서함·푸시가 전부 죽고
> rate limit까지 풀린다. 그럼에도 블로커인 이유는, 돈을 받는 서비스가 **고객이 아닌 사람에게
> 백엔드를 열어두고 그것을 계량할 수단조차 없기** 때문이다(`share-store.js:20`의 키는
> `share:{token}` 하나뿐이라 uid별 집계 자체가 불가능하다).
>
> 한편 **인바디 클라우드 경로는 안전하다** — `api/import-inbox.js:94`가 `uid !== IMPORT_UID`로
> 하드 게이트하므로 비회원이 운영자 크리덴셜 경로를 트리거할 수 없다.

**수정**
1. **단기**: `verify-auth.js`가 uid를 돌려준 뒤 Firestore REST로 `members/{uid}` 존재를 확인하고
   없으면 403. 결과를 KV에 짧게(예: 5분) 캐시해 읽기 비용을 억제한다.
2. **정석**: Admin SDK로 가입 시 **custom claim**(`member: true`)을 부여하고 토큰에서 바로 읽는다.
   Firestore 읽기 0회, 규칙의 `exists()` 호출도 사라져 비용이 절반이 된다
   (`firestore.rules:37`이 요청마다 1회 추가 읽기를 발생시킨다).
3. uid 단위 쿼터를 추가한다 — 현재 rate limit 키가 IP 단독이라 계정 단위 남용을 세지 않는다.

---

### P0-4. 푸시 구독 endpoint 무검증 + 크론 타임아웃 없음

**사실 두 가지가 겹친다.**

1. `api/push-sync.js:65` — `if (subscription && subscription.endpoint)` 존재 여부만 보고 KV에 저장한다.
   스킴·호스트 검증이 없다.
2. `api/cron-reminders.js:114` — `await webpush.sendNotification(subscription, JSON.stringify(payload))`.
   **옵션을 넘기지 않아 `web-push`의 `options.timeout`이 걸리지 않는다**(라이브러리 소스 확인:
   `web-push-lib.js:222,356-397`은 `options.timeout`이 있을 때만 소켓 타임아웃을 건다).
   그리고 `:70`의 uid 루프는 순차다.

**공격**: 구글 로그인만 한 계정이 endpoint를 응답을 지연시키는 자기 서버로 등록한다.
그날 밤 크론이 그 uid에서 소켓이 열린 채 `maxDuration` 60초(`vercel.json`)를 소진하고 함수가 종료된다.
→ `SMEMBERS` 순서상 **그 뒤의 사용자들이 그날 푸시를 받지 못한다.** 200을 돌려주면 404/410
자동 정리도 발동하지 않아 영구히 반복된다. 로그에는 원인이 남지 않는다.

> **정직한 피해 규모** (재검증 교정): "계정 1개로 전원 영구 차단"은 성립하지 않는다.
> 피해 범위는 `SMEMBERS`(`:69`)가 돌려주는 순서상 공격자 **뒤에 놓인** uid로 한정되고,
> 그 순서는 Redis 집합의 내부 인코딩에 달려 있어 공격자가 제어할 수 없다.
> 기대값은 **공격자 k개가 N명 사이 임의 위치에 있을 때 평균 N/(k+1)명만 발송**이다.
> 계정 1개면 평균 약 절반, 10개면 약 90%가 막힌다. 계정 생성 비용이 0이므로 여전히 심각하다.

이건 공격 없이도 발생한다: 파일 상단 주석(`:11-14`)이 이미 "구독자가 늘면 잘려서 뒤쪽 uid가
조용히 누락된다"고 인지하고 있다. uid당 소요는 KV 왕복 2회 + 푸시 1~3건(각각 새 TLS 핸드셰이크,
keepAlive 미사용)이다. 낙관(동일 리전·푸시 1건) 약 180ms → 약 330명, 비관(크로스 리전·푸시 3건)
약 800ms → 약 75명. **현실 임계는 대략 100~350명**이다.

부수적으로 Vercel 함수가 임의 외부 URL로 VAPID 서명 헤더가 붙은 POST를 보낸다. 다만 이것을
SSRF로 부르지 말 것 — `web-push`는 스킴과 무관하게 **항상 `https.request`**를 쓰므로
`http://169.254.169.254/...`를 넣어도 그 주소의 443 포트로 TLS 핸드셰이크를 시도하다 실패한다.
평문 내부 메타데이터에 닿을 수 없다. endpoint 검증이 필요한 진짜 이유는 SSRF가 아니라
위의 정지(tarpit)다. **수정 우선순위를 SSRF 근거로 매기지 말 것.**

함께 고칠 것이 하나 더 있다. `push-sync`는 `subscription`뿐 아니라 `state`·`reminders`도
스키마·크기 검증 없이 저장한다. `reminders`는 `push-state.js:38-39`가 "객체이기만 하면"
통째로 보존하므로 필드 화이트리스트가 없고, 저장 상한은 Vercel 본문 4.5MB뿐이며 TTL도 없다.

**수정** (핵심은 3줄)
```js
// cron-reminders.js:114
await webpush.sendNotification(subscription, JSON.stringify(payload), { timeout: 10000, TTL: 86400 });

// push-sync.js:65 — 알려진 푸시 서비스만 허용
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /\.windows\.com$/, /\.apple\.com$/];
const u = new URL(subscription.endpoint);
if (u.protocol !== "https:" || !PUSH_HOSTS.some(re => re.test(u.hostname)))
  return res.status(400).json({ error: "bad subscription" });
// keys.p256dh / keys.auth 형식도 함께 검증
```
추가로 uid 루프를 `Promise.allSettled` 배치(동시 5~10)로 바꿔 1건 지연이 전체를 막지 않게 한다.

---

### P0-5. 법적 요건 전무

건강정보는 개인정보보호법상 **민감정보**(제23조)다. 다음이 코드·저장소 어디에도 없다.

| 요건 | 근거 조문 | 현재 |
|---|---|---|
| 민감정보 **별도 동의** | §23 | 없음 |
| 개인정보처리방침 | §30 | 없음 — **유·무료를 가리지 않는 의무라 지금도 이미 미이행이다** |
| 이용약관 | 전자상거래법 등 | 없음 |
| **계정 삭제·파기 경로** | §36(삭제요구권) · §21(파기) | 없음 |
| 처리위탁 고지 | §26 | 없음 — 수탁자 5곳(Google·Vercel·Upstash·**Anthropic**·InBody) |
| **국외이전 고지** | §28-8 | 없음 — 음식 사진과 체성분 수치가 미국(Anthropic)으로 전송됨 |
| 접근기록 보관 | 안전성 확보조치 기준 | 없음 — 운영자 read에 로그가 없다(P0-8) |
| 만 14세 미만 정책 | §22-2 | 없음 — §4 P2로 이동(초대제가 현 유입을 실질 차단) |
| 의료 조언 면책 | — | 없음 |

> **§30 처리방침은 "유료화 전 과제"가 아니다.** 개인정보처리자의 의무라 유·무료를 가리지 않는다.
> 지금의 초대제 무료 운영에도 이미 적용된다. 이 항목만은 출시 계획과 무관하게 지금 착수할 일이다.

#### 동의를 붙여야 할 지점은 온보딩이 아니다

내가 1차로 `ProfileSetup`을 지목한 것은 틀렸다. `src/components/ProfileSetup.jsx:29-39`가 받는
이름·키·나이·목표 체지방률은 §23 민감정보가 아니라 **일반 개인정보**다. 별도 동의가 필요한
실제 지점은 네 곳이다.

| 지점 | 무엇이 민감정보인가 |
|---|---|
| `HealthEvents`의 `note` | 부상·질병을 사용자가 자유 서술(`HealthEvents.jsx:104` textarea) |
| `ProgressPhotos` | 신체 사진 |
| `bodylog` | 체성분 측정값 |
| `analyze-*` 전송 | 제3자(Anthropic)로의 이전 |

#### 계정 삭제는 생각보다 싸다

1차 판정에서 "Admin SDK 서비스 계정이 필요하다"고 썼는데 과장이었다.
`firestore.rules:73-74`의 `allow read, write`에 **delete가 포함**되므로
`users/{uid}/data/**`(진행 사진 서브컬렉션 포함)는 **클라이언트에서 전량 삭제된다**.
`src/store.js:231`의 `deleteProgressPhoto`가 이미 그 경로를 쓰고 있다.
Firebase Auth 계정도 클라이언트 SDK `deleteUser`(재인증 필요)로 지운다.

서버 권한이 실제로 필요한 것은 두 가지뿐이다.

1. `members/{uid}` 문서 1개 — 내용은 `email`·`joinedAt`·`code`이고 건강정보가 아니다.
2. **KV 정리** — `share:*` · `push:sub`/`push:state` · `import:seen:*` · `import:inbox` ·
   `import:body-*`. 이미 인증된 엔드포인트 패턴(`share-revoke` 등)이 있으므로 같은 방식으로
   삭제 엔드포인트를 하나 만들면 된다.

> `import:seen:*`이 "키 열거가 필요해 누락이 구조적"이라고 쓴 것도 교정한다. 키 형식이
> `import:seen:{uid}:{dedupKey}`라 **uid 프리픽스 SCAN으로 특정할 수 있다.** 다만 TTL이 없어
> 보유기간을 정의해야 하는 것은 맞다(§3 P1-14).

**수정**: 설정에 "계정 삭제" 흐름을 만든다. 클라이언트가 Firestore·localStorage를 지우고,
서버 엔드포인트 하나가 `members/{uid}`와 KV 키들을 지운다. §3 P1-2의 로그아웃 purge와
같은 함수를 공유하면 된다.

#### 의료 면책 — 다만 인앱 AI는 질병 메모를 보지 못한다

1차 판정에서 "부상·질병 메모까지 코치 프롬프트에 실린다"고 썼는데 **사실이 아니다.**
직접 확인했다. `src/components/BodyTab.jsx:134-140`은 `current`·`previous`·`dietSummary`·
`exerciseSummary`·`goals`만 보내고, `api/analyze-body.js:14`가 정확히 그 다섯 개만 받는다.
**`healthEvents`는 포함되지 않는다.** 앱의 AI는 질병·복약 메모를 애초에 보지 못한다.

메모가 실리는 경로는 사용자가 **스스로** 복사해 붙여넣거나 공유 링크로 넘기는 분석 패키지
(`src/analysisExport.js:190`)뿐이다.

그럼에도 면책이 필요한 이유는 법 위반이라서가 아니다. **유료로 건강 조언을 제공하면서
UI 면책도 약관상 책임제한 조항도 없으면 분쟁 시 방어 논거가 0이라는 비대칭** 때문이다.
수정 비용은 문구 2곳 + 프롬프트 2줄이다.

#### 국외이전 — 별도 동의 모달은 필수가 아니다

§28-8①3은 **위탁·보관 목적**의 국외이전에 대해 처리방침 공개 또는 정보주체 고지로 동의를
갈음하는 경로를 둔다. 즉 **처리방침의 수탁자·국외이전 표가 제1 해법**이고 별도 동의 모달은 선택지다.

위험 가중치도 옮겨야 한다. `analyze-body`가 보내는 것은 uid·이름·이메일이 없는 **순수 수치**다.
식별 가능성이 실제로 높은 쪽은 `analyze-food`의 **음식 사진**이다(동석자 얼굴·실내·영수증).

> **EXIF 제거는 이미 되어 있다.** `src/App.jsx:1011-1030`의 `compressImage`가 canvas로
> 800px 리사이즈 후 `toDataURL("image/jpeg", 0.8)`로 재인코딩하므로 GPS·촬영기기 등
> 메타데이터가 전부 소실된 뒤 전송된다. 남는 위험은 메타데이터가 아니라 **화면에 찍힌 내용**이며,
> 800px는 얼굴 식별에 충분하다. 최소화 조치는 사진 경로에 집중할 것.

#### 공유 링크 고지는 이미 있다

1차에서 이 부분을 공백으로 분류했으나 과했다. `ClaudeExport.jsx:226-231`(발급 직전)과
`:258-261`(발급 직후) 두 곳에 경고가 있고, 부상·질병 메모가 그대로 실린다는 점과 로그인 없이
열람된다는 점을 명시하며, 보존기간도 사용자가 1시간·24시간·7일 중 고른다.
**남는 공백은 두 가지로 좁혀진다**: 저장 사업자(Upstash)를 이름으로 밝히지 않는 것,
그리고 동의 기록이 남지 않는 것. 둘 다 처리방침·동의 체계에서 해소된다.

**전체 수정 방향**: 온보딩에 동의 단계(필수/선택 분리), 처리방침·약관 페이지, 계정 삭제 흐름,
AI 코칭 화면 면책 문구. **법무 검토 리드타임이 가장 길므로 코드 작업보다 먼저 시작해야 한다.**

---

### P0-6. Vercel Hobby 약관

`docs/COMMERCIALIZATION.md:40`이 현재 배포를 Hobby로 기록하고 있다. Vercel Hobby는
**비상업적 개인 용도로만** 허용되며, 상업적 사용은 Pro/Enterprise가 필수다(공식 약관·Fair Use).
"상업적 사용"의 정의가 넓어 결제를 받는 순간 위반이다.

> **등급을 high에서 medium으로 내렸다.** 코드 결함이 아니라 **결제 설정 1회로 해소되는 운영 항목**이고
> (Pro 약 $20/월), 현재 유료 고객이 0명이라 확정된 손해도 없다. 그리고 **Hobby라는 증거 자체가 약하다** —
> 문서의 비용 FAQ일 뿐이고, `vercel.json`의 `maxDuration 60`과 하루 1회 크론은 Pro에서도 유효한
> 설정이라 Hobby의 증거가 못 된다. 실제 요금제는 §7-1에서 확인해야 한다.
>
> 또 "한도 초과 시 프로젝트가 정지되어 전면 장애"는 이 항목의 근거가 아니다. 그건 §2 P0-1·P0-2
> (인증·입력 상한 부재)의 결과이며, **여기서 이중 계상하면 안 된다.** Pro로 올려도 그 문제는 남는다.

**수정**: 유료화 전 Pro 전환.

---

### P0-7. 자동 유입 3경로가 단일 사용자 전용 구조

**사실**: `IMPORT_TOKEN`(공용 비밀값 1개) + `IMPORT_UID`(귀속 대상 1명) + `INBODY_LOGIN_ID/PW`
(운영자 개인 인바디 계정) 전부 **서버 환경변수 1벌**이다.

- 수신 경로에 **사용자 식별자가 아예 없다.** `health-import.js:107`은 요청 본문과 무관하게
  `import:inbox:${UID}`(env의 단일 uid) 사서함에 적재한다. 즉 이 기능을 두 번째 사용자에게
  제공하는 순간 그 사람의 운동·체성분이 운영자 사서함으로 들어간다.
- 토큰이 새면(단축어 iCloud 공유·폰 분실) 회전 수단이 없다. env 교체 + 전 사용자 단축어 재설정뿐이다.
- 인바디 경로를 상품화하려면 **모든 가입자의 인바디 계정 비밀번호를 서비스가 보관**해야 한다.
  이건 다중 사용자로 확장할 수 없는 설계이고, 제3자 계정 자격증명 수탁은 법적으로도 별개의 문제다.
- 인바디는 비공식 API이며 앱을 위장한다(`api/_lib/inbody-cloud.js:26-31` 하드코딩된 AppVersion·
  기기명·UA). 인바디가 지문을 바꾸면 이 기능이 멈추고, 연속 실패가 쌓이면 계정이 잠길 수 있다.

> **재검증이 걷어낸 과장 세 가지.** 등급을 high에서 medium으로 내렸다(차단 항목은 유지).
>
> - **"가입만 하면 자동으로 일어난다"가 아니다.** 단축어 설정에는 `IMPORT_TOKEN`이 필요한데
>   이건 서버 env이고 클라이언트 번들에 주입되는 경로가 없다(`VITE_` 접두사만 주입된다).
>   **운영자가 공유 비밀을 손으로 배포해야** 성립한다. 저절로 터지는 사고가 아니라,
>   이 기능을 다중 사용자에게 제공하려는 순간 드러나는 **구조적 불가능성**이다.
> - **유출된 토큰은 쓰기 전용이다.** 타인의 건강 데이터를 **읽을 수 없다.** 사서함을 되가져오는
>   경로(`import-inbox.js:207`)는 Firebase ID 토큰으로 호출자 uid를 결박한다. 토큰 보유자가
>   할 수 있는 것은 **주입**뿐이고, 그것도 검문 규칙(유형 화이트리스트·kcal 범위 등) 안의 값만이다.
> - **"비밀번호 평문 전송"은 오해를 부른다.** `inbody-cloud.js:110-124`는 TLS 위로 보낸다.
>   문제는 전송이 아니라 **가역 보관**이다. API 로그인에 원문이 필요해 일방향 해시가 불가능하고,
>   그래서 Vercel env에 원문이 남는다. 이것이 다중 사용자화를 막는 진짜 이유다.

**수정 — 두 갈래 중 선택**
- **(권장) 출시 시 이 경로를 끈다.** `IMPORT_*`·`INBODY_*` env를 비우면 코드가 이미 503으로
  fail-closed한다(`health-import.js:44-49`). 1인 운영자용 기능으로 남기고 상품 기능에서 제외.
- **제공하려면**: 사용자별 수신 토큰 발급(uid 바인딩·KV 저장·회전·폐기 가능),
  `X-Import-Token` → 토큰 조회 → uid 결정 구조로 재설계. 인바디는 **공식 파트너 API가 없으면 포기**하고
  기기측(HAE) 경로로 대체한다. 서버가 제3자 비밀번호를 갖지 않는 원칙을 지킬 것.

부수 수정(각 1줄): `health-import.js:52`·`body-import.js:47`의 토큰 비교를 `!==`에서
저장소에 이미 있는 `safeEqual`로 교체. 다만 이건 **위생이지 취약점이 아니다** — 토큰이
192~256비트이고 rate limit이 토큰 대조보다 **먼저** 오며(`:49-50`, 의도적 배치), TLS·엣지·
서버리스 지터 때문에 나노초 차이를 측정할 수 없다.

> ⚠️ **채택하면 안 되는 수정안**: "rate limit 키에 토큰 해시를 섞자"는 **역효과**다.
> 현재 키는 `rl:${key}:${ip}`인데 여기에 토큰 해시를 섞으면 공격자가 토큰 후보를 바꿀 때마다
> 새 버킷이 생겨 **IP당 상한이 무력화된다.** 지금 막고 있는 추측 시도 제한이 사라진다.

---

### P0-8. 운영자 하드코딩 + 접근 로그 없음

**사실**: `firestore.rules:75` `allow read: if isOwner()` — 운영자 이메일 1개
(`munansa@gmail.com`, 규칙과 `src/auth.js:16`에 하드코딩)가 **전 사용자의 개인 데이터를 읽을 수 있다**.
여기엔 `users/{uid}/data/photos/items/*`의 **진행(신체) 사진**도 포함된다.
클라이언트 SDK로 읽으므로 Cloud Audit Log를 켜지 않는 한 **흔적이 남지 않는다**.

규칙 주석 스스로 "마이그레이션용이며 완료 후 제거해도 된다"고 적고 있다(`:71-72`).

**영향 — 다만 "전량 유출의 단일 지점"이라는 표현은 정확하지 않다.** 재검증이 교정한 부분이다.
`munansa@gmail.com`은 Firebase 콘솔을 직접 편집하는 계정과 **같다**(`README.md:128`의 배포 절차).
그 구글 계정이 완전히 탈취되면 이 규칙 한 줄이 없어도 콘솔로 전량 열람이 된다. 규칙 주석
`:71-72`의 "콘솔 접근 권한과 동일 수준"이라는 자평은 이 점에서 옳다.

**이 한 줄이 실제로 더하는 위험은 두 가지다.**

1. **더 약한 사건으로도 같은 열람이 된다.** 구글 계정 전체 탈취가 아니라 앱 기기 분실,
   IndexedDB에 지속되는 Firebase Auth 세션 탈취, 리프레시 토큰 유출만으로 충분하다.
   콘솔 재인증이 필요 없다.
2. **흔적이 남는 경로와 안 남는 경로가 갈린다.** 콘솔 접근은 GCP Admin Activity 로그에 남지만,
   클라이언트 SDK로 읽으면 Data Access 감사 로그를 켜지 않는 한 **아무 기록도 남지 않는다**.

접근기록 부재는 기술 문제이면서 동시에 안전성 확보조치 위반이다. 유출 사실을 사후에
입증할 수단이 없다.

**수정**
1. 마이그레이션이 끝났으면 `firestore.rules:75` **한 줄 삭제**(가장 큰 효과, 작업량 최소).
2. 운영 목적으로 유지해야 하면: Cloud Audit Logs(Data Access) 활성화 + 보존기간 설정,
   운영자 계정에 2단계 인증(보안 키) 강제, 운영자 전용 계정을 개인 Gmail과 분리.
3. `VITE_OWNER_EMAIL`로 교체 가능하게 돼 있으나 규칙은 env를 못 읽어 하드코딩이 남는다 —
   장기적으로 custom claim(`admin: true`)으로 옮기면 두 곳 동기화 문제도 사라진다
   (`src/__tests__/owner-email.test.js`가 지금은 이 동기화를 테스트로 지키고 있다).

---

### P0-9. firebase 10.x가 보안 패치 채널 밖

§6-2 참조. 취약점 때문이 아니라 **2024-10 이후 패치가 닿지 않는 메이저**를 유료 건강 서비스의
인증·DB 클라이언트로 쓰고 있기 때문이다. 업그레이드 표면이 작아 위험은 낮다.

---

### P0-10. Firestore 규칙의 게시본을 검증할 수단이 없음

**전제**: 서버는 Firestore 자격증명을 갖지 않는다(`grep` 결과 `api/*`에 firebase import 0건).
따라서 **모든 인가 판단이 `firestore.rules` 한 파일에서만 일어난다.** 이것이 유일한 인가 계층이다.

**그런데 그 계층에 검증 장치가 하나도 없다.**

| 있어야 할 것 | 현재 |
|---|---|
| IaC 배포 | 없음 — `firebase.json`·`.firebaserc` 부재. `README.md:128`은 "콘솔 규칙 탭에 **붙여넣고 Publish**" |
| CI 배포·드리프트 검사 | 없음 — `.github/workflows/ci.yml`은 checkout·npm ci·eslint·vitest 4단계뿐 |
| 규칙 단위 테스트 | 없음 — `@firebase/rules-unit-testing`·에뮬레이터 의존성 0건 |
| 변경 이력 | `firestore.rules`는 커밋 1개(`013011a`)뿐 |

그리고 **드리프트가 실제로 발생한 이력이 문서에 남아 있다**(`docs/DEPLOY-PATH-B.md:46-49`):
2026-07 콘솔 실측 당시 게시본은 저장소본과 달리 `users/{userId}/data/{document=**}`에
`allow read, write: if true`였다.

**다만 그 상태는 지금 아니다 — 내가 실측으로 확인했다.** 비인증 Firestore REST로
`users/daniel/data/goals`를 읽었을 때 `if true`였다면 200이 와야 하는데 403이 왔다.
**`if true` 잔존 가설은 죽었다.** 남는 현실적 드리프트 후보는 `request.app != null`(App Check)
조건 제거인데, 이는 타 uid 노출이 아니라 "외부 SDK·curl·스크립트 차단이 없다"는 의미다.

**그럼에도 이것이 차단 항목인 이유**는 특정 드리프트가 남아 있어서가 아니라,
**유일한 인가 계층이 사람 손으로 배포되고 누구도 그것을 검증할 수 없다**는 구조 자체다.
저장소가 공개되어 있어 `projectId`와 웹 API 키는 누구나 알 수 있으므로, 규칙 한 줄만 잘못
붙여넣으면 그날부터 전 회원 데이터가 열린 채 아무도 모르게 운영된다. 유료 건강 서비스에서
"인가가 맞는지 증명할 수 없다"는 상태는 그 자체로 출시 불가 조건이다.

**수정**
1. `firebase.json`·`.firebaserc`를 추가하고 규칙 배포를 `firebase deploy --only firestore:rules`로
   CI화한다. 이 순간부터 저장소본이 곧 게시본이 된다.
2. `@firebase/rules-unit-testing` + 에뮬레이터로 규칙 테스트를 CI에 넣는다.
   §7-1의 실측 시나리오를 그대로 테스트로 옮기면 된다.
3. 그 전까지는 §7-1의 3번(게시본 원문 diff)을 **배포할 때마다** 수동으로 수행한다.

---

## 3. 출시 전 강력 권고 (P1)

| # | 항목 | 심각도 | 위치 |
|---|---|---|---|
| P1-1 | `rateLimit` **fail-open** — KV 미설정·장애 시 조용히 통과 | medium | `security.js:59-64, 89-92` |
| P1-2 | **로그아웃해도 localStorage에 건강데이터 전체가 남음** | medium | `store.js:73-76` |
| P1-3 | 보안 응답 헤더 전무 (CSP·X-Frame-Options·Referrer-Policy) | medium | `vercel.json` |
| P1-4 | 공유 스냅샷이 KV에 **평문 + uid 동거**, 역색인 없어 고아 링크 폐기 불가 | medium | `share-store.js` |
| P1-5 | 공유 `pkg` 내용 무검증 — 서비스 도메인에 임의 텍스트 호스팅 | medium | `share-create.js:26` |
| P1-6 | Firestore 규칙에 **필드 검증 없음** + 재귀 와일드카드 | medium | `firestore.rules:73` |
| ~~P1-7~~ | 규칙 단위 테스트 부재 + 콘솔 수동 배포 → **§2 P0-10으로 승격** | — | — |
| P1-8 | 사서함 `pull` 항목을 클라이언트가 **범위 검증 없이** 병합 | medium | `src/importMerge.js:60` |
| P1-9 | ID 토큰 검증이 **요청마다 외부 HTTP** (Google identitytoolkit) | medium | `verify-auth.js:10` |
| P1-10 | 저장소 **public + 브랜치 보호 없음** + CI에 보안 스캔 없음 | medium | GitHub 설정 |
| P1-11 | KV 단일 인스턴스·단일 전권 토큰에 모든 것이 혼재 | medium | `kv.js` |
| P1-12 | 크론 루프에 **uid 단위 예외 격리가 없음** — 한 명의 오류가 전원 발송을 취소 | medium | `cron-reminders.js:68-132` |
| P1-13 | 초대·멤버십 모델에 만료·사용횟수·결제 연동이 없음 | medium | `firestore.rules:51-60` |
| P1-14 | **체성분 수신에 개수 상한이 없음** + `seen` 키 TTL 없음 + 미래 날짜 상한 없음 | medium | `body-import-rules.js:110,117,159` |

### P1-1. rateLimit fail-open

`api/_lib/security.js:59-64`는 KV env가 없으면 `console.warn` 한 줄 뒤 `return true`,
`:89-92`는 KV 오류 시 `catch` 후 `return true`다. 이것이 P0-1(무인증 AI 엔드포인트)의 **유일한**
방어선이다. `.env.example:93-94`의 KV 변수는 빈 값으로 문서화돼 있고 프로덕션 필수를 강제하는
장치가 없다. 테스트도 이 경로를 보호하지 않는다.

> **재검증에서 교정된 것**: "연쇄 공격으로 KV를 고장내 무제한 비용"이라는 서사는 대부분 기각됐다.
> `share-create`는 익명으로는 KV에 1바이트도 쓸 수 없고(`:20-24` 401), 600KB 상한도 있다.
> 그리고 **fail-open은 비용 상한을 바꾸지 않는다** — 단일 IP의 합법 한도(분당 80콜)만으로도
> 이미 조직 ITPM을 채우기 때문이다.
>
> **검증자 간 판정이 갈린 유일한 항목이다.** 한 렌즈는 high·블로커로 봤다("과금 경로의 유일한
> 방어선이 설정 사고 하나로 사라진다"). medium으로 둔 이유는 Anthropic 조직 한도라는 **외부
> 천장이 우연히 존재**하기 때문인데, 이는 우리가 통제하는 방어가 아니다. 그리고 P0-1·P0-2를
> 고치고 나면 이 항목이 **사용자 단위 남용의 유일한 제어**가 된다. 자동 유입 경로에서는
> 토큰 추측 시도 횟수 제한이 통째로 사라지기도 한다. 따라서 **P0 2단계와 같은 묶음으로 고칠 것**을
> 권고한다 — 심각도는 medium이지만 작업 순서는 P0와 함께다.

**수정**: 비용·인증 전 단계 엔드포인트에 `failClosed: true` 옵션을 추가해 503을 반환하게 하고,
KV 미설정을 배포 시점에 검사하는 부팅 체크를 둔다. `INCR`+`EXPIRE`를 `@upstash/ratelimit`
(원자적 슬라이딩 윈도우)로 교체하면 "EXPIRE 실패 시 그 IP 영구 429" 문제도 함께 사라진다.

### P1-2. 로그아웃 후 localStorage 잔존

`src/store.js:73-76` `logout()`은 `dt_currentUser` 하나만 지운다. `src/App.jsx:127-132`
`handleLogout`은 푸시 해제 후 `signOutUser()`만 호출한다. 그런데 모든 개인 데이터가
`dt_{uid}_{key}`로 평문 미러돼 있다(`store.js:288,313,417`). 멤버십 캐시·동기화 대기열·
삭제 흔적도 남는다. 앱 전체에 `dt_{uid}_*` 일괄 제거 코드가 없다.

공용 PC·가족 태블릿에서 A가 로그아웃한 뒤 누구든 DevTools로 A의 식단·체중·체지방·프로필
(이름·키·나이)을 읽을 수 있다. 로그인 불필요.

**수정**: **명시적** 로그아웃 시 `dt_{uid}_*`·`dt_{uid}_member`·`dt_pendingSync_{uid}`·
`dt_tombstones_{uid}`·`dt_migrated_{uid}`를 purge한다. 단 대기열이 비어 있을 때만 — 아니면
"미동기화 N건이 있어요"를 먼저 보여준다. 세션 만료(자동)에서는 유지해 offline-first를 보존한다.
계정 삭제 흐름(P0-5)과 같은 함수를 공유하면 된다.

### P1-3. 보안 응답 헤더

`vercel.json`에 `headers` 설정이 없다. HSTS는 Vercel이 기본 부여하지만(`*.vercel.app`에
`max-age=63072000; includeSubDomains; preload`), **CSP·X-Frame-Options·Referrer-Policy·
X-Content-Type-Options·Permissions-Policy는 없다**. 현재 XSS 방어가 React 이스케이프 단일 계층이고
외부 CDN(jsDelivr) 스타일시트를 SRI 없이 로드하므로(`index.html:14`, `public/offline.html`)
방어 심층이 얕다.

**수정**: `vercel.json`에 `headers` 추가. 공유 뷰(`/export/*`)는 특히 조일 수 있다
(`default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`).
폰트는 `npm i pretendard`로 셀프호스팅하면 CDN 의존과 SRI 문제가 동시에 사라진다.

### P1-4~P1-5. 공유 링크

- **평문 저장**: KV에 건강 데이터 본문과 Firebase uid가 평문으로 함께 있고, 단일 전권 REST
  토큰으로 접근된다. → uid는 HMAC으로 저장하고(소유자 검증만 가능하게), `pkg`는 서버 키로
  AES-GCM 암호화해 저장한다.
- **고아 링크**: `uid → 토큰` 역색인이 없어, 다기기·백업 복원 상황에서 앱 화면에 보이지 않는
  토큰이 최대 7일 생존한다(2026-08 감사 R-23의 잔여). → `SADD share:byuid:{uid}` 역색인 추가 +
  `share-revoke-all` 엔드포인트(로그아웃·계정 삭제에서 호출).
- **pkg 무검증**: 구조 검증이 없어 임의 텍스트가 서비스 도메인에서 7일간 호스팅된다.
  → 첫 줄·푸터·섹션 헤더 형식 검증 + `Content-Type: text/plain`으로 전환(AI 리더는 텍스트도 읽는다).

  > **"피싱·브랜드 악용" 주장은 기각됐다.** `export-view.js:83`이 `<pre>${esc(pkg)}</pre>`로만
  > 렌더하고 `:16`의 `esc()`가 `&<>`를 이스케이프하므로 앵커 태그·자격증명 수집 폼·XSS가 전부
  > 불가능하고, 자동 링크화가 없어 URL은 피해자가 손으로 복사해야 하는 비활성 텍스트다.
  > `X-Robots-Tag: noindex, nofollow` + meta robots + `no-store`로 검색 노출 경로도 막혀 있다.
  > 토큰이 122비트라 열거가 불가능해 공격자가 링크를 **직접 전달**해야 하는데, 그게 가능하면
  > 이 도메인을 경유할 이유가 없다. 남는 실질 문제는 **KV 용량 소모**뿐이고, 그건 P0-3의
  > uid 쿼터 수정이 들어가면 자동으로 사라진다. pkg 검증은 위생 차원의 권고로 읽을 것.

### P1-6~P1-7. Firestore 규칙

`firestore.rules:73-74`의 `{document=**}` 재귀 와일드카드는 키 이름·필드·타입·크기·깊이를
전혀 검사하지 않는다. 앱의 실제 계약은 `{ value, updatedAt }`인데(`src/store.js:316`) 규칙이
이를 강제하지 않으므로, 탈취된 토큰이나 버그난 클라이언트가 본인 경로에 임의 모양의 문서를
무제한 만들 수 있다. 이미 작성된 제안본(`firestore.rules.proposed`)이 있으나 미배포다.

> 비용 피해는 제한적이다(1MiB × 1만 건 ≈ 10GB ≈ 월 $1.8). 실질 보호는 필드 화이트리스트보다
> **크기 상한 + Firebase 예산 알림**이 핵심이다.

더 중요한 건 **규칙이 유일한 인가 계층인데 자동 검증이 없다**는 점이다. `@firebase/rules-unit-testing`
도 에뮬레이터도 없고, 배포는 콘솔 수동 붙여넣기다. 2026-07에 저장소본과 게시본이 어긋나
`if true`가 게시돼 있던 이력이 문서로 남아 있다(`docs/DEPLOY-PATH-B.md:46`).

**수정**: 제안본(`firestore.rules.proposed`) 배포 + 크기 상한 + Firebase 예산 알림.
배포 시 `src/store.js:462`의 레거시 원형 복사가 거부될 수 있으니 마이그레이션 완료를 먼저 확인할 것.
**배포·테스트 체계 자체는 §2 P0-10으로 승격했다.**

### P1-8~P1-11. 나머지

- **사서함 병합 무검증**: 서버 검문소는 범위를 검사하지만 클라이언트 병합
  (`src/importMerge.js:60`)은 재검증하지 않는다. KV 내용이 곧 신뢰 경계가 된다.
  → 서버와 같은 상수를 클라이언트에서 import해 재검증.
- **토큰 검증 외부 호출**: 요청마다 Google `accounts:lookup`을 호출한다. 캐시가 없고 쿼터에
  의존하며, 웹 API 키에 리퍼러 제한을 걸면 **서버 인증이 통째로 깨진다**(현재 제한 없음을 실측).
  → `jose`로 JWKS 기반 로컬 JWT 검증(`iss`/`aud`/`exp`/`sub` + `sign_in_provider` 확인)으로 전환하면
  외부 호출 0회가 되고 키 제한도 걸 수 있다.
- **저장소 public**: 코드·엔드포인트·KV 키 구조가 전부 공개다(비밀값 유출은 없음을 확인).
  10개 브랜치 전부 보호 없음. → main 브랜치 보호(리뷰 필수·CI 통과 필수), Secret scanning +
  Push protection, Dependabot 활성화. 상용화 시점에 비공개 전환 검토.
- **KV blast radius**: 하나의 Upstash 인스턴스·하나의 전권 토큰에 rate limit·공유 스냅샷(건강 데이터)·
  수신 사서함·푸시 구독이 전부 들어 있다. 토큰 1개 유출 = 전 사용자 건강 데이터 + 방어 체계 동시 붕괴.
  → 최소한 공유 스냅샷 암호화(P1-4)로 평문 노출을 줄이고, eviction 정책을 `noeviction`으로 확인한다.

---

### P1-12. 크론 루프 예외 격리 없음

`api/cron-reminders.js:68`의 `try` 하나가 `:70`의 uid 루프 **전체**를 감싸고, `:129-132`의 `catch`는
`return res.status(500)`으로 루프를 통째로 끝낸다. 루프 안에서 개별 `try`가 붙은 곳은
`:113-125`의 `sendNotification` 하나뿐이다. 나머지는 무방비다:
`:72-75` KV GET 2회, `:76` `SREM`, `:78-79` **`JSON.parse(subRaw)`·`JSON.parse(stRaw)`**, `:118-119` DEL/SREM.

즉 **한 uid의 KV 일시 오류나 깨진 JSON 하나가 나머지 구독자 전원의 그날 발송을 취소한다.**
P0-3 때문에 비회원도 `push:state`에 임의 객체를 쓸 수 있으므로(§P0-4 말미) 이 트리거를
만드는 것은 어렵지 않다.

**수정**: 루프 본문을 `try/catch`로 감싸 실패한 uid를 건너뛰고 계속 진행한다(5줄).
P0-4의 `Promise.allSettled` 배치화와 같은 작업으로 처리하면 된다.

### P1-13. 초대·멤버십 모델이 유료 서비스에 맞지 않음

`firestore.rules:51-60`의 `members` create 조건은 본인 uid + 키 화이트리스트 + 이메일 일치 +
`get(/invites/$(code)).data.active == true`가 전부다. **코드 형식·엔트로피·만료(`expiresAt`)·
최대 사용 횟수(`maxUses`)·대상 이메일 바인딩이 하나도 없다.**

> **재검증에서 기각된 주장 두 가지.**
> - **브루트포스는 비현실적이다.** `invites/{code}`는 read/write가 전면 차단이라 직접 오라클이
>   없고, 유일한 오라클인 `members` create는 시도마다 Firebase Auth 토큰 + App Check 토큰이
>   필요하다. 문서 권장 형식(`BP-7K2M-XQ9F`, 영숫자 8자 ≈ 2.8×10¹²)이면 초당 100회로도
>   기대 소요가 수백 년이다.
> - **"시도당 `get()` 과금 = 비용 공격"도 기각한다.** Firestore 읽기는 10만 건당 약 $0.06이라
>   1억 회 시도해도 약 $60이다. 비용 공격으로 제시할 수치가 아니다.
> - **"멤버십 폐기 경로 없음"은 사실 오류였다.** `:59`의 `delete: if false`는 **클라이언트만**
>   막는다. 운영자는 콘솔·Admin SDK로 `members/{uid}`를 지울 수 있다.

**그래서 진짜 문제는 이것이다.**

1. **유출된 코드 하나가 무기한·무제한 무료 가입권이 된다.** 만료도 사용 횟수 제한도 없다.
   `active: false`는 그때부터 신규 가입만 막고 이미 가입한 사람에겐 영향이 없다.
2. **결제 상태와 접근 권한을 묶을 수단이 없다.** 구독 만료·정지·환불을 데이터 모델이
   표현하지 못한다. 유료화의 전제 조건이다.
3. **셀프서비스 탈퇴가 없다**(§2 P0-5의 삭제요구권과 직결).
4. `joinedAt`은 클라이언트가 보낸 값이 타입·시각 검증 없이 그대로 들어간다.

**수정**: 멤버십을 **custom claim**으로 옮긴다(`member: true`, `plan`, `expiresAt`).
결제 웹훅이 클레임을 갱신하면 규칙은 `request.auth.token.member == true`만 보면 되고,
`exists()` 과금 읽기도 사라진다(§2 P0-3의 정석 수정과 같은 작업). 초대 코드에는
`expiresAt`·`maxUses`·`boundEmail`을 넣고 규칙에서 강제한다.

### P1-14. 체성분 수신 경로에만 개수 상한이 없음

**운동 경로에는 상한이 있는데 체성분 경로에는 없다.** `import-rules.js:14`가 `MAX_WORKOUTS = 100`을
정의하고 `:96`이 초과 시 400으로 거부한다. 반면 `body-import-rules.js:110`의
`for (const m of body.data.metrics)`와 `:117`의 `for (const s of m.data)`에는 **개수 상한이 없다.**
`:168`이 서로 다른 날짜 1개당 사서함 entry 1건을 만들므로 entries도 무제한이다.

세 가지가 겹친다.

- **개수 상한 없음** — 본문 크기 상한(`MAX_BODY_BYTES` 4MB)은 있지만 그 안에 날짜를 잘게 쪼개
  넣으면 entry 수가 폭증한다.
- **미래 날짜 상한 없음** — `:159`의 컷오버는 `date < cutoverDate` **하한만** 본다.
  아침 창 가드도 `:42`의 `MORNING_END_HOUR = 24` 때문에 사실상 무력하다.
- **`seen` 키에 TTL 없음** — insert-only의 근거라 의도된 설계지만, 쓰레기 키도 영구히 남는다.

**피해**: `storeBodyEntries`는 entry당 KV 왕복 3회를 **직렬**로 돈다. 피해는 비용보다
**피해 계정의 사서함 교착**이다 — 사서함에 쓰레기가 쌓이면 앱의 pull·ack가 계속 실패한다.

> **"분당 27만 커맨드 = 비용 폭탄"은 교정됐다.** 그 커맨드가 순차 HTTPS 왕복이라는 점이
> 빠져 있었다. `health-import`·`body-import`는 `vercel.json`에 `maxDuration` 지정이 없어
> 플랫폼 기본값을 쓰므로, 루프는 약 1,000~1,500 커맨드 근처에서 504로 잘린다.
> 실효 상한은 페이로드 크기가 아니라 **함수 실행 시간**이다. 다만 **잘린 시점까지 쓰인
> seen 키와 사서함 field는 그대로 남고**, 클라이언트는 재시도 루프에 들어간다.

**전제**: 이 경로는 `IMPORT_TOKEN`이 있어야 호출된다. 현재 배포에서 실행 가능한 주체는
운영자 본인이나 토큰 절취자뿐이고 임의의 가입자가 아니다. 그래서 medium이다.

**수정** (각 1~2줄)
```js
const MAX_METRICS = 16, MAX_SAMPLES = 500, MAX_ENTRIES = 100;
if (body.data.metrics.length > MAX_METRICS) return 400;
if (m.data.length > MAX_SAMPLES) return 400;
if (entries.length > MAX_ENTRIES) return 400;
if (date > todayPlus1) continue;            // 미래 날짜 상한
```
`seen` 키에는 보유기간(예: 2년) TTL을 준다 — §2 P0-5의 파기 의무 대응에도 필요하다.

## 4. 위생 항목 (P2)

출시를 막지는 않지만 상용 서비스 기준으로 정리해야 할 것들이다.

| 항목 | 위치 | 한 줄 수정 |
|---|---|---|
| 토큰 비교가 비상수시간 (`!==`) 3곳 | `health-import.js:52` · `body-import.js:47` · `export-view.js:127` | `safeEqual`로 교체 |
| `?diag=1`이 무인증으로 커밋·브랜치·환경·토큰 길이 노출 | `export-view.js:43-54` | 프로덕션에서 404 또는 운영자 헤더 요구 |
| 오류 응답에 `e.message`·모델 원문(`raw`) 노출 | `analyze-*.js` | 고정 문구 + 요청 ID만 반환 |
| `req.body`를 `try` 밖에서 무방비 구조분해 → 본문 없는 POST가 500 | `analyze-food.js:13`(rateLimit보다 **앞**) · `analyze-exercise.js:15` · `analyze-body.js:14` | `req.body \|\| {}` + 400/415 반환. 과금은 발생하지 않으므로 보안이 아니라 견고성 문제 |
| 프로덕션에서도 localhost origin 상시 허용 | `security.js:9-12` | `VERCEL_ENV === 'production'`이면 제외 |
| `VERCEL_URL` 자동 화이트리스트 | `security.js:19` | preview에서만, 프리뷰엔 별도 저한도 키 |
| `VAPID_SUBJECT` 폴백이 개인 이메일 | `cron-reminders.js:60` | 필수화 + 서비스 주소 |
| 'Daniel Body Plan' 개인 브랜딩 잔존 | 5곳 | `APP_NAME`으로 치환 |
| 외부 CDN 폰트 SRI 없음 | `index.html:14` · `offline.html` | 셀프호스팅 |
| 크리덴셜 지문이 무염 SHA-256 | `import-inbox.js:39` | 서버 비밀로 HMAC |
| 인바디 호스트를 상위 응답에서 무검증 채택 | `inbody-cloud.js:156` | `*.lookinbody.com` + https 강제 |
| CSV 수식 주입 (`device` 문자열) | `src/App.jsx:543` | `=+-@`로 시작하면 `'` 접두 |
| 로그 인젝션 (사용자 제어 문자열) | `health-import.js:148` 외 | 제어문자 제거 + 구조화 로그 |
| 서버 쓰기 실패가 UI에 안 드러남 | `store.js:319` | `permission-denied` 등은 배너로 표시 |
| `push:state`가 알림 해제 시 미삭제 | `push-sync.js:58-62` | `DEL push:state:{uid}` 추가 |
| 푸시 본문에 건강 수치(잠금화면 노출) | `reminders.js:93` | 상세 숨김 옵션 제공 |
| `import:seen:*`에 TTL 없음 | `health-import.js` | 보유기간 정의 + TTL(삭제 요구 대응에도 필요) |
| `verifyUid` 중복 구현 | `push-sync.js:20` vs `_lib/verify-uid.js` | 공용 모듈로 통합 |
| 백업 복원이 파일의 `shareLink`를 거르지 않음 | `src/App.jsx:607` | 항상 제거 (현재는 현재 값이 있을 때만 우선) |
| 오프라인 멤버십 캐시가 모든 오류를 오프라인으로 간주 | `store.js:94` | `permission-denied`는 구분 |
| 만 14세 미만 연령 확인 없음 | `ProfileSetup.jsx` | `age` 입력에 하한 + §22-2 고지. **초대제인 동안은 운영자가 유입을 통제**하므로 low. 공개 가입 전환 시 필수. 자진신고라 효과는 차단이 아니라 고지·기록 |
| 유출 사고 대응·통지 절차 문서 없음 | — | 런북 1장 + 알림 채널. 사고 발생 시 의무라 출시를 막지는 않으나, 탐지 수단이 없으면 "유출된 줄도 모르는" 상태가 지속된다 |
| 신체 사진을 Firestore **문서 필드**에 base64로 저장 | `store.js:224` · `ProgressPhotos.jsx:37-41` | 900KB 허용인데 문서 한도가 1MB라 경계가 위태롭다. `store.getAllData`가 전량 로컬 복사하는 부담도 사진이 원인. Firebase Storage + Storage Rules로 이전 (법적 축이 아니라 비용·견고성 축) |
| `users/_shared/data/{doc}` 와일드카드 read — 앱이 쓰는 문서는 2개뿐인데 그 경로 전체가 전 멤버에게 열림(레거시 `profiles` 잔존 시 함께 노출) | `firestore.rules:65-68` | `{doc} in ['shared-foods','shared-exercises']`로 화이트리스트. 기능 손실 0 |
| App Check 미설정 시 `console.warn`만 | `firebase.js:36` | 프로덕션 빌드 실패로 전환 |

---

## 5. 확인된 강점 (상용화에 유리하게 작용하는 것)

감사에서 "이미 잘 되어 있다"로 확인된 것들이다. 아래 항목은 고치지 말 것.

### 5-1. 구조적 강점

- **서버가 Firestore 자격증명을 갖지 않는다** — `api/_lib/share-store.js:3-7`, `api/health-import.js:7`.
  `api/*`는 firebase 패키지를 import하지 않는다. 서버 비밀값(ANTHROPIC_API_KEY 등)이 유출돼도
  사용자 DB 열람으로 이어지지 않는다. 상용 서비스에서 보기 드문 수준의 최소 권한 태세다.
- **데이터 격리** — `firestore.rules:73-74` `isSelf(uid) && isMember()`. 클라이언트도 항상
  Auth uid로만 경로를 만든다(`src/App.jsx:95` `setUserId(u.uid)`).
- **초대 코드 오라클 차단** — `firestore.rules:44-46` `invites/{code}` read/write 전면 `false`.
  코드 검증은 규칙 엔진의 `get()`이 수행하므로 "가입하지 않고 코드 적중만 확인"하는 경로가 없다.
- **members 문서 위조 방어** — `:53-59` 본인 uid만 생성, 필드 화이트리스트, 토큰 이메일 일치 강제,
  list/update/delete 전면 차단.
- **운영자 사칭 방어** — `:33` `email_verified == true` 요구. `src/__tests__/owner-email.test.js`가
  `src/auth.js`와 규칙 파일의 이메일 일치를 테스트로 고정한다.

### 5-2. 서버 API 위생

- **크론 인증이 모범적이다** — `api/cron-reminders.js:46-54`: `CRON_SECRET` 미설정 시 **fail-closed 503**,
  rate limit을 비밀값 대조보다 **먼저**, 비교는 상수시간 `safeEqual`. `src/__tests__/cron-auth.test.js`가 고정.
- **공유 토큰 설계** — 122비트 난수 32자 hex(`share-create.js:39`), 형식 검증 정규식을 모든 진입점에
  공유(`share-store.js:23-25`), TTL 1시간~7일, 폐기는 tombstone→410, 조회 카운터를 **별도 키로 분리**해
  폐기 되살림 경합을 제거(R-08 수정). 회귀 테스트 존재.
- **메서드·Origin 처리 일관성** — 모든 핸들러가 `checkOrigin → OPTIONS → 메서드 → rateLimit → 인증`
  순서를 지킨다. Origin 비교가 정확 일치라 접두사 우회가 없고, 빈 Origin·`null`도 거부한다.
- **KV 명령 인젝션 차단** — `kv.js:15-19` 명령을 JSON 배열 본문으로 전송. rate limit 키는
  `encodeURIComponent` 처리.
- **업스트림 오류 본문 비노출** — Anthropic 오류는 상태 코드만 반환(`analyze-food.js:86`).
- **ack는 본인 사서함에만** — `import-inbox.js:270-287` 문자열·길이 검증 후 `import:*:{본인uid}` 해시에만 HDEL.

### 5-3. 자동 유입·인바디 경로 방어

- **insert-only 멱등 설계** — `seen` 조회 → 사서함 기입 → `SET NX` 도장 순서로 "도장은 찍혔는데
  사서함에 없음"이라는 영구 유실 창을 제거.
- **인바디 계정 잠금 3중 방어** — 동시 실행 선점(`SET NX`), 연속 실패 상한 3, 인증 실패 시
  크리덴셜 지문 기반 24시간 봉인(env 수정 시 자동 해제). 요청별 8초 타임아웃 + 총 12초 예산.
- **로그 위생** — 인바디 실패 시 값이 아니라 "형태"(길이·앞 3자)만 기록(`import-inbox.js:176-178`).
  수신 로그에 본문 전문을 남기지 않는다.

### 5-4. 클라이언트

- **XSS 방어** — `dangerouslySetInnerHTML` 사용처 0건. 공유 뷰 SSR은 HTML 이스케이프 + noindex +
  no-store이며 XSS 회귀 테스트가 있다(`src/__tests__/export-view.test.js:84`).
- **백업 위생** — 백업 JSON에서 `goals.shareLink`(살아 있는 링크 = 전권)와 계정 식별자(uid·email)를
  제거한다(`src/backup.js` `sanitizeGoals`·`sanitizeProfile`, R-07·R-43).
- **사진 크기 상한** — 클라이언트에서 900px·900KB로 압축(`ProgressPhotos.jsx:34-42`),
  사진 서브컬렉션은 localStorage 미러에서 제외해 기기 잔존 범위를 줄였다.
- **계정 전환 레이스 방어** — `src/App.jsx:81-104` 세대 카운터로 연속 로그인 시 이전 판정이
  새 화면을 덮지 않는다.
- **공유 시 내용 고지** — `analysisExport.js:65-71` "URL을 가진 사람은 누구나 볼 수 있다 +
  직접 쓴 컨디션 메모 N건도 그대로 실린다"를 건수와 함께 표시(R-22 반영).

### 5-5. 개발 프로세스

- **CI가 push·PR마다 lint(api 포함)+전체 테스트를 실행**(`.github/workflows/ci.yml`).
  훅이 없는 경로(직접 push, 다른 기여자)도 같은 게이트를 통과한다.
- **테스트 44개 파일**에 보안 계약이 다수 고정돼 있다(크론 인증 순서, 공유 링크 폐기 경합,
  푸시 상태 단조 병합, 운영자 이메일 일치, XSS 이스케이프).
- **자체 감사 이력**(`docs/system-audit-2026-08.md` R-01~R-49)이 실재하며 상당수가 코드에 반영돼 있다.
  이 문서의 여러 발견이 그 감사의 "미해결 잔여"를 가리킨다.

---

## 6. 의존성 취약점 — 실제 노출 판정

`npm audit` 31건(critical 1 · high 12 · moderate 17 · low 1)을 `npm ls`로 의존 경로를 추적하고
실제 빌드 산출물을 grep해 분류했다.

| 분류 | 건수 | 내용 |
|---|---:|---|
| **프로덕션 런타임 노출** | **0** | 브라우저 번들·Vercel 서버리스 어디에도 취약 패키지가 로드되지 않음 |
| 무관(설치만 됨) | 14 | firebase의 **Node 빌드 전용** 의존성 — undici 체인 10 · `@grpc/grpc-js` · protobufjs · `@protobufjs/utf8` · **websocket-driver(critical)** |
| 빌드·테스트 체인 | 17 | vite · esbuild · vite-plugin-pwa · workbox-build · serialize-javascript · babel 2 · browserslist · postcss · nanoid · brace-expansion · js-yaml · fast-uri · vitest 등 |

### 6-1. critical 1건은 실제로 로드되지 않는다

`websocket-driver@0.7.4`(critical)의 경로는 `firebase → @firebase/database → faye-websocket → websocket-driver`다.
`firebase/database`는 `src/` 어디에서도 import되지 않는다(`src/firebase.js`는 app·firestore·auth·app-check만).
`api/*`는 firebase SDK를 전혀 쓰지 않는다. 빌드 산출물 grep에서 `faye-websocket`·`websocket-driver` 0건.
같은 논리로 `@grpc/grpc-js`·`protobufjs`·`undici`도 Node 빌드에서만 `require`되며, 브라우저는
`exports.browser` → webchannel 빌드를 쓴다.

### 6-2. 그러나 firebase 10.x는 출시 전 반드시 올려야 한다

**취약점 때문이 아니라 패치 채널이 끊겨서다.**

- Firebase JS SDK에는 LTS가 없고 **최신 메이저에만 수정이 들어간다.**
- 10.x 마지막 릴리스는 2024-10-10(10.14.1, 현재 설치본). 11.x는 2025-06-30에서 멈췄고 현재는 12.19.0이다.
- 즉 **약 2년간 보안 패치가 닿지 않는 메이저를 유료 건강 서비스의 인증·DB 클라이언트로 쓰는 셈**이다.
- `npm audit fix`는 이 체인을 해결하지 못한다. `^10.12.0` 안에 undici를 벗어나는 릴리스가 없어,
  audit은 오히려 firebase를 10.13.0으로 **다운그레이드**하면서 실질 수정은 못 한다.

**업그레이드 위험은 낮다.** 앱이 쓰는 API 표면이 작고 전부 v9 모듈러 API라 12.x에 같은 시그니처로 존재한다:
`initializeApp`·`getFirestore`·`getAuth`·`initializeAppCheck`·`ReCaptchaV3Provider`(`src/firebase.js`),
`doc/getDoc/setDoc/deleteDoc/collection/getDocs`(`src/store.js:3`),
`GoogleAuthProvider`·`onAuthStateChanged`·`signInWithPopup`·`signInWithRedirect`·`getRedirectResult`·`signOut`(`src/auth.js:5-12`).
서버는 SDK를 쓰지 않아 Node 요구사항 변경과 무관하다. 업그레이드 후 lock 재생성 시 undici 체인이
사라지고 firebase 측 audit 0건이 예상된다.

### 6-3. 서버리스 런타임의 유일한 npm 의존성

`api/*`가 실제로 번들하는 npm 패키지는 **web-push 3.6.7 하나**다(나머지는 `node:crypto`·`node:https` 내장).
공개 어드바이저리는 **없다**(레지스트리·GitHub Advisory 조회로 확인). 다만 두 가지가 남는다.

- **유지보수 리스크**: 마지막 릴리스가 2024-01-16이다. 향후 취약점이 나와도 패치 여부가 불투명하다.
- **사용 방식 결함**: 라이브러리가 아니라 호출부 문제다 — §2 P0-4 참조.

### 6-4. 권고

```
① firebase 10.14.1 → 12.x            (출시 전 필수 · 위험 낮음 · 골든셋+스모크로 회귀 확인)
② 나머지 non-major 패치 28건         (lock 재생성으로 대부분 해소)
③ vite 8 · vite-plugin-pwa 1.x       (메이저 · dev 서버 전용 취약점이나 Windows 개발 환경에
                                      실제 .env가 있으므로 권장. 출시 블로커는 아님)
④ CI에 `npm audit --omit=dev --audit-level=high` 추가 + dependabot.yml
```

---

## 7. 내가 확인할 수 없는 것 — 당신이 확인해줘야 할 것

**여러 발견의 심각도가 아래 값들에 좌우된다.** 특히 ①②는 지금 바로 확인 가치가 있다.

### 7-1. 최우선 (지금 확인하면 판정이 확정되는 것)

| # | 확인할 것 | 어디서 | 왜 중요한가 |
|---|---|---|---|
| 1 | **Vercel 프로덕션에 `KV_REST_API_URL`/`TOKEN`(또는 `UPSTASH_*`)이 실제로 있는가** | Vercel → Settings → Environment Variables | 없으면 **지금 이 순간 모든 rate limit이 통과 상태**다(`security.js:59-64`). P0-3의 심각도가 한 단계 오른다. 빠른 확인: 배포 로그에서 `[rateLimit] KV not configured` 검색 |
| 2 | **현재 요금제가 Hobby인가 Pro인가** | Vercel → Settings → General | Hobby는 **상업적 사용 금지**다(약관). 유료화 시작 즉시 위반 |
| 3 | **게시된 Firestore 규칙 원문** | Firebase 콘솔 → Firestore → 규칙 | 저장소본과 diff. 2026-07에 `if true` 드리프트가 실제로 있었던 이력이 있다(`docs/DEPLOY-PATH-B.md:46`) |
| 4 | **App Check 강제(Enforce) 상태** | Firebase 콘솔 → App Check → Firestore | 규칙의 `request.app != null`이 실효 중인지. `VITE_RECAPTCHA_SITE_KEY` 주입 여부도 함께 |
| 5 | **두 번째 구글 계정으로 타 uid 접근 실측** | 브라우저 콘솔 | 아래 절차. 규칙이 실제로 막는지를 확정하는 유일한 방법 |

**5번 실측 절차** (비멤버 계정 1개, 멤버 계정 1개로 각각):

```js
// 앱에 로그인한 상태의 브라우저 콘솔에서
const otherUid = "<다른 사용자의 uid>";
await getDoc(doc(db, "users", otherUid, "data", "goals"));      // 기대: permission-denied
await getDocs(collection(db, "users", otherUid, "data"));       // 기대: permission-denied
await getDoc(doc(db, "invites", "AAAA-BBBB"));                  // 기대: permission-denied
await getDocs(collection(db, "members"));                       // 기대: permission-denied
await setDoc(doc(db, "users", "_shared", "data", "shared-foods"), {list:[]}); // 멤버: denied / 운영자: 성공
```

### 7-2. 비용·한도 (P0 심각도 산정에 필요)

| 확인할 것 | 어디서 |
|---|---|
| Anthropic 조직의 **월 지출 한도·알림 설정** 여부, rate limit tier(RPM/ITPM) | Anthropic Console |
| Upstash **리전·요금제·저장 용량·eviction 정책** | Upstash Console |
| Firebase **요금제(Spark/Blaze)·예산 알림·Firestore 리전** | Firebase 콘솔 |
| Vercel **Deployment Protection**(프리뷰 URL 보호) 활성 여부 | Vercel → Settings → Deployment Protection |

> eviction이 켜져 있으면 메모리 압박 시 인바디 계정 잠금 방어 키(`import:body-cloud-authblock` 등)가
> 먼저 사라질 수 있다 — `noeviction` 권장.

### 7-3. 법무·계약 (§2 P0-5의 전제)

- 개인정보처리방침·이용약관 초안 존재 여부 및 변호사 검토 계획
- **개인정보보호법 §23**(민감정보 별도 동의) · **§26**(처리위탁 고지) · **§28-8**(국외이전 고지)에 맞는 문안
- 각 수탁자와의 DPA: Google(Firebase) · Vercel · Upstash · **Anthropic**(건강 수치·음식 사진이 미국으로 전송됨)
- Anthropic 데이터 보존 정책(기본 30일 vs Zero Data Retention 승인 여부)
- **인바디(LookinBody) 이용약관** 원문 — 비공식 API·자동화 접근 금지 조항 유무
- 만 14세 미만 처리 정책, AI 코칭의 의료행위 면책 문구, 의료기기 소프트웨어 해당 여부
- 결제 도입 시 PG 위탁 고지, 전자상거래법상 사업자 표시

### 7-4. 운영자 계정·저장소

- **운영자 구글 계정(`munansa@gmail.com`)의 2단계 인증·패스키** — 현재 이 계정 하나가 전 사용자
  데이터 read 권한을 가진 단일 신원이다(§2 P0-8)
- 저장소 전체 이력 시크릿 스캔 재실행(gitleaks/trufflehog) — 이 감사는 로컬 클론 기준으로 스캔했다
- GitHub Secret scanning + Push protection 활성화, Dependabot 알림
- **`users/_shared/data/profiles`(구 비밀번호 해시)와 레거시 `users/daniel/**`이 콘솔에 아직 남아 있는가**
  — 남아 있으면 즉시 삭제 대상(`docs/DEPLOY-PATH-B.md:139-141`이 삭제를 권고했으나 완료 여부 미확인)

---

## 8. 수정 로드맵

### 1단계 — 지금 (반나절, 코드 변경 없음)

§7-1의 5개를 확인한다. 특히 **Vercel 프로덕션에 KV env가 있는지**와 **현재 요금제**.
둘 중 하나라도 나쁘면 아래 순서가 바뀐다.

동시에 **Anthropic 콘솔에서 이 앱 전용 워크스페이스를 만들고 지출·rate limit을 낮게 설정**한다.
코드 한 줄 고치지 않고 P0-1의 피해 상한을 즉시 낮추는 유일한 조치이며, 남용이 나도
조직 전체가 아니라 이 앱만 멈추게 하는 격벽이 된다.

### 2단계 — 1~2주 (코드, 출시 차단 해제)

```
P0-2   입력 길이·타입 검증 3파일                                       (S)  ← 가장 싸고 효과 큼
P0-4   web-push timeout 1줄 + endpoint 화이트리스트 + 루프 배치화       (S)
P1-12  크론 루프 uid 단위 try/catch (P0-4와 같은 작업)                  (S)
P1-1   rateLimit fail-closed 옵션 + 부팅 체크 (P0와 같은 묶음으로)      (S)
P0-1   analyze-* 3종에 verifyIdToken + 클라이언트 4곳 idToken 전송      (M)
P0-3   멤버십 게이트 (단기: members 조회 + 캐시 / 정석: custom claim)    (M)
P0-8   firestore.rules:75 운영자 read 제거 (마이그레이션 완료 확인 후)   (S)
P0-10  firebase.json 추가 + 규칙 배포 CI화 + 에뮬레이터 규칙 테스트      (M)
P0-9   firebase 12 업그레이드 + 골든셋 회귀 확인                         (M)
P0-6   Vercel Pro 전환                                                  (S)
P0-7   IMPORT_*·INBODY_* env 비우기(기능 off) 또는 재설계 결정           (S/L)
P1-2   로그아웃 purge                                                   (S)
P1-3   vercel.json 보안 헤더                                            (S)
```

> 순서는 **작업량 대비 효과** 기준이다. 위 4줄은 전부 S등급이고 합쳐도 반나절이 안 되는데
> P0-2·P0-4·P1-12를 덮는다. 인증 작업(P0-1·P0-3)은 클라이언트 4곳을 함께 고쳐야 해서 뒤에 뒀다.

### 3단계 — 병행 (법무 트랙, 2단계보다 먼저 시작)

```
P0-5  처리방침·약관 문안 작성 → 변호사 검토
      민감정보 별도 동의 UI 설계
      계정 삭제 흐름 설계 (Firestore + localStorage + KV 단일 함수)
      국외이전·처리위탁 고지 문안 (수탁자 5곳)
      의료 면책 문구
      InBody 약관 검토 (P0-7 결정의 전제)

※ §30 처리방침은 유·무료 무관한 의무라 "유료화 전"이 아니라 "지금" 착수 대상이다.
※ 계정 삭제는 클라이언트가 대부분 처리한다 — 서버가 필요한 것은 members 1개 문서와 KV 정리뿐.
```

### 4단계 — 출시 전 마무리 (2~3주)

```
P1-4~5   공유 링크 암호화 + uid 역색인 + pkg 구조 검증
P1-6     규칙 필드 검증(제안본) 배포 + 문서 크기 상한
P1-13    멤버십을 custom claim으로 이전 (P0-3 정석 수정과 같은 작업)
P1-9     JWT 로컬 검증 전환 → 웹 API 키에 리퍼러 제한 적용
P1-10    브랜치 보호 · Secret scanning · Dependabot · npm audit 게이트
P1-8/11  클라이언트 재검증 · KV 위생
P1-14    체성분 수신 개수 상한 + seen 키 TTL + 미래 날짜 상한
P2       위생 항목 일괄 (대부분 1~2줄)
```

### 출시 판정 기준

- [ ] P0 **10건** 전부 해결 또는 해당 기능 비활성화
- [ ] §7-1의 5개 확인 완료, 특히 게시된 규칙이 저장소본과 일치
- [ ] 두 번째 계정으로 타 uid 접근 실측이 전부 `permission-denied`
- [ ] Anthropic 워크스페이스 분리 + 지출 한도 설정, Firebase·Upstash 예산 알림
- [ ] 처리방침·약관·동의 UI·계정 삭제 경로 배포 + 법무 검토 완료
- [ ] 규칙 배포가 CI화되어 저장소본이 곧 게시본 (P0-10)
- [ ] 규칙 에뮬레이터 테스트가 CI에서 녹색

---

## 9. 부록 — 판정이 바뀐 항목 (반박 검증 기록)

원 발견에서 과대평가로 판정돼 심각도가 내려간 것들이다. 같은 실수를 반복하지 않기 위해 남긴다.

| 원 주장 | 교정 |
|---|---|
| "AI 비용 폭탄 — 하루 $8,000~$23,000" | 조직 ITPM(Start 2M/분)이 $2.00/분으로 고정한다. IP를 늘려도 조직 단위라 증가하지 않는다. **실효 피해는 월 $500~$1,000 + 최대 4주 AI 중단** |
| "Vercel 본문 4.5MB를 채워 과금" | 4.5MB ASCII ≈ 110만 토큰 > 200K 컨텍스트 → Anthropic이 400으로 거부, 과금 $0. 공격자는 700~800KB로 맞춰야 한다 |
| "무료 범용 LLM 프록시가 된다" | 프롬프트 접두사가 한국어 영양/MET 지시문으로 고정되고 출력이 300~800토큰에서 잘려 실용성이 없다. 남는 위험은 운영자 키에 귀속되는 목적 외 생성물(약관 리스크) |
| "share-create로 KV를 채워 rate limit 무력화" | `share-create`는 익명으로 1바이트도 못 쓴다(401). 로그인 회원만, 분당 10회 제한 아래에서만 가능 |
| "rateLimit fail-open이 비용 상한을 없앤다" | 단일 IP의 **합법** 한도(분당 80콜)만으로 이미 조직 ITPM을 채운다. fail-open은 상한을 바꾸지 않는다 → high에서 medium으로 |
| "`req.body` 구조분해 크래시로 DoS" | Anthropic 호출 전에 죽어 과금 $0. 500 응답 1건뿐이고 추가 공격 능력이 없다. 보안이 아니라 견고성 문제 → high에서 low로 |
| "규칙 필드 검증 부재 = 비용 폭탄" | 1MiB × 1만 건 ≈ 10GB ≈ 월 $1.8. 식별된 회원만 가능하고 차단도 쉽다. 실질 보호는 크기 상한 + 예산 알림 |
| "share-create로 서비스 도메인에 피싱 문구를 호스팅" | `<pre>` + `esc()`라 앵커·폼·XSS가 불가능하고 자동 링크화도 없다. noindex로 검색 노출도 없다. 토큰이 122비트라 공격자가 링크를 직접 전달해야 하는데, 그게 가능하면 이 도메인을 경유할 이유가 없다 |
| "비회원이 유료 기능을 무임승차한다" | 비회원은 규칙상 **자기 데이터조차** 읽고 쓸 수 없다. 게이트 뒤에 훔칠 기능이 없다. 남는 것은 순수한 자원 남용이며, 그래서 '기밀성'이 아니라 '자격 경계' 결함이다 |
| "KV 고갈 = 요금 폭탄" | Upstash 종량 환산 시 저장·명령·대역폭 합계 **월 $20~25** 수준. 피해는 금액이 아니라 용량 도달 시의 전면 장애 |
| "크론 tarpit 계정 1개로 전원 영구 차단" | 피해는 `SMEMBERS` 순서상 공격자 뒤쪽 uid로 한정되고 순서를 공격자가 제어할 수 없다. 기대값은 k개 계정에 대해 평균 N/(k+1)명 발송 — 1개면 약 절반 |
| "크론 아웃바운드 = 블라인드 SSRF" | `web-push`는 스킴과 무관하게 항상 TLS로 요청한다. 내부 메타데이터(평문 HTTP)에 닿을 수 없다. endpoint 검증의 근거는 SSRF가 아니라 tarpit 정지다 |
| "크론 절단 임계 40~200명" | uid당 소요 재계산 결과 **대략 100~350명**(동일 리전·푸시 1건이면 약 330명, 크로스 리전·푸시 3건이면 약 75명) |
| "게시본에 `if true`가 남아 타인 데이터가 열려 있을 수 있다" | 감사자 실측이 반증했다. 그 상태였다면 비인증 REST read가 200이어야 하는데 403이었다. 남는 현실적 드리프트 후보는 App Check 조건 제거뿐이며, 이는 타 uid 노출이 아니다. **P0-10의 근거는 특정 드리프트가 아니라 검증 수단의 부재 자체다** |
| "규칙 `:75` 한 줄이 전량 유출의 단일 지점" | 같은 구글 계정이 Firebase 콘솔 소유자라 그 줄을 지워도 콘솔로 전량 열람이 된다. 이 줄의 실제 증분은 둘뿐이다. 더 약한 사건(기기 분실·세션 탈취)만으로 충분해지는 것, 그리고 콘솔은 Admin Activity 로그를 남기지만 SDK 경로는 아무것도 안 남는 것 |
| "초대 코드 브루트포스로 뚫린다" | `invites`는 read/write 전면 차단이라 직접 오라클이 없고, 유일한 오라클은 시도마다 Auth + App Check 토큰을 요구한다. 권장 형식(영숫자 8자 ≈ 2.8×10¹²)이면 초당 100회로도 수백 년 |
| "초대 시도당 `get()` 과금 = 비용 공격" | Firestore 읽기 10만 건당 약 $0.06. 1억 회 시도해도 약 $60이다 |
| "멤버십 폐기 경로가 없다" | 사실 오류였다. `delete: if false`는 클라이언트만 막고 운영자는 콘솔·Admin SDK로 지울 수 있다. 정확한 서술은 "셀프서비스 탈퇴가 없고 구독 상태를 모델이 표현하지 못한다" |
| "`_shared/profiles`의 비밀번호 해시가 유출된다" | 이 저장소로는 검증 불가다. 루트 커밋이 이미 Auth 도입 이후라 해싱 코드가 전 이력에 없다. 노출도 멤버 한정이고 모집단은 전환 이전 1인용 시절 프로필이다 → low |
| "IMPORT_TOKEN이 새면 타인 건강 데이터가 노출된다" | 이 토큰은 **쓰기 전용**이다. 사서함을 읽는 경로는 Firebase ID 토큰으로 호출자 uid를 결박한다. 토큰 보유자가 할 수 있는 것은 검문 규칙 범위 안의 **주입**뿐이다 |
| "두 번째 사용자가 가입하면 자동으로 운영자 사서함에 섞인다" | 단축어 설정에는 서버 env인 `IMPORT_TOKEN`이 필요하고 클라이언트에 노출되는 경로가 없다. 운영자가 손으로 배포해야 성립한다. 자동 사고가 아니라 다중 사용자 제공 시점의 구조적 불가능성 → high에서 medium |
| "인바디 비밀번호를 평문 전송한다" | TLS 위로 보낸다. 문제는 전송이 아니라 **가역 보관**이다. API 로그인에 원문이 필요해 해시가 불가능하고 그래서 env에 원문이 남는다 |
| "`credShape`가 비밀번호 길이를 노출한다" | 기각. 그 로그는 `IMPORT_UID` 본인에게만 반환된다. 제3자가 도달하는 경로가 없다 |
| "토큰 비교 `!==`로 타이밍 공격이 가능하다" | 토큰이 192~256비트이고 rate limit이 토큰 대조보다 먼저 온다. TLS·엣지·서버리스 지터로 나노초 측정이 불가능하다 → 위생 항목 |
| "체성분 수신으로 분당 27만 KV 커맨드" | 커맨드가 순차 HTTPS 왕복이라 함수 실행 시간이 먼저 끊는다(약 1,000~1,500 커맨드). 실효 상한은 페이로드가 아니라 실행 시간. 다만 잘린 시점까지의 키는 남는다 |
| "`ProfileSetup`이 민감정보를 동의 없이 수집한다" | 이름·키·나이·목표 체지방률은 §23 민감정보가 아니라 일반 개인정보다. 동의 게이트가 필요한 실제 지점은 `HealthEvents`의 note·진행 사진·`bodylog`·`analyze-*` 전송 4곳이다 |
| "부상·질병 메모까지 AI 코치 프롬프트에 실린다" | **사실이 아니다.** 직접 확인했다. `BodyTab.jsx:134-140`은 숫자 필드 5종만 보내고 `analyze-body.js:14`가 그것만 받는다. `healthEvents`는 포함되지 않는다. 메모가 실리는 것은 사용자가 스스로 복사·공유하는 분석 패키지뿐이다 |
| "계정 삭제에 Admin SDK 서비스 계정이 필요하다" | 과장이었다. 규칙의 `write`에 delete가 포함되어 `users/{uid}/data/**`는 클라이언트가 전량 지울 수 있고 Auth 계정도 클라이언트 SDK로 지운다. 서버가 필요한 것은 `members/{uid}` 1개와 KV 정리뿐이다 |
| "`import:seen:*`은 키 열거가 필요해 누락이 구조적" | 키 형식이 `import:seen:{uid}:{dedupKey}`라 uid 프리픽스 SCAN으로 특정 가능하다. 남는 문제는 TTL 부재(보유기간 정의)다 |
| "국외이전 별도 동의 모달이 필수" | §28-8①3은 위탁·보관 목적에 대해 처리방침 공개 또는 고지로 동의를 갈음하는 경로를 둔다. 처리방침의 수탁자 표가 제1 해법이다 |
| "사진 전송 전 EXIF를 제거해야 한다" | **이미 되어 있다.** `App.jsx:1011-1030`이 canvas 800px 재인코딩을 거치므로 EXIF가 전부 소실된다. 남는 위험은 메타데이터가 아니라 화면에 찍힌 내용이다 |
| "공유 링크에 고지가 없다" | 발급 직전·직후 두 곳에 경고가 있고 보존기간도 사용자가 고른다. 남는 공백은 저장 사업자(Upstash) 미고지와 동의 기록 부재 둘뿐이다 |
| "Vercel Hobby 위반이 high" | 결제 설정 1회로 해소되는 운영 항목이고 현재 유료 고객이 0명이다. Hobby라는 증거 자체도 약하다 → medium |
| "연령 게이트 부재가 medium/blocker" | 초대제라 운영자가 코드를 주지 않으면 아동이 자력 가입할 수 없다. 자진신고라 차단 효과도 없다 → P2 |
| "사고 대응 절차 부재가 출시 차단" | §34는 사고가 발생해야 적용되는 의무다. 사전 문서 부재 자체는 법 위반이 아니다 → P2 |
| "애플리케이션 레벨 암호화가 필요하다" | 기각. PWA에서 실효가 낮고 법정 요구도 아니다. 살릴 것은 암호화가 아니라 사진을 Firestore 문서에서 Storage로 옮기는 것이며, 이는 법적 축이 아니라 비용·견고성 축이다 |
| "백업 복원이 공격자 `shareLink`를 심는다" | `App.jsx:607`은 현재 링크가 있으면 그것을 우선한다. 없을 때만 파일 값이 남고, 폐기 시도는 소유자 불일치로 403이 되어 실패한다. 혼동 위험만 남는 low |


---

*이 문서는 코드 기준 판정이다. §1-3의 한계와 §7의 미확인 항목을 함께 읽을 것.*
