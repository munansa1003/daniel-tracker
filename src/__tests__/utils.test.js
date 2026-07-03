import { describe, it, expect } from "vitest";
import { calcTargets, periodOf, TIME_PERIODS, aggregateDay, getWeekKey, exFeedback, isCalOk, MODE_DEFICIT, MODE_FEEDBACK, adjustForDate } from "../utils.js";

describe("calcTargets — 칼로리·매크로 목표 (캘리브레이션 값 보호)", () => {
  it("스모크: 체중 77.3 / 175cm / 42세 → K=1570, P=170, F=46, C=119", () => {
    expect(calcTargets(77.3, 175, 42)).toEqual({ p: 170, c: 119, f: 46, k: 1570, weight: 77.3 });
  });

  it("체중 75 / 175cm / 42세 → K=1546, P=165, F=45, C=120", () => {
    expect(calcTargets(75, 175, 42)).toEqual({ p: 165, c: 120, f: 45, k: 1546, weight: 75 });
  });

  it("기본 인자(175cm/35세) 폴백: 체중 77.5 → K=1609, P=171, F=47, C=126", () => {
    expect(calcTargets(77.5)).toEqual({ p: 171, c: 126, f: 47, k: 1609, weight: 77.5 });
  });

  it("매크로 정합: C는 '나머지' 구조 — P×4 + F×9 + C×4 ≈ K (반올림 오차 ±2)", () => {
    for (const w of [70, 75, 77.3, 80, 85]) {
      const t = calcTargets(w, 175, 42);
      expect(Math.abs(t.p * 4 + t.f * 9 + t.c * 4 - t.k)).toBeLessThanOrEqual(2);
    }
  });

  it("캘리브레이션 상수 고정: BMR×1.05 − 175 (활동계수 1.55로 바뀌면 즉시 검출)", () => {
    // 체중 77.3/175/42 기준 BMR = 1661.75. ×1.05−175 = 1569.84 → 1570.
    // 만약 ×1.55(공식 활동계수)로 바뀌면 K=2401, ×1.05−0이면 K=1745가 되어 모두 실패한다.
    expect(calcTargets(77.3, 175, 42).k).toBe(1570);
    expect(calcTargets(77.3, 175, 42).p).toBe(Math.round(77.3 * 2.2)); // 단백질 2.2g/kg
    expect(calcTargets(77.3, 175, 42).f).toBe(Math.round(77.3 * 0.6)); // 지방 0.6g/kg
  });

  it("기본 mode는 cut — 인자 생략/cut 명시 결과 동일 (기존 호출부 무영향)", () => {
    expect(calcTargets(77.3, 175, 42)).toEqual(calcTargets(77.3, 175, 42, "cut"));
  });
});

describe("calcTargets — 유지(maintain) 모드", () => {
  it("유지 모드: 적자 0 → K = BMR×1.05 = 1745 (감량 1570 대비 +175)", () => {
    // 77.3/175/42 BMR=1661.75 ×1.05=1744.84 → 1745
    expect(calcTargets(77.3, 175, 42, "maintain")).toEqual({ p: 170, c: 163, f: 46, k: 1745, weight: 77.3 });
  });

  it("유지 모드는 감량 대비 정확히 적자(175)만큼 K가 높다 (P·F·체중 동일)", () => {
    for (const w of [70, 75, 77.3, 80]) {
      const cut = calcTargets(w, 175, 42, "cut");
      const mt = calcTargets(w, 175, 42, "maintain");
      expect(mt.k - cut.k).toBe(175);
      expect(mt.p).toBe(cut.p);
      expect(mt.f).toBe(cut.f);
      expect(mt.c).toBeGreaterThan(cut.c); // 탄수만 자동 증가
    }
  });

  it("유지 모드 매크로 정합: P×4 + F×9 + C×4 ≈ K (반올림 ±2)", () => {
    const t = calcTargets(77.3, 175, 42, "maintain");
    expect(Math.abs(t.p * 4 + t.f * 9 + t.c * 4 - t.k)).toBeLessThanOrEqual(2);
  });

  it("알 수 없는 mode는 cut로 폴백", () => {
    expect(calcTargets(77.3, 175, 42, "weird")).toEqual(calcTargets(77.3, 175, 42, "cut"));
  });
});

