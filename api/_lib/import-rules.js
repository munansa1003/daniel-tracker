// api/_lib/import-rules.js — 애플워치 운동 자동 수신(검문소) 규칙 단일 출처.
//
// 이 파일이 요청 스키마·유산소 화이트리스트·값 범위·컷오버·날짜 귀속의 유일한 정의다.
// docs/shortcut-recipe.md(단축어 조립 가이드)는 이 정의를 그대로 옮겨 적은 문서이며,
// 서로 어긋나면 계약 테스트(health-import.test.js §7)가 잡는다.
// 순수 모듈 — KV/네트워크 접근 없음. HAE 등 다른 브릿지로 갈아탈 때는 이 모듈을
// 재사용하고 페이로드 → {type,start,end,durationMin,kcal} 변환 파서만 추가하면 된다.

export const IMPORT_SOURCES = ["workout-end", "evening-backup", "manual-tap", "hae"];
// 실외 자전거·러닝은 GPS 경로가 통째로 실려 수백 KB를 넘는다(2026-08-09 실측 —
// 100KB 상한이 자전거 운동을 이틀간 거부). 서버는 이름·시각·시간·kcal만 읽고
// 경로·심박은 버리므로 큰 본문도 파싱 비용뿐. 상한은 Vercel 함수 한계(4.5MB) 아래.
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const MAX_WORKOUTS = 100;
export const KCAL_MIN = 1;
export const KCAL_MAX = 2000;   // kJ 오염(×4.184)·이상치 차단
export const DUR_MIN = 1;
export const DUR_MAX = 600;

// ── 유형 화이트리스트 (한국어/영어 병기 — 기기 언어에 따라 어느 쪽이든 온다) ──
// n = 저장용 대표 이름. 통계 분류(analysisExport의 exCategory)가 이름 키워드 기반이므로
// 유산소 대표 이름은 유산소 키워드(러닝·사이클·걷·축구·계단·하이킹·수영)에 걸리게 유지한다.
// 예외: "스트레칭"(워치 '식히기'/쿨다운·유연성 유형)은 걸리는 키워드가 없어 '기타'로
// 잡힌다 — 2026-08-06 사용자 실측(당일 워치 기록 전부 식히기)으로 편입했고, 그 기록의
// 실제 내용이 스트레칭이라는 사용자 확인에 따라 대표 이름을 "스트레칭"으로 정함.
export const AEROBIC_GROUPS = [
  { n: "러닝", aliases: ["달리기", "실외 달리기", "실내 달리기", "야외 달리기", "야외 운동", "러닝", "런닝", "트레드밀 달리기", "running", "outdoor run", "indoor run", "run"] },
  { n: "사이클링", aliases: ["사이클링", "실외 사이클링", "실내 사이클링", "자전거", "자전거 타기", "cycling", "outdoor cycling", "indoor cycling", "cycle", "bike", "biking"] },
  { n: "걷기", aliases: ["걷기", "실외 걷기", "실내 걷기", "walking", "outdoor walk", "indoor walk", "walk"] },
  { n: "축구", aliases: ["축구", "soccer", "football"] },
  { n: "계단 오르기", aliases: ["계단 오르기", "계단오르기", "계단", "stair climbing", "stair-climbing", "stairs", "stair stepper"] },
  { n: "하이킹", aliases: ["하이킹", "등산", "hiking", "hike"] },
  { n: "수영", aliases: ["수영", "실내 수영", "야외 수영", "swimming", "pool swim", "open water swim", "swim"] },
  { n: "스트레칭", aliases: ["식히기", "쿨다운", "cooldown", "cool down", "스트레칭", "stretching", "유연성", "flexibility"] },
];

