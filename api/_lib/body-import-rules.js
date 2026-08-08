// api/_lib/body-import-rules.js — 인바디 체성분 자동 수신(검문소) 규칙 단일 출처.
//
// 운동 검문소(import-rules.js)의 자매 모듈. 순수 모듈 — KV/네트워크 접근 없음.
// 날짜 파서(haeDateToIso)·시간대 보정은 import-rules.js의 것을 그대로 재사용한다
// ("다른 브릿지는 파서만 추가" 확장 방침). 운동 규칙은 여기서 일절 건드리지 않는다.
//
// 입력: HAE '건강 지표 내보내기' JSON — { data: { metrics: [ { name, units, data: [ { date, qty, source? } ] } ] } }
// 출력: 날짜별 "완성 대기 초안" 후보 entries — 앱 병합 계층(src/bodyDraft.js)이 착지시킨다.
//
// 검문 규칙 B1~B9 (docs/prompts/body-import-api-prompt.md §1.2 — 전부 하드 요구):
//  B1 아침 창(00:00~12:00 로컬) 밖 샘플은 초안 후보에서 제외 + 로그
//  B2 day-keyed 최신 갱신 — 같은 날 필드별 최신 타임스탬프 채택(운동의 insert-only와 다른 도메인 규칙).
//     사서함 field는 `${date}|${sampleTs}` "불변" 키다: 같은 페이로드 재전송은 같은 키(seen 멱등),
//     새 측정은 새 키. 값 덮어쓰기 방식(field=date)은 pull~ack 사이 도착한 최신 샘플을
//     HDEL이 지우는 영구 유실 창이 있어 금지 — 갱신은 병합 계층에서 max(sampleTs)로 수행한다.
//  B3 다중 샘플 → 최신 채택 + 로그에 오늘 샘플 수(개별 vs 집계 판별 창구)
//  B4 체지방률 0<qty≤1 → "소수형 의심" 거부 + 로그 (유효 범위 3~60)
//  B5 단위 방어 — weight/lbm은 kg 수용, lb는 ×0.4536 변환, 그 외 거부. weight 40~150, lbm 30~80
//  B6 소스 필터 — 샘플에 소스 정보가 있으면 InBody만 수용, 없으면 관찰 로그만
//  B7 컷오버 — env IMPORT_BODY_CUTOVER_DATE 이전 측정 거부
//  B8 부분 수신 — weight만 와도 초안 성립(필드별 독립)
//  B9 로그 위생 — 본문 전문 금지, 요약만
import { haeDateToIso } from "./import-rules.js";

export const WEIGHT_MIN = 40;
export const WEIGHT_MAX = 150;
export const LBM_MIN = 30;
export const LBM_MAX = 80;
export const FAT_MIN = 3;
export const FAT_MAX = 60;
// 인바디 클라우드 직수신(inbody-cloud.js)이 나르는 2종 — HealthKit에 없는 값이라 HAE로는 안 온다
export const MUSCLE_MIN = 10;   // 골격근량(SMM) kg
export const MUSCLE_MAX = 60;
export const SCORE_MIN = 20;    // 인바디 점수(FS) — 실측 82, 근육형은 100 초과 가능
export const SCORE_MAX = 120;
export const LB_TO_KG = 0.4536;
// B1 완화 — "하루 종일 최신 채택"(2026-08-08 사용자 결정). 원래 아침 창(00~12시)은 저녁
// 비공복 측정이 아침 값을 덮는 사고를 막으려던 것이나, 실사용에서 "몇 번을 재든 마지막
// 측정이 자동 반영"이 필요해 시각 상한을 해제했다. 시각 파싱 실패(NaN)만 방어한다.
// 되돌리려면 이 값을 12로 낮추면 오전 측정만 채택된다. 값 자체 갱신·잠금은 여전히
// 병합 계층(bodyDraft.js)이 "auto 확정분은 더 최신 sampleTs로 갱신, 사용자 편집분은 잠금"으로 처리.
export const MORNING_END_HOUR = 24;

const r1 = (v) => Math.round(v * 10) / 10;
const norm = (s) => String(s || "").trim().toLowerCase();

