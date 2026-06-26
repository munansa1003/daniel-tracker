import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextMealTip } from "../components/NextMealTip.jsx";
import { MacroRatioBar } from "../components/MacroRatioBar.jsx";
import { IntakeRhythm } from "../components/IntakeRhythm.jsx";

// 시나리오: 감량·체중75 → 휴식일 목표 P165 C120 F45 K1546.
// 운동 420kcal(50% 되먹기) → effectiveTargetK 1756 · adjustedC 173.
// 점심까지 섭취 P95 C70 F28 K850.

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

describe("NextMealTip (H) — 다음 끼니 한 입", () => {
  // 목표 P165·adjustedC173·effectiveTargetK1756. 아침(8)·점심(13) 기록, 현재 14시.
  const T = { totals: { p: 68, c: 95, f: 28, k: 900 }, meals: [{ hour: 8 }, { hour: 13 }], nowHour: 14, tP: 165, tC: 173, tK: 1756 };

  it("남은(P97·C78·856kcal) ÷ 남은 끼니 2(저녁·야간) → P49·C39·428", () => {
    const h = renderToStaticMarkup(<NextMealTip {...T} />);
    expect(h).toContain("P49");
    expect(h).toContain("C39");
    expect(h).toContain("428");
    expect(h).toContain("남은 끼니 2");
  });

  it("목표 다 채우면(섭취 ≥ 목표K) 권장 대신 완료 메시지", () => {
    const h = renderToStaticMarkup(<NextMealTip {...T} totals={{ p: 170, c: 180, f: 50, k: 1800 }} />);
    expect(h).toContain("다 채");
    expect(h).not.toContain("P49");
  });

  it("이미 충족된 매크로는 음수 대신 0 (P 초과 상태)", () => {
    // 단백질만 초과(200>165), 칼로리는 남음 → 다음 끼니 P0
    const h = renderToStaticMarkup(<NextMealTip {...T} totals={{ p: 200, c: 95, f: 28, k: 900 }} />);
    expect(h).toContain("P0");
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
