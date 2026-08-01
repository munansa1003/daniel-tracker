// 휴식일 프리셋(dayType:"rest") 통합 시나리오 — 판정·차트·내보내기가 같은 규칙을 쓰는지.
// 규칙: 도장 + 감량 모드 + 운동 ≤300kcal → 목표 고정 1,675(되먹기·적응형 보정 무관).
//       운동 300kcal 초과 기록 시 훈련일 공식(기초 + 운동×50%)으로 자동 복귀(도장·태그는 유지).
//       도장 없는 날은 기존 판정 그대로(과거 기록 무변경 보장).
import { describe, it, expect } from "vitest";
import { buildAnalysisPackage } from "../analysisExport.js";
import { buildCalorieSeries } from "../components/CalorieBandChart.jsx";
import { restTargets, REST_K } from "../utils.js";

const TODAY = "2026-07-18";
const targetsByMode = {
  cut: { k: 1536, p: 165, c: 118, f: 45 },
  maintain: { k: 1757, p: 165, c: 170, f: 45 },
  rest: restTargets(75), // { p:165, c:153, f:45, k:1675 }
};
const meal1650 = [{ n: "회식", k: 1650, p: 80, c: 150, f: 60, serving: 1 }];
const meal1700 = [{ n: "회식+", k: 1700, p: 80, c: 155, f: 62, serving: 1 }];

const mkState = (allDays, extra = {}) => ({
  allDays, bodyLog: [], goals: {}, user: { height: 175, age: 42 },
  mode: "cut", targets: targetsByMode.cut, targetsByMode,
  appAdjust: 0, tdeeHistory: [], healthEvents: [], ...extra,
});

describe("휴식일 프리셋 — 차트 시리즈(buildCalorieSeries) 판정", () => {
  it("같은 1,650kcal이라도 도장이 판정을 가른다: 휴식일 ✓ / 훈련일 ✗", () => {
    const days = {
      "2026-07-15": { mode: "cut", dayType: "rest", meals: meal1650, exercises: [] },
      "2026-07-16": { mode: "cut", meals: meal1650, exercises: [] },
    };
    const s = buildCalorieSeries(days, targetsByMode, "cut", "all", TODAY);
    expect(s.points.map((p) => p.ok)).toEqual([true, false]); // 1650 ≤ 1675 / 1650 > 1536
  });
  it("운동 300 초과 자동 복귀: 도장이 있어도 훈련일 공식(1536+운동×50%)으로 판정", () => {
    const days = {
      "2026-07-15": { mode: "cut", dayType: "rest", meals: meal1700, exercises: [{ n: "러닝", kcal: 200 }] }, // rest 유지: 1700 > 1675 → ✗
      "2026-07-16": { mode: "cut", dayType: "rest", meals: meal1700, exercises: [{ n: "러닝", kcal: 400 }] }, // 복귀: 1536+200=1736 ≥ 1700 → ✓
    };
    const s = buildCalorieSeries(days, targetsByMode, "cut", "all", TODAY);
    expect(s.points.map((p) => p.ok)).toEqual([false, true]);
  });
});

describe("휴식일 프리셋 — 분석 내보내기(buildAnalysisPackage) 태그·유효목표", () => {
  const range = { start: "2026-07-14", end: TODAY };
  it("규칙 설명 + 휴식일 라인은 유효목표 1,675에 😴 태그", () => {
    const days = { "2026-07-15": { mode: "cut", dayType: "rest", meals: meal1650, exercises: [] } };
    const pkg = buildAnalysisPackage(mkState(days), range, TODAY);
    expect(pkg).toContain("휴식일(😴 표시): 목표 1,675kcal 고정");
    expect(pkg).toContain(" 1675  ✓ 😴"); // 1650 ≤ 1675
  });
  it("적응형 보정이 걸려 있어도 휴식일 유효목표는 1,675 그대로(고정 프리셋)", () => {
    const days = { "2026-07-15": { mode: "cut", dayType: "rest", meals: meal1650, exercises: [] } };
    const pkg = buildAnalysisPackage(
      mkState(days, { appAdjust: -55, tdeeHistory: [{ from: "2026-06-01", adjust: -55 }] }), range, TODAY);
    expect(pkg).toContain(` ${REST_K}  ✓ 😴`);
  });
  it("운동 300 초과 복귀: 훈련일 유효목표(1536+되먹기)로 판정하되 😴 태그는 유지", () => {
    const days = { "2026-07-15": { mode: "cut", dayType: "rest", meals: meal1700, exercises: [{ n: "러닝", kcal: 400 }] } };
    const pkg = buildAnalysisPackage(mkState(days), range, TODAY);
    expect(pkg).toContain(" 1736  ✓ 😴"); // 1536 + round(400×0.5)
  });
  it("무변경 보장: 도장 없는 같은 날은 기존 훈련일 기준 그대로 ✗", () => {
    const days = { "2026-07-15": { mode: "cut", meals: meal1650, exercises: [] } };
    const pkg = buildAnalysisPackage(mkState(days), range, TODAY);
    expect(pkg).toContain("✗(+114)"); // 1650 − 1536
    // 규칙 설명에는 😴가 항상 있으므로, 일별 라인 태그(판정 뒤 😴)만 없는지 본다
    expect(pkg).not.toContain("✗(+114) 😴");
    expect(pkg).not.toContain("✓ 😴");
  });
});