// ── 지표 이름 매칭 (관대한 키워드 파서 — §1.1) ──
// 검사 순서가 정확성의 핵심: 제외 → score → muscle → lean → fat → weight.
//  · "체질량지수"(BMI)는 "체질량"(lean 키워드)을 포함 → "지수"/"index"/"bmi" 제외를 먼저
//  · "제지방체질량"(lean)은 "체지방"(fat 키워드)을 포함 → lean을 fat보다 먼저
//  · "skeletal_muscle_mass"(클라우드 직수신)는 muscle을 lean보다 먼저 검사
// 정확한 실전 필드명은 첫 실전송에서 확정 — 미매칭 name은 로그에 남겨 별칭 확장 재료로 쓴다.
const EXCLUDED_KEYWORDS = ["bmi", "지수", "index"];
const SCORE_KEYWORDS = ["score", "점수"];
const MUSCLE_KEYWORDS = ["skeletal", "muscle", "골격근"];
const LEAN_KEYWORDS = ["lean", "제지방", "체질량"];
const FAT_KEYWORDS = ["fat", "체지방"];
const WEIGHT_KEYWORDS = ["weight", "체중"];

// → "weight" | "fatPct" | "lbm" | "muscle" | "score" | null(대상 외 — 이름을 로그에 기록)
export function classifyBodyMetric(rawName) {
  const n = norm(rawName);
  if (!n) return null;
  for (const kw of EXCLUDED_KEYWORDS) if (n.includes(kw)) return null;
  for (const kw of SCORE_KEYWORDS) if (n.includes(kw)) return "score";
  for (const kw of MUSCLE_KEYWORDS) if (n.includes(kw)) return "muscle";
  for (const kw of LEAN_KEYWORDS) if (n.includes(kw)) return "lbm";
  for (const kw of FAT_KEYWORDS) if (n.includes(kw)) return "fatPct";
  for (const kw of WEIGHT_KEYWORDS) if (n.includes(kw)) return "weight";
  return null;
}

// HAE '건강 지표 내보내기' 페이로드인가. 운동 폴백(isHaePayload)은 data.workouts를 보므로
// 서로 배타 판별이 아니어도 됨 — 이 엔드포인트는 metrics만 읽고 workouts는 무시한다.
export function isHaeMetricsPayload(body) {
  return !!(body && typeof body === "object" && !Array.isArray(body) &&
    body.data && typeof body.data === "object" && Array.isArray(body.data.metrics));
}

// kg/lb 단위 정규화(B5). 수용 불가 단위는 null.
function toKg(qty, units) {
  const u = norm(units);
  if (u === "kg" || u === "kgs" || u === "kilogram" || u === "kilograms") return qty;
  if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") return qty * LB_TO_KG;
  return null;
}

/* 페이로드 → 판정 계획.
   반환: {
     entries: [{ key:"YYYY-MM-DD|sampleTs", date, sampleTs, weight?, fatPct?, lbm? }],  // 날짜별 1건
     summary: { samplesToday, latestDate, matchedNames, unmatchedNames, sources,
                rejected, excluded, sourceFiltered, firstRejectReason, fatPctForm }
   }
   entries의 각 필드는 그 날짜의 "아침 창 내 최신 샘플" 값(B2·B3), sampleTs는 필드 최신치의 최대값.
   같은 페이로드가 다시 오면 같은 entries가 나온다(결정적) — seen 멱등의 전제. */