// 근력 계열 — 2026-08-06 사용자 결정으로 자동 저장 대상에 편입: 워치 덩어리를
// "근력 운동" 한 건으로 받고, 세부 종목은 기록의 메모(비고)에 수동 기입한다.
// (개별 종목 수동 입력과 병행하면 이중 계상 — 편입 후에는 메모 방식만 사용)
// 대표 이름 "근력 운동"은 통계 분류(exCategory)에서 '기타'로 잡힌다 — 부위별
// 구성비 대신 총량 관리로 전환하는 것을 사용자가 수용함.
// HAE 실측 목록에는 "기능적 근력 훈련"·"전통적 근력 운동"처럼 표기 변형이 있어
// 포괄 키워드 "근력"으로 전 변형을 잡는다.
export const STRENGTH_ALIASES = [
  "근력", "기능성 근력 훈련", "전통적 근력 훈련", "웨이트 트레이닝",
  "functional strength training", "traditional strength training", "strength training", "weight training",
];
export const STRENGTH_NAME = "근력 운동";

// 유산소 키워드에 우연히 걸리지만 화이트리스트 대상이 아닌 이름(오인 수입 차단).
// 예: "미식축구"·"호주 축구"는 "축구"를, "휠체어 걷기/달리기 속도"는 "걷기/달리기"를
// 포함하지만 해당 종목이 아니다(HAE 실측 목록 전수 대조). 검사 순서: 제외 → 근력 → 유산소.
export const EXCLUDED_TYPES = ["미식축구", "호주 축구", "휠체어", "american football", "australian football", "wheelchair"];

