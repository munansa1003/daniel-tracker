// R4 회귀 스냅샷용 합성 297일 데이터 생성기 (결정적 — 시드 LCG, Date.now/Math.random 미사용).
// dayType이 전혀 없는 과거 데이터: 휴식일 프리셋 도입 전후로 모든 통계·판정·내보내기가
// 완전히 동일해야 함을 증명하는 데 쓴다. 시드·규칙을 바꾸면 스냅샷 해시가 무효가 된다 — 변경 금지.
export const SYNTH_TODAY = "2026-08-01";
export const SYNTH_DAYS_N = 297;

function lcg(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
}

const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

const FOODS = [
  ["오트밀", 322, 12, 55, 6], ["닭가슴살 샐러드", 420, 40, 25, 14], ["현미밥", 310, 5, 68, 2],
  ["연어 스테이크", 466, 34, 40, 18], ["프로틴 쉐이크", 155, 24, 8, 3], ["소고기 등심 100g", 200, 20, 0, 13],
  ["돈까스 김밥", 290, 10, 45, 8], ["삼겹살 구이", 520, 28, 5, 44], ["그릭 요거트", 130, 12, 10, 5],
];
const EXS = [["러닝", 8], ["웨이트 상체", 5], ["웨이트 하체", 6], ["자전거", 7], ["플랭크", 4]];

// 297일: 약 88%는 기록일, 나머지 공백. 주중은 운동 확률 높음. 2026-03월은 유지 모드 구간.
export function buildSynth297() {
  const rnd = lcg(20260801);
  const days = {};
  const end = new Date(SYNTH_TODAY + "T12:00:00");
  for (let i = SYNTH_DAYS_N - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const ds = fmt(d);
    if (rnd() < 0.12) continue; // 미기록일
    const mode = ds.startsWith("2026-03") ? "maintain" : "cut";
    const mealN = 2 + Math.floor(rnd() * 3);
    const meals = [];
    for (let m = 0; m < mealN; m++) {
      const f = FOODS[Math.floor(rnd() * FOODS.length)];
      const serving = rnd() < 0.3 ? 1.5 : 1;
      meals.push({ n: f[0], k: f[1], p: f[2], c: f[3], f: f[4], serving, hour: 7 + Math.floor(rnd() * 15), ts: 0 });
    }
    const exercises = [];
    const dow = d.getDay();
    const exProb = dow === 0 || dow === 6 ? 0.35 : 0.65;
    if (rnd() < exProb) {
      const e = EXS[Math.floor(rnd() * EXS.length)];
      const duration = 20 + Math.floor(rnd() * 50);
      exercises.push({ n: e[0], m: e[1], duration, kcal: Math.round((e[1] * 75 * duration) / 60), hour: dow % 2 ? 7 : 19, ts: 0 });
    }
    days[ds] = { mode, meals, exercises };
  }
  return days;
}

export function buildSynthBodyLog() {
  const rnd = lcg(1957);
  const log = [];
  const end = new Date(SYNTH_TODAY + "T12:00:00");
  for (let i = SYNTH_DAYS_N - 1; i >= 0; i -= 7) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const t = (SYNTH_DAYS_N - i) / SYNTH_DAYS_N;
    log.push({
      date: fmt(d),
      weight: Math.round((79.5 - 4.5 * t + (rnd() - 0.5) * 0.6) * 10) / 10,
      muscle: Math.round((36.0 + 0.6 * t + (rnd() - 0.5) * 0.3) * 10) / 10,
      fatPct: Math.round((24.5 - 4.0 * t + (rnd() - 0.5) * 0.5) * 10) / 10,
      score: 80 + Math.floor(rnd() * 10),
    });
  }
  return log;
}

// 감사 시나리오 공통 상태 — 적응형 보정 이력 포함(그날 유효 보정 경로까지 diff 대상에 포함)
export function buildSynthState() {
  return {
    allDays: buildSynth297(),
    bodyLog: buildSynthBodyLog(),
    goals: {},
    user: { height: 175, age: 42 },
    mode: "cut",
    targets: { p: 165, c: 118, f: 45, k: 1536, weight: 75 },
    targetsByMode: {
      cut: { p: 165, c: 118, f: 45, k: 1536, weight: 75 },
      maintain: { p: 165, c: 170, f: 45, k: 1746, weight: 75 },
    },
    appAdjust: -55,
    tdeeHistory: [{ from: "2026-06-01", adjust: -55 }],
    healthEvents: [{ id: 1, type: "illness", label: "장염", start: "2026-05-10", end: "2026-05-12", exclude: true }],
  };
}
