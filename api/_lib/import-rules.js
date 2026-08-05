// api/_lib/import-rules.js — 애플워치 운동 자동 수신(검문소) 규칙 단일 출처.
//
// 이 파일이 요청 스키마·유산소 화이트리스트·값 범위·컷오버·날짜 귀속의 유일한 정의다.
// docs/shortcut-recipe.md(단축어 조립 가이드)는 이 정의를 그대로 옮겨 적은 문서이며,
// 서로 어긋나면 계약 테스트(health-import.test.js §7)가 잡는다.
// 순수 모듈 — KV/네트워크 접근 없음. HAE 등 다른 브릿지로 갈아탈 때는 이 모듈을
// 재사용하고 페이로드 → {type,start,end,durationMin,kcal} 변환 파서만 추가하면 된다.

export const IMPORT_SOURCES = ["workout-end", "evening-backup", "manual-tap"];
export const MAX_BODY_BYTES = 100 * 1024; // 정상 페이로드는 수 KB
export const MAX_WORKOUTS = 100;
export const KCAL_MIN = 1;
export const KCAL_MAX = 2000;   // kJ 오염(×4.184)·이상치 차단
export const DUR_MIN = 1;
export const DUR_MAX = 600;

// ── 유산소 화이트리스트 (한국어/영어 병기 — 기기 언어에 따라 어느 쪽이든 온다) ──
// n = 저장용 대표 이름. 통계 분류(analysisExport의 exCategory)가 이름 키워드 기반이므로
// 대표 이름은 반드시 유산소 키워드(러닝·사이클·걷·축구·계단·하이킹·수영)에 걸리는 것으로 유지한다.
export const AEROBIC_GROUPS = [
  { n: "러닝", aliases: ["달리기", "실외 달리기", "실내 달리기", "러닝", "런닝", "트레드밀 달리기", "running", "outdoor run", "indoor run", "run"] },
  { n: "사이클링", aliases: ["사이클링", "실외 사이클링", "실내 사이클링", "자전거", "자전거 타기", "cycling", "outdoor cycling", "indoor cycling", "cycle", "bike", "biking"] },
  { n: "걷기", aliases: ["걷기", "실외 걷기", "실내 걷기", "walking", "outdoor walk", "indoor walk", "walk"] },
  { n: "축구", aliases: ["축구", "soccer", "football"] },
  { n: "계단 오르기", aliases: ["계단 오르기", "계단오르기", "stair climbing", "stair-climbing", "stairs", "stair stepper"] },
  { n: "하이킹", aliases: ["하이킹", "등산", "hiking", "hike"] },
  { n: "수영", aliases: ["수영", "실내 수영", "야외 수영", "swimming", "pool swim", "open water swim", "swim"] },
];

// 근력 계열 — 1단계에서는 명시적으로 제외(filtered). 워치가 부위를 구분하지 못해
// (전부 "기능성 근력 훈련" 한 덩어리) 자동 저장하면 상/하체 통계가 무너진다. 수동 유지.
export const STRENGTH_ALIASES = [
  "기능성 근력 훈련", "전통적 근력 훈련", "근력 훈련", "웨이트 트레이닝",
  "functional strength training", "traditional strength training", "strength training", "weight training",
];

export function normalizeType(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const ALIAS_TO_NAME = new Map();
for (const g of AEROBIC_GROUPS) for (const a of g.aliases) ALIAS_TO_NAME.set(normalizeType(a), g.n);
const STRENGTH_SET = new Set(STRENGTH_ALIASES.map(normalizeType));

// 유형 분류: { kind:"aerobic", n } | { kind:"strength" } | { kind:"unknown" }
export function classifyType(rawType) {
  const t = normalizeType(rawType);
  if (STRENGTH_SET.has(t)) return { kind: "strength" };
  const n = ALIAS_TO_NAME.get(t);
  if (n) return { kind: "aerobic", n };
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
// { verdict:"filtered", cause:"strength"|"unknown", type }
// { verdict:"rejected", reason }
// { verdict:"candidate", entry } — dedup(규칙 4·5)은 저장소 계층(KV)에서 판정
export function planWorkout(w, { cutoverDate }) {
  const cls = classifyType(w.type);
  if (cls.kind === "strength") return { verdict: "filtered", cause: "strength", type: w.type };
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

// ── 응답 message(한국어 한 줄 — 단축어가 알림으로 그대로 표시) ──
export function buildMessage({ accepted, ignored, strength, unknown, rejected, firstRejectReason }) {
  const parts = [`${accepted}건 추가`];
  if (ignored > 0) parts.push(`중복 ${ignored} 무시`);
  if (strength > 0) parts.push(`근력 ${strength} 제외`);
  if (unknown > 0) parts.push(`대상 외 ${unknown} 제외`);
  if (rejected > 0) parts.push(`거부 ${rejected}(${firstRejectReason || "검증 실패"})`);
  return parts.join(" · ");
}
