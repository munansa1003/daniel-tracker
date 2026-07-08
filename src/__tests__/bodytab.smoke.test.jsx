// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BodyTab } from "../components/BodyTab.jsx";

// App.jsx에서 분리된 BodyTab — import 배선/크래시 회귀 방어(흰 화면 방지).
const noop = () => {};
const props = {
  bodyLog: [
    { date: "2026-07-01", weight: 78.0, muscle: 39.1, fatPct: 21.6, score: 86 },
    { date: "2026-07-05", weight: 77.9, muscle: 39.2, fatPct: 21.5, score: 88 },
  ],
  addBody: noop, date: "2026-07-05", onEditBody: noop, onDeleteBody: noop,
  user: { height: 175, age: 35 },
  goals: { mode: "cut" }, onSaveGoals: noop,
  allDays: { "2026-07-05": { meals: [], exercises: [] } },
};

describe("BodyTab 렌더 스모크", () => {
  it("최신 기록 카드가 크래시 없이 렌더", () => {
    const h = renderToStaticMarkup(<BodyTab {...props} />);
    expect(h).toContain("BMI");
    expect(h).toContain("2026-07-05");
  });
  it("기록 없을 때도 렌더", () => {
    const h = renderToStaticMarkup(<BodyTab {...props} bodyLog={[]} allDays={{}} />);
    expect(typeof h).toBe("string");
  });
});
