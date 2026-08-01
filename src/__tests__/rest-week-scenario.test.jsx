// 휴식일 프리셋 감사 R2·R3 골든셋 — 가상 1주(월~일) 시나리오를 손계산 기대값 표로 고정하고,
// (R2) 앱의 공유 계산 경로(내보내기·차트 시리즈·통계탭 렌더)와 대조,
// (R3) 앱 코드를 쓰지 않는 독립 공식 재기술로 삼각 검산한다.
//
// 기대값 표 (감사 지시서 — Phase 0 실측 연산자(round ≤, 복귀 >300)와 일치 확인됨):
//  월 train 운동700 섭취1880 → 목표1886 ✓ | 화 train 400/1750 → 1736 ✗(+14)
//  수 rest 0/1660 → 1675 ✓ | 목 rest 0/1690 → 1675 ✗(+15)  ← 경계(프리셋+15)
//  금 rest 400/1700 → 1736 ✓ (자동 복귀 → 훈련일 집계) | 토 미선언 0/1600 → 1536 ✗(+64)
//  일 train 800/1930 → 1936 ✓
//  주간 적정 4/7 · 평균 목표 1,740 · 평균 섭취 ≈1,744
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { today, isCalOk, effectiveDayMode, restTargets, REST_K } from "../utils.js";
import { buildAnalysisPackage } from "../analysisExport.js";
import { buildCalorieSeries } from "../components/CalorieBandChart.jsx";
import { StatsTab } from "../components/StatsTab.jsx";

const CUT = { p: 165, c: 118, f: 45, k: 1536, weight: 75 };
const targetsByMode = { cut: CUT, maintain: { p: 165, c: 170, f: 45, k: 1746, weight: 75 }, rest: restTargets(75) };

