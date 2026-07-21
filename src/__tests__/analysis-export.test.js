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
    { date: "2026-07-10", weight: 78.0, muscle: 39.1, fatPct: 22.0, score: 86 },
    { date: "2026-07-17", weight: 77.5, muscle: 39.2, fatPct: 21.5, score: 88 },
  ];
  return {
    allDays, bodyLog,
    goals: {}, user: { height: 175, age: 42 },
    mode: "cut", targets: targetsByMode.cut, targetsByMode,
    // 실제 앱과 동일한 정합: appAdjust = adjustForDate(tdeeHistory, today)
    appAdjust: -55, tdeeHistory: [{ from: "2026-06-01", adjust: -55 }],
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

  it("일별 판정 — 유효목표 병기 + ✓/✗ + 오늘은 진행중(판정 없음)", () => {
    // cut: tK=1570, ex 300 × 0.5 → 유효목표 1720. 판정 기준값이 라인에 그대로 보임(클로드 검증 가능)
    expect(pkg).toMatch(/07-15\s+1570\s+170\s+119\s+46\s+-300\s+1720\s+✓/);
    expect(pkg).toMatch(/07-16\s+2500\s+100\s+200\s+90\s+0\s+1570\s+✗/);   // 초과
    expect(pkg).toMatch(/07-17\s+2000\s+170\s+160\s+60\s+0\s+2000\s+✓/);   // 그날 maintain 스탬프 기준
    expect(pkg).toContain("(오늘, 진행중)");
    expect(pkg).not.toMatch(/07-18.*[✓✗]/); // 오늘은 판정 안 함
    expect(pkg).toContain("유효목표 = 그날 목표kcal + 운동반영분"); // 범례
  });

  it("체성분 — 골격근·체지방률·체지방량·점수까지 (기간 내 1건)", () => {
    expect(pkg).toContain("## 체성분 기록 (1건)");
    expect(pkg).toContain("07-17 77.5kg · 골격근 39.2kg · 체지방 21.5% = 16.7kg · 점수 88");
    expect(pkg).not.toContain("기간 변화:"); // 1건이면 변화량 없음
  });

  it("기간 내 2건 이상이면 체지방량·골격근 기간 변화 요약", () => {
    const wide = buildAnalysisPackage(state(), { start: "2026-07-09", end: TODAY }, TODAY);
    expect(wide).toContain("## 체성분 기록 (2건)");
    expect(wide).toContain("(기간 -0.5kg)"); // 프로필 줄: 78.0 → 77.5
    expect(wide).toContain("기간 변화: 체지방량 17.2→16.7kg (-0.5) · 골격근 39.1→39.2kg (+0.1)");
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

describe("상세 내용 포함 (식단·운동·빈도)", () => {
  const range = { start: "2026-07-14", end: "2026-07-18" };
  const pkg = buildAnalysisPackage(state(), range, "2026-07-18");

  it("일별 상세 — 음식명·서빙·시간·kcal, 운동명·분", () => {
    expect(pkg).toContain("식단: 00시 닭 1570");
    expect(pkg).toContain("운동: 00시 조깅 30분 300");
    expect(pkg).toContain("치킨 2500"); // 07-16 상세
  });
  it("빈도 집계 — 자주 먹은 음식 TOP + 운동 종목별", () => {
    expect(pkg).toContain("## 자주 먹은 음식 TOP");
    expect(pkg).toMatch(/닭 1회|치킨 1회/);
    expect(pkg).toContain("## 운동 종목별 집계");
    expect(pkg).toContain("- 조깅: 1회 · 총 30분 · 300kcal");
  });
});

describe("반복 입력 플래그 (≈)", () => {
  it("직전 기록일과 총량이 같으면 ≈, 첫날·다른 값은 없음", () => {
    const same = { mode: "cut", meals: [{ n: "도시락", k: 750, p: 60, c: 80, f: 20, serving: 1 }], exercises: [] };
    const s = { ...state(), allDays: { "2026-07-14": same, "2026-07-15": { ...same }, "2026-07-16": { ...same }, "2026-07-17": { mode: "cut", meals: [{ n: "다른것", k: 900, p: 70, c: 90, f: 25, serving: 1 }], exercises: [] } } };
    const pkg = buildAnalysisPackage(s, { start: "2026-07-14", end: "2026-07-17" }, "2026-07-20");
    expect(pkg).not.toMatch(/07-14.*≈/); // 첫날은 비교 대상 없음
    expect(pkg).toMatch(/07-15.*✓? ?≈|07-15.*≈/);
    expect(pkg).toMatch(/07-16.*≈/);
    expect(pkg).not.toMatch(/07-17.*≈/); // 값이 달라짐
    expect(pkg).toContain("일괄 입력 가능성"); // 범례
  });
});