export function normalizeType(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const STRENGTH_KEYWORDS = STRENGTH_ALIASES.map(normalizeType);
const EXCLUDED_KEYWORDS = EXCLUDED_TYPES.map(normalizeType);
const AEROBIC_KEYWORDS = AEROBIC_GROUPS.map((g) => ({ n: g.n, kws: g.aliases.map(normalizeType) }));

// 유형 분류: { kind:"aerobic"|"strength", n } | { kind:"unknown" }
// 정확 일치가 아니라 "키워드 포함" 판정 — 피트니스/HAE는 "오후 실외 걷기"처럼 수식어가
// 붙은 이름을 보내므로(실측 확인) 포함 매칭이어야 한다. 근력을 유산소보다 먼저 검사해
// "저녁 기능성 근력 훈련" 류가 유산소 대표명으로 새지 않게 한다(분류 우선순위는
// analysisExport의 exCategory와 같은 철학).
export function classifyType(rawType) {
  const t = normalizeType(rawType);
  if (!t) return { kind: "unknown" };
  for (const kw of EXCLUDED_KEYWORDS) if (t.includes(kw)) return { kind: "unknown" };
  for (const kw of STRENGTH_KEYWORDS) if (t.includes(kw)) return { kind: "strength", n: STRENGTH_NAME };
  for (const g of AEROBIC_KEYWORDS) {
    for (const kw of g.kws) if (t.includes(kw)) return { kind: "aerobic", n: g.n };
  }
  return { kind: "unknown" };
}

// ── 날짜: 오프셋 포함 ISO 8601 필수 (Z 허용) ──
// 오프셋이 있어야 "시작 시각의 로컬 날짜"(귀속일)를 문자열 그대로 읽을 수 있다.
export const ISO_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoWithOffset(s) {
  return typeof s === "string" && ISO_OFFSET_RE.test(s) && Number.isFinite(Date.parse(s));
}

export const ISO_HINT = "오프셋 포함 ISO 8601 필요 (예: 2026-08-06T18:20:00+09:00)";

// ── 스키마 검증 (규칙 1: 엄격 — 위반은 400) ──
// 봉투(envelope) 오류 메시지. 이상 없으면 null.
export function validateEnvelope(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "본문이 JSON 객체가 아님";
  if (!IMPORT_SOURCES.includes(body.source)) return `source는 ${IMPORT_SOURCES.join(" | ")} 중 하나여야 함`;
  if (!isIsoWithOffset(body.sentAt)) return `sentAt 날짜 형식 오류 — ${ISO_HINT}`;
  if (!Array.isArray(body.workouts) || body.workouts.length === 0) return "workouts 배열이 비어 있음";
  if (body.workouts.length > MAX_WORKOUTS) return `workouts 최대 ${MAX_WORKOUTS}건`;
  return null;
}

// 운동 1건의 스키마 오류 메시지(400 대상). 이상 없으면 null. 범위·의미 검사는 planWorkout에서.
export function validateWorkoutSchema(w, i) {
  const at = `workouts[${i}]`;
  if (!w || typeof w !== "object" || Array.isArray(w)) return `${at} 형식 오류 — 객체 필요`;
  if (typeof w.type !== "string" || !w.type.trim() || w.type.length > 100) return `${at}.type 필요(문자열, 100자 이내)`;
  if (!isIsoWithOffset(w.start)) return `${at}.start 날짜 형식 오류 — ${ISO_HINT}. 받은 값: "${String(w.start).slice(0, 40)}"`;
  if (!isIsoWithOffset(w.end)) return `${at}.end 날짜 형식 오류 — ${ISO_HINT}. 받은 값: "${String(w.end).slice(0, 40)}"`;
  if (typeof w.durationMin !== "number" || !Number.isFinite(w.durationMin)) return `${at}.durationMin 필요(숫자, 분)`;
  if (typeof w.kcal !== "number" || !Number.isFinite(w.kcal)) return `${at}.kcal 필요(숫자)`;
  if (w.device !== undefined && typeof w.device !== "string") return `${at}.device는 문자열`;
  return null;
}

// ── 운동 1건 판정 계획 (스키마 통과본 대상 — 규칙 2·3·6·7) ──
// { verdict:"filtered", cause:"unknown", type } — 화이트리스트 밖 유형(요가 등)
// { verdict:"rejected", reason }
// { verdict:"candidate", entry } — dedup(규칙 4·5)은 저장소 계층(KV)에서 판정
export function planWorkout(w, { cutoverDate }) {
  const cls = classifyType(w.type);
  if (cls.kind === "unknown") return { verdict: "filtered", cause: "unknown", type: w.type };

  const kcal = Math.round(w.kcal);
  if (kcal < KCAL_MIN || kcal > KCAL_MAX) return { verdict: "rejected", reason: `칼로리 범위(${KCAL_MIN}~${KCAL_MAX.toLocaleString()}) 밖` };
  const duration = Math.round(w.durationMin);
  if (duration < DUR_MIN || duration > DUR_MAX) return { verdict: "rejected", reason: `시간 범위(${DUR_MIN}~${DUR_MAX}분) 밖` };

  const startMs = Date.parse(w.start);
  const endMs = Date.parse(w.end);
  if (endMs <= startMs) return { verdict: "rejected", reason: "종료가 시작보다 빠름" };

  // 규칙 7: 기록일 = 시작 시각의 "로컬 날짜" — 오프셋 포함 문자열의 앞자리가 곧 로컬 벽시계
  const date = w.start.slice(0, 10);
  const hour = parseInt(w.start.slice(11, 13), 10);
  if (cutoverDate && date < cutoverDate) return { verdict: "rejected", reason: `컷오버(${cutoverDate}) 이전` };

  // 규칙 4: dedup 키 = 정규화 유형 + 시작 + 종료 (kcal 제외 — 워치가 칼로리를 나중에
  // 고쳐 재전송해도 같은 운동으로 인식되게). 시각은 epoch(ms)로 정규화해 +09:00/Z 표기 차이를 흡수.
  const importKey = `${cls.n}|${startMs}|${endMs}`;

  return {
    verdict: "candidate",
    entry: {
      importKey,
      n: cls.n,
      kcal,
      duration,
      date,          // 귀속일 (YYYY-MM-DD, 시작 시각 로컬)
      hour: Number.isFinite(hour) ? hour : 0,
      ts: startMs,   // 앱 항목의 ts로 사용 — 시작 시각 기반이라 기기 간 결정적
      start: w.start,
      end: w.end,
      ...(w.device ? { device: String(w.device).slice(0, 60) } : {}),
    },
  };
}

/* ── HAE(Health Auto Export) 폴백 파서 ─────────────────────────────
   iOS 단축어에 '운동 찾기' 동작이 없는 기기용 브릿지. HAE 앱의 REST API 자동화가
   { data: { workouts: [...] } } 형태로 POST하는 것을 표준 봉투로 변환해, 이후의
   검문 규칙 8종·insert-only·dedup 키가 네이티브 경로와 완전히 동일하게 적용되게 한다.
   (dedup 키가 유형+시각(epoch) 기반이라 두 경로가 섞여도 같은 운동은 1건만 저장됨)
   형식 근거: github.com/Lybron/health-auto-export/wiki — workouts v1/v2,
   날짜 "yyyy-MM-dd HH:mm:ss Z|±HHmm", duration은 초, 에너지 { qty, units("kcal"|"kJ") }. */
export const HAE_DEVICE = "HAE";
// 귀속일(규칙 7)은 "시작 시각의 로컬 날짜" — HAE가 UTC(Z)로 보내는 경우를 대비해
// 사용자 시간대 벽시계로 재표기한다. 기본 +09:00(KST), env IMPORT_TZ_OFFSET("+09:00")로 변경 가능.
export const HAE_TZ_OFFSET_MIN_DEFAULT = 540;

export function parseTzOffset(s) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -v : v;
}

