// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatsTab } from "../components/StatsTab.jsx";

// App.jsx에서 분리된 StatsTab — import 배선/크래시 회귀 방어(흰 화면 방지).
const noop = () => {};
const days = {};
for (let i = 1; i <= 14; i++) {
  const d = `2026-07-${String(i).padStart(2, "0")}`;
  days[d] = { meals: [{ n: "밥", p: 20, c: 60, f: 5, k: 400, serving: 1, hour: 12 }], exercises: [{ n: "조깅", kcal: 300 }], mode: "cut" };
}
const props = {
  bodyLog: [
    { date: "2026-07-01", weight: 78.0, muscle: 39.1, fatPct: 21.6, score: 86 },
    { date: "2026-07-10", weight: 77.6, muscle: 39.3, fatPct: 21.2, score: 89 },
  ],
  allDays: days,
  goals: { mode: "cut" }, onSaveGoals: noop,
  appTargets: { p: 170, c: 120, f: 46, k: 1570, weight: 77 },
  targetsByMode: { cut: { p: 170, c: 120, f: 46, k: 1570, weight: 77 }, maintain: { p: 170, c: 160, f: 60, k: 2000, weight: 77 } },
  mode: "cut", appAdjust: 0, tdeeHistory: [],
};

describe("StatsTab 렌더 스모크", () => {
  it("주간 성적표 탭이 크래시 없이 렌더", () => {
    const h = renderToStaticMarkup(<StatsTab {...props} />);
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(100);
  });
  it("데이터 없어도 렌더", () => {
    const h = renderToStaticMarkup(<StatsTab {...props} allDays={{}} bodyLog={[]} />);
    expect(typeof h).toBe("string");
  });
});
