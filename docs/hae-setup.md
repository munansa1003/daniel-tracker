# 플랜 C — Health Auto Export(HAE)로 운동 자동 전송 설정

## 왜 이 경로인가

2026-08-05 기기 확인 결과, 이 iPhone의 단축어 앱에는 운동 세션을 **읽어오는** 동작이 없다
(「건강 샘플 찾기」 유형 목록에 '운동' 없음 · 「운동 찾기」 전용 동작 없음 · Apple Watch 운동
자동화 트리거 없음). 설계 시점에 준비해 둔 폴백대로, 운동을 JSON으로 서버에 POST하는 전문
앱 **Health Auto Export**(HAE)를 배달부로 쓴다. 검문소는 HAE 형식을 자동 인식해 변환하며
(`api/_lib/import-rules.js`의 HAE 파서), 이후 규칙 8종·insert-only·중복 차단은 네이티브
경로와 완전히 동일하다 — dedup 키가 유형+시각 기반이라 **두 경로가 섞여도 같은 운동은 1건**.

## 1. 앱 설치와 권한

1. App Store에서 **"Health Auto Export - JSON+CSV"** 설치 (개발자 Lybron)
2. 첫 실행 → 건강 데이터 접근 요청 → **운동(Workouts) 읽기 허용** (필요하면 "모두 켜기")
3. REST API 자동화는 프리미엄 기능 — 무료 체험으로 끝까지 검증한 뒤 구매를 판단하면 된다

## 2. 자동화(Automation) 만들기 — 설정값 표

앱의 **Automations** 탭 → 새 자동화(＋) → 다음과 같이:

| 설정 | 값 | 비고 |
|---|---|---|
| Automation Type / 대상 | **REST API** | |
| URL | `https://daniel-tracker.vercel.app/api/health-import` | |
| Headers | 키 `X-Import-Token` · 값 `⟨토큰 48자⟩` | Vercel의 IMPORT_TOKEN과 동일하게. Content-Type은 앱이 자동 추가 |
| Export Format | **JSON** | CSV 금지 |
| Data Type | **Workouts** | ⚠️ Health Metrics 금지 — 일일 총량 수입은 설계상 금지 + 페이로드 폭증 |
| Period / Date Range | **Today** | 오늘 것 반복 전송 — 중복은 서버가 무시(설계된 동작) |
| Aggregate Data | 기본값 | workouts에는 영향 없음 |
| Sync Interval | **1 hour** (또는 30–60분) | 배터리·즉시성 취향대로 |
| Enabled | **켬** | |

## 3. 첫 테스트 (수동 전송)

1. 자동화 상세 화면의 **수동 내보내기/Export** 버튼 실행
2. 앱이 성공(2xx)을 표시하면 → Body Plan 앱 열기(새로고침) → 해당 날짜에 ⌚ 배지 운동 확인
3. 설정 → 데이터 → "자동 가져오기(애플워치)" 카드의 수신 로그에도 줄이 생긴다 (경로 표시: hae)

## 4. 서버가 해주는 것 (몰라도 되지만 알면 안심)

- **형식 자동 인식**: `{ data: { workouts: [...] } }`를 표준 봉투로 변환 (workouts v1/v2 모두)
- **시간대 보정**: HAE가 UTC(`… Z`)로 보내도 귀속일은 **한국시간 벽시계** 기준
  (기본 +09:00 · 필요시 Vercel env `IMPORT_TZ_OFFSET`로 변경 — 선택 사항, 미설정 시 KST)
- **단위 방어**: duration 초→분 변환, 에너지 kJ→kcal 자동 환산, kcal 반올림
- **빈 전송 정상 처리**: 새 운동 없는 주기 동기화는 200 "0건 추가" (HAE에 에러로 안 뜸)
- 이후는 기존과 동일: 화이트리스트(한/영) · 컷오버 · insert-only · race 원자성 ·
  사서함 → 앱 병합 → 유효목표 자동 반영
- **근력도 자동** (2026-08-06 정책 전환): 워치의 근력 훈련(기능성/전통적 등 표기 변형 포함)은
  **"근력 운동" 한 건**으로 저장된다. 세부 종목(벤치프레스 3×10 등)은 앱에서 해당 기록을
  눌러 **메모**에 적는다 — 개별 종목을 따로 수동 입력하면 이중 계상이므로 금지

## 5. 문제 해결

| 증상 | 원인/조치 |
|---|---|
| 앱에 401 표시 | Headers의 토큰 값 확인 (공백·오타) |
| 앱에 503 표시 | 서버 환경변수 3종/재배포 확인 (docs/shortcut-recipe.md §0.1) |
| 400 "본문 100KB 초과" | Data Type이 Workouts인지, Period가 Today인지 확인 |
| 전송은 성공인데 앱에 안 보임 | Body Plan 새로고침 → 설정 카드 "지금 확인" → 운동 날짜 확인 |
| 알림처럼 결과 요약을 보고 싶다 | HAE는 앱 내 동기화 기록으로 확인 (응답 message는 서버 로그·수신 카드에 남음) |

## 관련 계약 테스트

`src/__tests__/health-import.test.js` — "HAE 폴백" 8종: v2 정상 변환 · UTC 귀속 ·
경로 무관 dedup · 빈 workouts 200 · kJ 환산 · 근력 '근력 운동' 수입 · v1 유도 · 형식 오류 집계.