// 지난주 월요일(오늘 기준 — 항상 완결된 주라 오늘-제외 규칙과 무관, 날짜 비의존 테스트)
const TODAY = today();
const lastMonday = (() => {
  const d = new Date(TODAY + "T12:00:00");
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow) - 7);
  return d;
})();
const ds = (i) => {
  const d = new Date(lastMonday);
  d.setDate(d.getDate() + i);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

// 시나리오 행: [dayType, 운동, 섭취, 단백질, 기대목표, 기대판정]
const ROWS = [
  ["train", 700, 1880, 165, 1886, true],
  ["train", 400, 1750, 100, 1736, false], // 단백질 미달일도 1일 섞음(pDays=6 확보)
  ["rest",    0, 1660, 165, 1675, true],
  ["rest",    0, 1690, 165, 1675, false],
  ["rest",  400, 1700, 165, 1736, true],
  [null,      0, 1600, 165, 1536, false],
  ["train", 800, 1930, 165, 1936, true],
];

const allDays = {};
ROWS.forEach(([dayType, ex, k, p], i) => {
  allDays[ds(i)] = {
    mode: "cut",
    ...(dayType ? { dayType } : {}),
    meals: [{ n: "메뉴", k, p, c: 150, f: 50, serving: 1, hour: 12 }],
    exercises: ex > 0 ? [{ n: "운동", kcal: ex, duration: 30, hour: 7 }] : [],
  };
});

describe("R2 — 시나리오 1주: 분석 내보내기(일별 유효목표·판정·😴 태그)", () => {
  const pkg = buildAnalysisPackage(
    { allDays, bodyLog: [], goals: {}, user: { height: 175, age: 42 }, mode: "cut", targets: CUT, targetsByMode, appAdjust: 0, tdeeHistory: [], healthEvents: [] },
    { start: ds(0), end: TODAY }, TODAY);
  const dailyLines = pkg.split("\n").filter((l) => /^\d{2}-\d{2}\s/.test(l));

  it("7일 전 행의 유효목표·판정·초과폭이 손계산 표와 일치", () => {
    expect(dailyLines.length).toBe(7);
    const expects = [" 1886  ✓", " 1736  ✗(+14)", " 1675  ✓ 😴", " 1675  ✗(+15) 😴", " 1736  ✓ 😴", " 1536  ✗(+64)", " 1936  ✓"];
    expects.forEach((s, i) => expect(dailyLines[i], `${i}번째 행`).toContain(s));
  });
  it("주간 적정 4/7 — 휴식일이 분모에 포함되고 복귀일(금)은 훈련일 기준으로 ✓", () => {
    expect(dailyLines.filter((l) => l.includes("✓")).length).toBe(4);
    expect(dailyLines.filter((l) => l.includes("✗")).length).toBe(3);
  });
});

describe("R2 — 시나리오 1주: 차트 시리즈(달력·그래프 판정 경로)", () => {
  it("일별 ✓/✗ 점이 기대 판정과 일치 (초과 3일)", () => {
    const s = buildCalorieSeries(allDays, targetsByMode, "cut", "all", TODAY);
    expect(s.points.map((p) => p.ok)).toEqual(ROWS.map((r) => r[5]));
    expect(s.overCount).toBe(3);
    expect(s.n).toBe(7);
  });
});

describe("R2 — 시나리오 1주: 통계탭 주간 성적표 렌더", () => {
  it("지난 주 도트매트릭스에 칼로리 4/7 · 단백질 6/7이 표시되고, 옛 공식 값(2/7)은 없다", () => {
    const html = renderToStaticMarkup(
      <StatsTab bodyLog={[]} allDays={allDays} goals={{ mode: "cut" }} onSaveGoals={() => {}}
        appTargets={CUT} targetsByMode={targetsByMode} mode="cut" appAdjust={0} tdeeHistory={[]} />);
    expect(html).toContain(">6/7<");                          // 단백질 (화요일만 미달)
    expect((html.match(/>4\/7</g) || []).length).toBeGreaterThanOrEqual(2); // 칼로리 4/7 + 운동 4/7
    // 휴식일을 훈련일 공식으로 판정했다면 수·목·금이 뒤집혀 칼로리 2/7 또는 3/7이 된다
    expect(html).not.toContain(">2/7<");
    expect(html).not.toContain(">3/7<");
  });
});

describe("R3 — 독립 이중 검산 (앱 코드 미사용 공식 재기술)", () => {
  // 감사 스펙의 공식을 이 자리에서 다시 기술 — utils.js를 참조하지 않는다.
  const specTarget = (dayType, ex) => (dayType === "rest" && Math.round(ex) <= 300 ? 1675 : 1536 + Math.round(ex * 0.5));
  const specOk = (intake, target) => Math.round(intake) <= target;

  it("손계산 표 = 독립 공식 = 앱 함수, 3자 일치", () => {
    ROWS.forEach(([dayType, ex, intake, , expTarget, expOk], i) => {
      // 독립 공식
      const st = specTarget(dayType, ex);
      expect(st, `독립 목표 ${i}`).toBe(expTarget);
      expect(specOk(intake, st), `독립 판정 ${i}`).toBe(expOk);
      // 앱 함수 (utils 단일 출처)
      const m = effectiveDayMode(dayType ? { dayType } : {}, ex, "cut");
      const appTarget = m === "rest" ? REST_K : CUT.k;
      expect(isCalOk(intake, ex, appTarget, m), `앱 판정 ${i}`).toBe(expOk);
    });
  });
  it("주간 평균 목표 1,740 · 평균 섭취 1,744 (반올림)", () => {
    const tSum = ROWS.reduce((s, r) => s + specTarget(r[0], r[1]), 0);
    const kSum = ROWS.reduce((s, r) => s + r[2], 0);
    expect(Math.round(tSum / 7)).toBe(1740);
    expect(Math.round(kSum / 7)).toBe(1744);
  });
  it("경계 재확인: 운동 딱 300은 휴식 유지, 301부터 복귀 — 복귀 목표가 프리셋보다 큼(절벽 없음)", () => {
    expect(effectiveDayMode({ dayType: "rest" }, 300, "cut")).toBe("rest");
    expect(effectiveDayMode({ dayType: "rest" }, 301, "cut")).toBe("cut");
    expect(1536 + Math.round(301 * 0.5)).toBeGreaterThanOrEqual(1675);
  });
});
