import { describe, it, expect } from "vitest";
import { buildAnalysisPackage, resolvePeriod, packageMeta, PERIODS } from "../analysisExport.js";

const TODAY = "2026-07-18";
const targetsByMode = {
  cut: { k: 1570, p: 170, c: 119, f: 46 },
  maintain: { k: 2000, p: 170, c: 160, f: 60 },
};

function state() {
  const allDays = {
    "2026-07-15": { mode: "cut", meals: [{ n: "닭", k: 1570, p: 170, c: 119, f: 46, serving: 1 }], exercises: [{ n: "조깅", kcal: 300, duration: 30 }] },
    "2026-07-16": { mode: "cut", meals: [{ n: "치킨", k: 2500, p: 100, c: 200, f: 90, serving: 1 }], exercises: [] },
    "2026-07-17": { mode: "maintain", meals: [{ n: "밥", k: 2000, p: 170, c: 160, f: 60, serving: 1 }], exercises: [] },
    [TODAY]: { mode: "cut", meals: [{ n: "아침", k: 500, p: 40, c: 40, f: 15, serving: 1 }], exercises: [] },
    "2026-04-01": { mode: "cut", meals: [{ n: "옛날", k: 1500, p: 160, c: 110, f: 44, serving: 1 }], exercises: [] },
  };
  const bodyLog = [
    { date: "2026-07-10", weight: 78.0 },
    { date: "2026-07-17", weight: 77.5 },
  ];
  return {
    allDays, bodyLog,
    goals: {}, user: { height: 175, age: 42 },
    mode: "cut", targets: targetsByMode.cut, targetsByMode,
    appAdjust: -55, tdeeHistory: [{ date: "2026-06-01", delta: -55 }],
    healthEvents: [{ id: 1, type: "illness", label: "장염", start: "2026-07-16", end: "2026-07-16", exclude: true }],
  };
}

describe("resolvePeriod", () => {
  it("3개월 기본 91일, 격주 14일 (양끝 포함)", () => {
    const r = resolvePeriod("3m", TODAY, {});
    expect(r.end).toBe(TODAY);
    expect(r.start).toBe("2026-04-19"); // 91일간
    expect(resolvePeriod("2w", TODAY, {}).start).toBe("2026-07-05");
  });
  it("전체 = 첫 기록일부터, 직접 = 지정값(역순 자동 교정)", () => {
    expect(resolvePeriod("all", TODAY, state().allDays).start).toBe("2026-04-01");
    const r = resolvePeriod("custom", TODAY, {}, { start: "2026-07-10", end: "2026-07-01" });
    expect(r.start).toBe("2026-07-01");
    expect(r.end).toBe("2026-07-10");
  });
  it("기간 키 5종 존재(3m 기본 노출용)", () => {
    expect(PERIODS.map((p) => p.key)).toEqual(["2w", "1m", "3m", "all", "custom"]);
  });
});

describe("buildAnalysisPackage", () => {
  const range = { start: "2026-07-14", end: TODAY };
  const pkg = buildAnalysisPackage(state(), range, TODAY);

  it("지시문·프로필·규칙·보정 포함", () => {
    expect(pkg).toContain("# Body Plan 분석 요청 (2026-07-14 ~ 2026-07-18");
    expect(pkg).toContain("영양·운동 코치");
    expect(pkg).toContain("키 175cm · 나이 42");
    expect(pkg).toContain("감량(cut) · 목표 1,570kcal · P170 C119 F46");
    expect(pkg).toContain("-55kcal 적용 중");
    expect(pkg).toContain("운동 소모의 50%");
  });

  it("컨디션 이력 + 계산 제외 주석 + 일별 태그", () => {
    expect(pkg).toContain("## 컨디션 이력");
    expect(pkg).toContain("2026-07-16 ~ 2026-07-16 장염");
    expect(pkg).toContain("계산 제외 처리됨");
    expect(pkg).toContain("[장염]"); // 해당 일자 라인 태그
  });

  it("일별 판정 — 적정✓/초과✗/오늘은 진행중(판정 없음)/모드별 목표", () => {
    expect(pkg).toMatch(/07-15\s+1570\s+170\s+119\s+46\s+-300\s+✓/); // cut 정확히 목표
    expect(pkg).toMatch(/07-16\s+2500.*✗/);                            // 초과
    expect(pkg).toMatch(/07-17\s+2000.*✓/);                            // 그날 maintain 스탬프 기준 적정
    expect(pkg).toContain("(오늘, 진행중)");
    expect(pkg).not.toMatch(/07-18.*[✓✗]/);                            // 오늘은 판정 안 함
  });

  it("체중 기록 — 기간 내 것만(1건), 변화량은 2건 미만이라 미표기", () => {
    expect(pkg).toContain("## 체중 기록 (1건)");
    expect(pkg).toContain("07-17 77.5kg");
    expect(pkg).not.toContain("기간 -"); // 07-10은 기간 밖 → 변화량 계산 불가
  });

  it("기간 내 체중 2건 이상이면 기간 변화량 표기", () => {
    const s = state();
    const wide = buildAnalysisPackage(s, { start: "2026-07-09", end: TODAY }, TODAY);
    expect(wide).toContain("## 체중 기록 (2건)");
    expect(wide).toContain("(기간 -0.5kg)"); // 78.0 → 77.5
  });

  it("기간 밖 데이터는 미포함", () => {
    expect(pkg).not.toContain("04-01");
    expect(pkg).not.toContain("옛날");
  });
});

describe("packageMeta", () => {
  it("기록·체중·컨디션 건수와 KB", () => {
    const s = state();
    const range = { start: "2026-07-14", end: TODAY };
    const pkg = buildAnalysisPackage(s, range, TODAY);
    const m = packageMeta(pkg, s, range);
    expect(m.days).toBe(4);
    expect(m.weighs).toBe(1); // 07-17만 (07-10은 기간 밖)
    expect(m.conds).toBe(1);
    expect(m.kb).toBeGreaterThan(0);
  });
});