describe("exFeedback / isCalOk — 모드별 운동 되먹기 & 판정", () => {
  it("운동 되먹기 계수: 감량 0.5 / 유지 1.0", () => {
    expect(exFeedback("cut")).toBe(0.5);
    expect(exFeedback("maintain")).toBe(1);
    expect(exFeedback(undefined)).toBe(0.5); // 폴백 = cut
    expect(MODE_DEFICIT).toEqual({ cut: 175, maintain: 0 });
    expect(MODE_FEEDBACK).toEqual({ cut: 0.5, maintain: 1 });
  });

  it("판정은 반올림 기준 (PR #16): 표시값이 목표와 같으면 달성", () => {
    expect(isCalOk(1570.4, 0, 1570, "cut")).toBe(true);  // 표시 1570 = 목표
    expect(isCalOk(1570.6, 0, 1570, "cut")).toBe(false); // 표시 1571 > 목표
  });

  it("운동 되먹기: 같은 섭취·운동이라도 유지(100%)가 감량(50%)보다 관대", () => {
    // 섭취 2000, 운동 800. 감량 목표 1570 / 유지 목표 1745 기준
    expect(isCalOk(2000, 800, 1570, "cut")).toBe(false);     // 1570 + 400 = 1970 < 2000
    expect(isCalOk(2000, 800, 1745, "maintain")).toBe(true); // 1745 + 800 = 2545 ≥ 2000
  });
});

describe("calcTargets — 적응형 보정치(adjust)", () => {
  it("adjust 기본 0: 생략과 동일 (기존 무영향)", () => {
    expect(calcTargets(77.3, 175, 42, "cut")).toEqual(calcTargets(77.3, 175, 42, "cut", 0));
  });
  it("adjust −55: 칼로리 −55, 탄수만 흡수(−14g), 단백질·지방 불변", () => {
    // 기준선 1744.84−55 → k=round(1689.84−175)=1515, C=round((1515−680−414)/4)=105
    expect(calcTargets(77.3, 175, 42, "cut", -55)).toEqual({ p: 170, c: 105, f: 46, k: 1515, weight: 77.3 });
  });
  it("adjust +100: 칼로리 +100, 탄수만 증가, P·F 불변", () => {
    const base = calcTargets(77.3, 175, 42, "cut");
    const up = calcTargets(77.3, 175, 42, "cut", 100);
    expect(up.p).toBe(base.p);
    expect(up.f).toBe(base.f);
    expect(up.k - base.k).toBe(100);
    expect(up.c).toBeGreaterThan(base.c);
  });
  it("매크로 정합 유지: P×4+F×9+C×4 ≈ K (adjust 있어도)", () => {
    const t = calcTargets(77.3, 175, 42, "cut", -55);
    expect(Math.abs(t.p * 4 + t.f * 9 + t.c * 4 - t.k)).toBeLessThanOrEqual(2);
  });
});

describe("adjustForDate — 이력에서 그 날 유효 보정치", () => {
  const hist = [{ from: "2026-06-01", adjust: -55 }, { from: "2026-07-01", adjust: -80 }];
  it("이력 이전 날짜 → 0", () => { expect(adjustForDate(hist, "2026-05-15")).toBe(0); });
  it("첫 구간 → −55", () => { expect(adjustForDate(hist, "2026-06-15")).toBe(-55); });
  it("경계(from 당일 포함) → 해당 구간", () => { expect(adjustForDate(hist, "2026-07-01")).toBe(-80); });
  it("최신 구간 → −80", () => { expect(adjustForDate(hist, "2026-07-20")).toBe(-80); });
  it("빈/무효 이력 → 0", () => {
    expect(adjustForDate([], "2026-07-01")).toBe(0);
    expect(adjustForDate(null, "2026-07-01")).toBe(0);
    expect(adjustForDate(undefined, "2026-07-01")).toBe(0);
  });
});

