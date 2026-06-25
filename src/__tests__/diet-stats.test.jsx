import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RemainingMacros } from "../components/RemainingMacros.jsx";
import { MacroRatioBar } from "../components/MacroRatioBar.jsx";
import { IntakeRhythm } from "../components/IntakeRhythm.jsx";

// 시나리오: 감량·체중75 → 휴식일 목표 P165 C120 F45 K1546.
// 운동 420kcal(50% 되먹기) → effectiveTargetK 1756 · adjustedC 173.
// 점심까지 섭취 P95 C70 F28 K850.

describe("RemainingMacros (A) — 남은 매크로 & Net", () => {
  const T = { totals: { p: 95, c: 70, f: 28, k: 850 }, tP: 165, tC: 173, tF: 45, tK: 1756, exTotal: 420 };

  it("남은 = 목표 − 섭취: 단백질 +70 · 탄수 +103 · 지방 +17 · 칼로리 +906", () => {
    const h = renderToStaticMarkup(<RemainingMacros {...T} />);
    expect(h).toContain("+70");   // 165-95
    expect(h).toContain("+103");  // 173-70
    expect(h).toContain("+17");   // 45-28
    expect(h).toContain("+906");  // 1756-850
    expect(h).toContain("남음");
  });

  it("운동 되먹기 주석: 운동량·오늘 목표·탄수 표시", () => {
    const h = renderToStaticMarkup(<RemainingMacros {...T} />);
    expect(h).toContain("운동 420");
    expect(h).toContain("1,756");
    expect(h).toContain("탄수 173g");
  });

  it("초과 시 음수 + '초과' 라벨", () => {
    const h = renderToStaticMarkup(<RemainingMacros {...T} totals={{ p: 200, c: 70, f: 28, k: 850 }} />);
    expect(h).toContain("-35");   // 165-200
    expect(h).toContain("초과");
  });

  it("운동 0이면 되먹기 주석 숨김", () => {
    const h = renderToStaticMarkup(<RemainingMacros {...T} exTotal={0} />);
    expect(h).not.toContain("되먹기");
  });
});

describe("MacroRatioBar (B) — 매크로 구성비", () => {
  const targets = { p: 165, c: 120, f: 45, k: 1546 };

  it("칼로리 기여 비율: P42% / C31% / F27% (P×4·C×4·F×9)", () => {
    // pc=380 cc=280 fc=252 sum=912 → 42/31/27
    const h = renderToStaticMarkup(<MacroRatioBar totals={{ p: 95, c: 70, f: 28, k: 850 }} targets={targets} />);
    expect(h).toContain("단백질 42%");
    expect(h).toContain("탄수 31%");
    expect(h).toContain("지방 27%");
  });

  it("목표 비율선: 단백질 목표 43% (660/1545)", () => {
    const h = renderToStaticMarkup(<MacroRatioBar totals={{ p: 95, c: 70, f: 28, k: 850 }} targets={targets} />);
    expect(h).toContain("/목표43");
  });

  it("섭취 0이면 숨김(null)", () => {
    const h = renderToStaticMarkup(<MacroRatioBar totals={{ p: 0, c: 0, f: 0, k: 0 }} targets={targets} />);
    expect(h).toBe("");
  });
});

describe("IntakeRhythm (C) — 시간대 섭취 리듬", () => {
  it("시간대별 칼로리·단백질 합산: 아침 320·P30 / 점심 530·P65", () => {
    const meals = [
      { hour: 8, k: 320, p: 30, serving: 1 },
      { hour: 13, k: 530, p: 65, serving: 1 },
    ];
    const h = renderToStaticMarkup(<IntakeRhythm meals={meals} />);
    expect(h).toContain("320 · P30");
    expect(h).toContain("530 · P65");
  });

  it("serving 배수 반영: k100×2 → 200, p10×2 → P20", () => {
    const h = renderToStaticMarkup(<IntakeRhythm meals={[{ hour: 8, k: 100, p: 10, serving: 2 }]} />);
    expect(h).toContain("200 · P20");
  });

  it("기록 없으면 숨김(null)", () => {
    expect(renderToStaticMarkup(<IntakeRhythm meals={[]} />)).toBe("");
  });
});
