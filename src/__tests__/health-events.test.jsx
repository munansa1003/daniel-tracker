import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HealthEvents } from "../components/HealthEvents.jsx";

const noop = () => {};

describe("HealthEvents 렌더", () => {
  it("빈 목록 → 추가 버튼 + 안내", () => {
    const h = renderToStaticMarkup(<HealthEvents events={[]} onChange={noop} todayStr="2026-07-05" />);
    expect(h).toContain("컨디션 기록 추가");
  });

  it("이벤트 목록 — 진행중/계산제외 배지·라벨 표시", () => {
    const events = [
      { id: 1, type: "injury", label: "손목·다리", start: "2026-07-04", end: null, exclude: false },
      { id: 2, type: "illness", label: "장염", start: "2026-06-20", end: "2026-06-23", exclude: true },
    ];
    const h = renderToStaticMarkup(<HealthEvents events={events} onChange={noop} todayStr="2026-07-05" />);
    expect(h).toContain("손목·다리");
    expect(h).toContain("장염");
    expect(h).toContain("진행중");   // 부상 활성
    expect(h).toContain("계산 제외"); // 장염 배지
  });

  it("A안 — 진행중은 '✓ 회복', 회복된 건 '되돌리기'", () => {
    const events = [
      { id: 1, type: "injury", label: "손목", start: "2026-07-04", end: null, exclude: false },
      { id: 2, type: "illness", label: "장염", start: "2026-06-20", end: "2026-06-23", exclude: false },
    ];
    const h = renderToStaticMarkup(<HealthEvents events={events} onChange={noop} todayStr="2026-07-05" />);
    expect(h).toContain("회복");     // ongoing → ✓ 회복 버튼
    expect(h).toContain("되돌리기");  // ended → 되돌리기
  });
});