describe("periodOf / TIME_PERIODS — 시간대 단일 기준", () => {
  it("0~23시 전체 매핑: 새벽0-5 / 아침6-10 / 점심11-16 / 저녁17-20 / 야간21-23", () => {
    const expected = {
      0: "dawn", 1: "dawn", 2: "dawn", 3: "dawn", 4: "dawn", 5: "dawn",
      6: "morning", 7: "morning", 8: "morning", 9: "morning", 10: "morning",
      11: "lunch", 12: "lunch", 13: "lunch", 14: "lunch", 15: "lunch", 16: "lunch",
      17: "dinner", 18: "dinner", 19: "dinner", 20: "dinner",
      21: "night", 22: "night", 23: "night",
    };
    for (let h = 0; h < 24; h++) expect(periodOf(h).key, `${h}시`).toBe(expected[h]);
  });

  it("hour가 없으면(undefined/null) 새벽으로 폴백", () => {
    expect(periodOf(undefined).key).toBe("dawn");
    expect(periodOf(null).key).toBe("dawn");
  });

  it("구간 무결성: 5개 구간이 빈틈·중복 없이 0~23을 덮는다", () => {
    expect(TIME_PERIODS).toHaveLength(5);
    expect(TIME_PERIODS[0].start).toBe(0);
    expect(TIME_PERIODS[TIME_PERIODS.length - 1].end).toBe(23);
    for (let i = 1; i < TIME_PERIODS.length; i++) {
      expect(TIME_PERIODS[i].start).toBe(TIME_PERIODS[i - 1].end + 1);
    }
  });
});

describe("aggregateDay — 하루 합산", () => {
  it("빈 입력(null/undefined) → 전부 0", () => {
    expect(aggregateDay(null)).toEqual({ p: 0, c: 0, f: 0, k: 0, ex: 0, net: 0 });
    expect(aggregateDay(undefined)).toEqual({ p: 0, c: 0, f: 0, k: 0, ex: 0, net: 0 });
  });

  it("meals는 serving 배수로, exercises는 kcal 합으로, net = k − ex", () => {
    const day = {
      meals: [
        { p: 10, c: 20, f: 5, k: 165, serving: 1.5 },
        { p: 30, c: 0, f: 2, k: 138, serving: 1 },
      ],
      exercises: [{ kcal: 300 }, { kcal: 200 }],
    };
    const a = aggregateDay(day);
    expect(a.p).toBeCloseTo(45);
    expect(a.c).toBeCloseTo(30);
    expect(a.f).toBeCloseTo(9.5);
    expect(a.k).toBeCloseTo(385.5);
    expect(a.ex).toBe(500);
    expect(a.net).toBeCloseTo(-114.5);
  });

  it("meals/exercises 키가 없어도 동작 (kcal 없는 운동은 0 처리)", () => {
    expect(aggregateDay({})).toEqual({ p: 0, c: 0, f: 0, k: 0, ex: 0, net: 0 });
    expect(aggregateDay({ exercises: [{}] }).ex).toBe(0);
  });
});

describe("getWeekKey — ISO 주차", () => {
  it("같은 주(월~일)는 같은 키: 2026-06-08(월)~2026-06-14(일) → 2026-W24", () => {
    expect(getWeekKey("2026-06-08")).toBe("2026-W24");
    expect(getWeekKey("2026-06-11")).toBe("2026-W24");
    expect(getWeekKey("2026-06-14")).toBe("2026-W24");
    expect(getWeekKey("2026-06-15")).toBe("2026-W25");
  });

  it("연말·연초 경계: 2025-12-29(월)은 2026-W01에 속한다", () => {
    expect(getWeekKey("2025-12-29")).toBe("2026-W01");
    expect(getWeekKey("2026-01-01")).toBe("2026-W01");
  });
});
