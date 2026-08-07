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

describe("완성 대기 초안 카드 (인바디 자동 수신 — §1.5 UI 요구)", () => {
  const drafts = { "2026-07-06": { weight: 73.6, fatPct: 18.7, lbm: 60.5, sampleTs: 1 } };

  it("미확정 초안 → 자동 수신 배지·프리필 값·확정 안내가 렌더 (선택 날짜와 무관)", () => {
    const h = renderToStaticMarkup(<BodyTab {...props} bodyDrafts={drafts} />);
    expect(h).toContain("자동 수신");
    expect(h).toContain("2026-07-06");
    expect(h).toContain("73.6");
    expect(h).toContain("18.7");
    expect(h).toContain("골격근·점수 입력하면 확정");
  });

  it("확정된 날짜의 잔존 초안(다중기기 유령)은 스윕 전에도 표시하지 않는다(이중 방어)", () => {
    const h = renderToStaticMarkup(<BodyTab {...props} bodyDrafts={{ "2026-07-05": { weight: 73.6, sampleTs: 1 } }} />);
    expect(h).not.toContain("자동 수신");
  });

  it("bodyDrafts 프롭 없이도 기존과 동일 렌더(하위 호환)", () => {
    const h = renderToStaticMarkup(<BodyTab {...props} />);
    expect(h).not.toContain("자동 수신");
  });

  it("확정 레코드(source:import)는 히스토리에 🧬 배지", () => {
    const log = [...props.bodyLog, { date: "2026-07-06", weight: 73.6, muscle: 34.7, fatPct: 18.7, score: 85, lbm: 60.5, source: "import" }];
    const h = renderToStaticMarkup(<BodyTab {...props} bodyLog={log} />);
    expect(h).toContain("🧬");
  });
});
