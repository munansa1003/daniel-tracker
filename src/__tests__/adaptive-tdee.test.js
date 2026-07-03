import { describe, it, expect } from "vitest";
import { estimateTDEE, shiftDays } from "../adaptiveTDEE.js";

const TODAY = "2026-07-29";
const BMR = 1661.75; // 77.3kg/175/42 → 공식 비운동 유지 = ×1.05 = 1744.84

// 28일 창(07-01~07-28). 25일 기록: 일평균 섭취 1760·운동 400. 체중 선형 감소 4주간 −1.2kg.
function fixture() {
  const allDays = {};
  for (let i = 0; i < 25; i++) {
    const ds = shiftDays("2026-07-01", i);
    allDays[ds] = { meals: [{ k: 1760, serving: 1, p: 0, c: 0, f: 0 }], exercises: [{ kcal: 400 }] };
  }
  // 완벽 직선 체중(회귀 기울기 = −1.2/28) → deltaWeight = −1.2 정확
  const slope = -1.2 / 28;
  // 정확한 직선(반올림 없음) → 회귀 기울기가 정확히 slope → deltaWeight = −1.2 정확
  const bodyLog = [0, 4, 8, 12, 16, 20, 24, 27].map((x) => ({
    date: shiftDays("2026-07-01", x), weight: 77.9 + slope * x,
  }));
  return { allDays, bodyLog };
}

describe("estimateTDEE — 실측 유지칼로리 역산", () => {
  it("에너지 밸런스 역산: 섭취1760 − (−1.2×7700÷28) = TDEE 2090 → 비운동 유지 1690 → 보정 −55", () => {
    const { allDays, bodyLog } = fixture();
    const r = estimateTDEE(bodyLog, allDays, TODAY, BMR, 28);
    expect(r.valid).toBe(true);
    expect(r.confident).toBe(true);
    expect(r.avgIntake).toBe(1760);
    expect(r.avgExercise).toBe(400);
    expect(r.deltaWeight).toBeCloseTo(-1.2, 1);
    expect(r.measuredTDEE).toBe(2090);
    expect(r.measuredMaint).toBe(1690);
    expect(r.formulaMaint).toBe(1745); // round(1744.84)
    expect(r.delta).toBe(-55);
    expect(r.loggedDays).toBe(25);
    expect(r.weighIns).toBe(8);
  });

  it("데이터 부족(기록일 < 60%) → valid=false (공식 폴백)", () => {
    const allDays = {};
    for (let i = 0; i < 10; i++) allDays[shiftDays("2026-07-01", i)] = { meals: [{ k: 1700, serving: 1 }], exercises: [] };
    const bodyLog = [0, 10, 20].map((x) => ({ date: shiftDays("2026-07-01", x), weight: 78 - x * 0.03 }));
    expect(estimateTDEE(bodyLog, allDays, TODAY, BMR, 28).valid).toBe(false);
  });

  it("체중 측정 < 4회 → valid=false", () => {
    const { allDays } = fixture();
    const bodyLog = [{ date: "2026-07-05", weight: 77.8 }, { date: "2026-07-20", weight: 77.2 }];
    expect(estimateTDEE(bodyLog, allDays, TODAY, BMR, 28).valid).toBe(false);
  });

  it("체중 급변(비현실) → 보정치 ±300 클램프", () => {
    const allDays = {};
    for (let i = 0; i < 25; i++) allDays[shiftDays("2026-07-01", i)] = { meals: [{ k: 1600, serving: 1 }], exercises: [] };
    // 4주 −5kg(비현실적 급감) → 큰 음의 delta여야 하지만 클램프
    const slope = -5 / 28;
    const bodyLog = [0, 4, 8, 12, 16, 20, 24, 27].map((x) => ({ date: shiftDays("2026-07-01", x), weight: 80 + slope * x }));
    const r = estimateTDEE(bodyLog, allDays, TODAY, BMR, 28);
    expect(r.valid).toBe(true);
    expect(Math.abs(r.delta)).toBeLessThanOrEqual(300);
  });

  it("오늘은 제외(ds < todayStr): 오늘 기록은 역산에 안 들어감", () => {
    const { allDays, bodyLog } = fixture();
    allDays[TODAY] = { meals: [{ k: 9999, serving: 1 }], exercises: [] }; // 오늘 이상치
    const r = estimateTDEE(bodyLog, allDays, TODAY, BMR, 28);
    expect(r.loggedDays).toBe(25); // 오늘 제외 그대로
    expect(r.avgIntake).toBe(1760);
  });
});
