// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeExport } from "../components/ClaudeExport.jsx";

// 데이터 탭에 들어가는 클로드 내보내기 행 — import 배선/크래시 회귀 방어.
const state = {
  allDays: { "2026-07-17": { mode: "cut", meals: [{ n: "밥", k: 500, p: 30, c: 60, f: 10, serving: 1 }], exercises: [] } },
  bodyLog: [{ date: "2026-07-17", weight: 77.5 }],
  goals: {}, user: { height: 175, age: 42 },
  mode: "cut", targets: { k: 1570, p: 170, c: 119, f: 46 },
  targetsByMode: { cut: { k: 1570, p: 170, c: 119, f: 46 }, maintain: { k: 2000, p: 170, c: 160, f: 60 } },
  appAdjust: 0, tdeeHistory: [], healthEvents: [],
};

describe("ClaudeExport 렌더 스모크", () => {
  it("접힌 행이 크래시 없이 렌더", () => {
    const h = renderToStaticMarkup(<ClaudeExport state={state} todayStr="2026-07-18" />);
    expect(h).toContain("클로드 분석용 내보내기");
    expect(h).toContain("붙여넣으면 끝");
  });
});
