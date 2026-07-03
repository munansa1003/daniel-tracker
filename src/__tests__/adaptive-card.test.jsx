import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdaptiveTdeeCard } from "../components/AdaptiveTdeeCard.jsx";

const noop = () => {};
const est = { valid: true, confident: true, measuredTDEE: 2090, formulaMaint: 1745, avgExercise: 400, delta: -55, loggedDays: 25, weighIns: 8, windowDays: 28 };
const proposal = { delta: -55, current: { k: 1570, c: 119 }, proposed: { k: 1515, c: 105 } };

describe("AdaptiveTdeeCard", () => {
  it("꺼짐: 공식 안내만, 실측 숫자 없음", () => {
    const h = renderToStaticMarkup(<AdaptiveTdeeCard estimate={est} adaptiveOn={false} currentAdjust={0} proposal={null} onToggle={noop} onApply={noop} onRevert={noop} />);
    expect(h).toContain("적응형 유지칼로리");
    expect(h).toContain("공식(BMR×1.05)");
    expect(h).not.toContain("2,090");
  });

  it("켜짐+데이터 부족: 기록 진행 안내", () => {
    const bad = { valid: false, loggedDays: 9, weighIns: 3, windowDays: 28 };
    const h = renderToStaticMarkup(<AdaptiveTdeeCard estimate={bad} adaptiveOn={true} currentAdjust={0} proposal={null} onToggle={noop} onApply={noop} onRevert={noop} />);
    expect(h).toContain("9/28일");
    expect(h).not.toContain("2,090");
  });

  it("켜짐+신뢰: 실측 TDEE·공식추정·차이 표시", () => {
    const h = renderToStaticMarkup(<AdaptiveTdeeCard estimate={est} adaptiveOn={true} currentAdjust={0} proposal={null} onToggle={noop} onApply={noop} onRevert={noop} />);
    expect(h).toContain("2,090");        // 실측 TDEE
    expect(h).toContain("공식 추정 2,145"); // 1745 + 400
    expect(h).toContain("55");            // 차이
    expect(h).toContain("25/28일");
  });

  it("제안: 목표 변화·탄수 변화·적용 버튼", () => {
    const h = renderToStaticMarkup(<AdaptiveTdeeCard estimate={est} adaptiveOn={true} currentAdjust={0} proposal={proposal} onToggle={noop} onApply={noop} onRevert={noop} />);
    expect(h).toContain("1,570 → 1,515");
    expect(h).toContain("탄수 119→105g");
    expect(h).toContain("단백질·지방 유지");
    expect(h).toContain("적용");
  });

  it("보정 적용 중: 되돌리기 노출", () => {
    const h = renderToStaticMarkup(<AdaptiveTdeeCard estimate={est} adaptiveOn={true} currentAdjust={-55} proposal={null} onToggle={noop} onApply={noop} onRevert={noop} />);
    expect(h).toContain("보정 -55kcal 적용 중");
    expect(h).toContain("공식으로 되돌리기");
  });
});
