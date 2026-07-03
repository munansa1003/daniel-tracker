// 적응형 유지칼로리 — 실측 데이터로 실제 소모(TDEE)를 역산한다. (firebase 의존 없는 순수 모듈)
// 에너지 밸런스: TDEE = 일평균 섭취 − (추세체중 변화 × 7700 ÷ 기간).
// 추세체중은 회귀 기울기로(엔드포인트 노이즈 완화). 결과의 measuredMaint(비운동 유지)로
// calcTargets(...,adjust)의 보정치(delta = measuredMaint − BMR×1.05)를 만든다.
import { aggregateDay } from "./utils.js";

const KCAL_PER_KG = 7700; // 체중 1kg ≈ 7700kcal(지방 환산 근사)
const CLAMP = 300;        // 보정치 안전 클램프(±300kcal) — 불량 데이터 폭주 방지

const toDate = (ds) => new Date(ds + "T12:00:00");
export function shiftDays(ds, n) {
  const d = toDate(ds); d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const dayIndex = (ds, start) => Math.round((toDate(ds) - toDate(start)) / 86400000);

// 최소제곱 회귀 기울기 (pts: [{x, w}]) — 일당 체중 변화(kg/day)
function linRegSlope(pts) {
  const n = pts.length;
  if (n < 2) return 0;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const mw = pts.reduce((s, p) => s + p.w, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.x - mx) * (p.w - mw); den += (p.x - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

// bmr: 현재 체중 기준 BMR(공식 비운동 유지 = bmr×1.05). windowDays 기본 28.
export function estimateTDEE(bodyLog, allDays, todayStr, bmr, windowDays = 28) {
  const start = shiftDays(todayStr, -windowDays);
  let sumK = 0, sumEx = 0, loggedDays = 0;
  for (const ds in (allDays || {})) {
    if (ds >= start && ds < todayStr) {
      const a = aggregateDay(allDays[ds]);
      if (a.k > 0) { sumK += a.k; sumEx += a.ex; loggedDays++; }
    }
  }
  const weighs = (bodyLog || [])
    .filter((b) => b && b.date >= start && b.date < todayStr && b.weight > 0)
    .map((b) => ({ x: dayIndex(b.date, start), w: b.weight }))
    .sort((a, b) => a.x - b.x);

  const base = { windowDays, loggedDays, weighIns: weighs.length, valid: false, confident: false };
  // 게이트: 기록·체중 측정이 최소 기준 미만이면 무효(공식 폴백)
  if (loggedDays < Math.ceil(windowDays * 0.6) || weighs.length < 4) return base;

  const avgIntake = sumK / loggedDays;
  const avgExercise = sumEx / loggedDays;
  const slope = linRegSlope(weighs);         // kg/day
  const deltaWeight = slope * windowDays;     // 기간 총 변화(kg)
  const measuredTDEE = avgIntake - (deltaWeight * KCAL_PER_KG / windowDays); // 총 일일 소모
  const measuredMaint = measuredTDEE - avgExercise;                          // 비운동 유지
  const formulaMaint = bmr * 1.05;
  let delta = Math.round(measuredMaint - formulaMaint);
  delta = Math.max(-CLAMP, Math.min(CLAMP, delta));
  const confident = loggedDays >= Math.ceil(windowDays * 0.75) && weighs.length >= 8;

  return {
    ...base, valid: true, confident,
    avgIntake: Math.round(avgIntake), avgExercise: Math.round(avgExercise),
    deltaWeight: Math.round(deltaWeight * 10) / 10,
    measuredTDEE: Math.round(measuredTDEE),
    measuredMaint: Math.round(measuredMaint),
    formulaMaint: Math.round(formulaMaint),
    delta,
  };
}
