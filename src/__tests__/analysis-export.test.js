import { describe, it, expect } from "vitest";
import { buildAnalysisPackage, resolvePeriod, packageMeta, PERIODS, exCategory } from "../analysisExport.js";

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

describe("2단계화 — 코치 요약본(기본) vs 정밀 상세본", () => {
  const range = { start: "2026-07-14", end: "2026-07-18" };
  const summary = buildAnalysisPackage(state(), range, "2026-07-18");
  const detail = buildAnalysisPackage(state(), range, "2026-07-18", { detail: true });

  it("요약본(기본)엔 끼니별 상세 없음 — 문서 비대화 방지", () => {
    expect(summary).not.toContain("식단: ");
    expect(summary).not.toContain("운동: 00시");
  });
  it("상세본엔 끼니별 식단·운동 세션 포함", () => {
    expect(detail).toContain("식단: 00시 닭 1570");
    expect(detail).toContain("운동: 00시 조깅 30분 300");
    expect(detail).toContain("치킨 2500"); // 07-16 상세
  });
  it("빈도 집계는 양쪽 모두 포함", () => {
    for (const pkg of [summary, detail]) {
      expect(pkg).toContain("## 자주 먹은 음식 TOP");
      expect(pkg).toContain("## 운동 종목별 집계");
      expect(pkg).toContain("- 조깅: 1회 · 총 30분 · 300kcal");
    }
  });
});

describe("P0~P1 신규 섹션", () => {
  const range = { start: "2026-07-14", end: "2026-07-18" };
  const pkg = buildAnalysisPackage(state(), range, "2026-07-18");

  it("설정 변경 이력 — 적응형 보정 전후값 + 모드 전환(운동반영률 연동)", () => {
    expect(pkg).toContain("## 설정 변경 이력");
    expect(pkg).toContain("- 2026-06-01 적응형 보정 0→-55kcal");
    expect(pkg).toContain("- 2026-07-17 모드 감량→유지 (운동반영 50%→100%)");
    expect(pkg).toContain("- 2026-07-18 모드 유지→감량 (운동반영 100%→50%)");
    expect(pkg).toContain("변경 이력으로 저장되지 않음"); // 목표 kcal 절대값 한계 명시
  });

  it("초과폭 — ✗에 기준 대비 +N 표기 (isCalOk와 동일 산식)", () => {
    expect(pkg).toContain("✗(+930)"); // 2500 - 1570
    expect(pkg).toContain("✗(+N) = 초과폭"); // 범례
  });

  it("운동 구성 (주간) — 유형 %·운동일·휴식일 (조깅=유산소)", () => {
    expect(pkg).toContain("## 운동 구성 (주간)");
    expect(pkg).toMatch(/07\/13주\s+100\s+0\s+0\s+0\s+0\s+\| 운동 1일 · 휴식 4일/);
  });

  it("월별 집계에 평균C·평균F 열 (2개월 이상일 때)", () => {
    const s = state();
    s.allDays["2026-06-20"] = { mode: "cut", meals: [{ n: "유월", k: 1500, p: 150, c: 100, f: 40, serving: 1 }], exercises: [] };
    const wide = buildAnalysisPackage(s, { start: "2026-06-15", end: "2026-07-18" }, "2026-07-18");
    expect(wide).toContain("평균C");
    expect(wide).toContain("평균F");
    expect(wide).toMatch(/2026-06\s+1500\s+150\s+100\s+40/); // 6월 한 건 = 그대로 평균
  });

  it("기록 공백 — 3일 이상 무기록 구간 명시 (오늘 제외)", () => {
    const s = state();
    // 07-01~07-13 공백(13일), 07-14는 기록 없음이지만 기간 시작 이후 첫 기록 07-15 전까지 공백
    const wide = buildAnalysisPackage(s, { start: "2026-07-01", end: "2026-07-18" }, "2026-07-18");
    expect(wide).toContain("기록 공백: 07-01~07-14 (14일)");
  });

  it("운동 유형 분류기 — 대표 종목 스팟체크", () => {
    expect(exCategory("러닝 5분")).toBe("유산소");
    expect(exCategory("계단 오르기")).toBe("유산소");
    expect(exCategory("행잉 레그 레이즈")).toBe("코어"); // 코어가 하체(레그)보다 우선
    expect(exCategory("루마니안 데드리프트")).toBe("하체");
    expect(exCategory("벤치프레스(중강도)")).toBe("상체");
    expect(exCategory("투암 덤벨 로우")).toBe("상체");
    expect(exCategory("농사일")).toBe("기타");
    expect(exCategory("품롤러")).toBe("기타");
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