export function planBodyImport(body, { cutoverDate, tzOffsetMin }) {
  const matchedNames = [];
  const unmatchedNames = [];
  const sources = [];
  // 날짜 → 지표종류 → 파싱 성공 샘플 수 (창밖 포함 — 관측용 §1.4-⑶).
  // "오늘 샘플 수"는 지표별 최대치로 보고한다: 3지표 1회 측정=1, 재측정 3회=3 — 개별/집계 판별이 직관적.
  const samplesByDate = {};
  const fields = {};                  // 날짜 → { weight:{v,ts}, fatPct:{v,ts}, lbm:{v,ts} }
  let rejected = 0, excluded = 0, sourceFiltered = 0;
  let firstRejectReason = "";
  let fatPctForm = null;              // 체지방률 수신값 원형 관측(§1.4-⑵) — B4 발동 여부 판별 창구
  const reject = (reason) => { rejected++; if (!firstRejectReason) firstRejectReason = reason; };
  const pushCap = (arr, v, cap = 10) => { if (v && !arr.includes(v) && arr.length < cap) arr.push(v); };

  for (const m of body.data.metrics) {
    if (!m || typeof m !== "object") { reject("지표 형식 오류"); continue; }
    const kind = classifyBodyMetric(m.name);
    if (kind === null) { pushCap(unmatchedNames, norm(m.name).slice(0, 40)); continue; }
    pushCap(matchedNames, String(m.name).slice(0, 40));
    if (!Array.isArray(m.data)) { reject(`${kind} 샘플 배열 없음`); continue; }

    for (const s of m.data) {
      if (!s || typeof s !== "object") { reject("샘플 형식 오류"); continue; }
      const iso = haeDateToIso(s.date, tzOffsetMin);
      const qty = s.qty;
      if (!iso || typeof qty !== "number" || !Number.isFinite(qty)) { reject("샘플 날짜/값 형식 오류"); continue; }
      const date = iso.slice(0, 10);
      const hour = parseInt(iso.slice(11, 13), 10);
      const ts = Date.parse(iso);
      const byKind = samplesByDate[date] || (samplesByDate[date] = {});
      byKind[kind] = (byKind[kind] || 0) + 1;

      // B6: 소스 관찰 + (있을 때만) InBody 필터. 현재 쓰기 소스는 InBody뿐 — 미래 오염 대비.
      if (typeof s.source === "string" && s.source) {
        pushCap(sources, s.source.slice(0, 40), 5);
        if (!/inbody/i.test(s.source)) { sourceFiltered++; continue; }
      }

      if (kind === "fatPct") fatPctForm = String(qty).slice(0, 12);

      // 값·단위 검문 (B4·B5)
      let value;
      if (kind === "fatPct") {
        if (qty > 0 && qty <= 1) { reject("소수형 의심(0~1) 체지방률"); continue; } // B4
        if (qty < FAT_MIN || qty > FAT_MAX) { reject(`체지방률 범위(${FAT_MIN}~${FAT_MAX}) 밖`); continue; }
        value = r1(qty);
      } else if (kind === "score") {
        // 인바디 점수 — 무단위 정수. 범위만 방어(FS 실측 82, 근육형 100 초과 허용)
        if (qty < SCORE_MIN || qty > SCORE_MAX) { reject(`점수 범위(${SCORE_MIN}~${SCORE_MAX}) 밖`); continue; }
        value = Math.round(qty);
      } else {
        const kg = toKg(qty, m.units);
        if (kg === null) { reject(`${kind} 단위(${String(m.units).slice(0, 10) || "없음"}) 수용 불가`); continue; }
        const [lo, hi] = kind === "weight" ? [WEIGHT_MIN, WEIGHT_MAX]
          : kind === "muscle" ? [MUSCLE_MIN, MUSCLE_MAX] : [LBM_MIN, LBM_MAX];
        if (kg < lo || kg > hi) { reject(`${kind} 범위(${lo}~${hi}kg) 밖`); continue; }
        value = r1(kg);
      }

      // B1: 아침 창 가드 — 저녁 비공복 측정이 아침 값을 덮는 사고 방지 (제외는 거부와 구분해 집계)
      if (!Number.isFinite(hour) || hour >= MORNING_END_HOUR) { excluded++; continue; }

      // B7: 컷오버
      if (cutoverDate && date < cutoverDate) { reject(`컷오버(${cutoverDate}) 이전`); continue; }

      // B2·B3: 날짜×필드별 최신 타임스탬프 채택
      const f = fields[date] || (fields[date] = {});
      if (!f[kind] || ts >= f[kind].ts) f[kind] = { v: value, ts };
    }
  }

  // 날짜별 초안 후보 1건 (B8: 존재하는 필드만 — 부분 수신 허용)
  const entries = Object.keys(fields).sort().map((date) => {
    const f = fields[date];
    const sampleTs = Math.max(...Object.values(f).map((x) => x.ts));
    const entry = { key: `${date}|${sampleTs}`, date, sampleTs };
    if (f.weight) entry.weight = f.weight.v;
    if (f.fatPct) entry.fatPct = f.fatPct.v;
    if (f.lbm) entry.lbm = f.lbm.v;
    if (f.muscle) entry.muscle = f.muscle.v; // 클라우드 직수신 전용 — HAE 경로에는 없음
    if (f.score) entry.score = f.score.v;
    return entry;
  });

  const dates = Object.keys(samplesByDate).sort();
  const latestDate = dates[dates.length - 1] || null;
  return {
    entries,
    summary: {
      samplesToday: latestDate ? Math.max(...Object.values(samplesByDate[latestDate])) : 0,
      latestDate,
      matchedNames, unmatchedNames, sources,
      rejected, excluded, sourceFiltered, firstRejectReason,
      ...(fatPctForm !== null ? { fatPctForm } : {}),
    },
  };
}

// 응답 한 줄 메시지 (단축어 알림에 그대로 표시 — 운동 buildMessage와 같은 철학)
export function buildBodyMessage({ accepted, ignored, rejected, excluded, firstRejectReason }) {
  const parts = [accepted > 0 ? `체성분 초안 ${accepted}건 접수` : "새 체성분 없음"];
  if (ignored > 0) parts.push(`중복 ${ignored} 무시`);
  if (excluded > 0) parts.push(`아침 창 밖 ${excluded} 제외`);
  if (rejected > 0) parts.push(`거부 ${rejected}(${firstRejectReason || "검증 실패"})`);
  return parts.join(" · ");
}