export function isHaePayload(body) {
  return !!(body && typeof body === "object" && !Array.isArray(body) &&
    body.workouts === undefined &&
    body.data && typeof body.data === "object" && Array.isArray(body.data.workouts));
}

// HAE 날짜 문자열 → 지정 오프셋 벽시계의 ISO 8601. 실패 시 null.
export function haeDateToIso(s, tzOffsetMin = HAE_TZ_OFFSET_MIN_DEFAULT) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(Z|[+-]\d{2}:?\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const tz = m[3] === "Z" ? "Z" : (m[3].includes(":") ? m[3] : m[3].slice(0, 3) + ":" + m[3].slice(3));
  const ms = Date.parse(`${m[1]}T${m[2]}${tz}`);
  if (!Number.isFinite(ms)) return null;
  const local = new Date(ms + tzOffsetMin * 60000);
  const p = (n) => String(n).padStart(2, "0");
  const sign = tzOffsetMin < 0 ? "-" : "+";
  const abs = Math.abs(tzOffsetMin);
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

function haeEnergyKcal(w) {
  const e = w.activeEnergyBurned || w.activeEnergy || w.totalEnergy;
  if (!e || typeof e !== "object" || typeof e.qty !== "number" || !Number.isFinite(e.qty)) return null;
  return String(e.units || "kcal").toLowerCase().includes("kj") ? e.qty / 4.184 : e.qty;
}

// HAE 페이로드 → 표준 workouts 배열. 필수값이 깨진 항목은 dropped로 집계(응답에서 rejected로 보고).
export function convertHae(body, tzOffsetMin = HAE_TZ_OFFSET_MIN_DEFAULT) {
  const workouts = [];
  let dropped = 0;
  for (const w of body.data.workouts) {
    if (!w || typeof w !== "object") { dropped++; continue; }
    const start = haeDateToIso(w.start, tzOffsetMin);
    const end = haeDateToIso(w.end, tzOffsetMin);
    const kcal = haeEnergyKcal(w);
    const name = typeof w.name === "string" ? w.name.trim() : "";
    if (!start || !end || !name || kcal === null) { dropped++; continue; }
    // duration: v2는 초 단위, v1은 필드 없음(벽시계로 유도). 단위가 애매한 값은 벽시계 우선.
    const wallMin = (Date.parse(end) - Date.parse(start)) / 60000;
    let durationMin = wallMin;
    if (typeof w.duration === "number" && Number.isFinite(w.duration) && w.duration > 0) {
      const asMin = w.duration / 60;
      if (asMin >= wallMin * 0.25 && asMin <= wallMin + 1) durationMin = asMin;
    }
    workouts.push({ type: name, start, end, durationMin, kcal, device: HAE_DEVICE });
  }
  return { workouts, dropped };
}

// ── 응답 message(한국어 한 줄 — 단축어가 알림으로 그대로 표시) ──
export function buildMessage({ accepted, ignored, unknown, rejected, firstRejectReason }) {
  const parts = [`${accepted}건 추가`];
  if (ignored > 0) parts.push(`중복 ${ignored} 무시`);
  if (unknown > 0) parts.push(`대상 외 ${unknown} 제외`);
  if (rejected > 0) parts.push(`거부 ${rejected}(${firstRejectReason || "검증 실패"})`);
  return parts.join(" · ");
}
