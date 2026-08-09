import { describe, it, expect } from "vitest";
import { calcTargets, periodOf, TIME_PERIODS, aggregateDay, getWeekKey, exFeedback, isCalOk, MODE_DEFICIT, MODE_FEEDBACK, adjustForDate, REST_K, REST_EX_REVERT, restTargets, effectiveDayMode, monthAvgWeights, weightForMonth, makeDayTargets } from "../utils.js";
import { fatMassOf, bodyMetrics } from "../bodyMetrics.js";

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
  it("운동 되먹기 계수: 감량 0.5 / 유지 1.0 / 휴식일 0", () => {
    expect(exFeedback("cut")).toBe(0.5);
    expect(exFeedback("maintain")).toBe(1);
    expect(exFeedback("rest")).toBe(0); // 휴식일 프리셋: 고정 목표라 되먹기 없음
    expect(exFeedback(undefined)).toBe(0.5); // 폴백 = cut
    expect(MODE_DEFICIT).toEqual({ cut: 175, maintain: 0 });
    // rest: 0 확장 — 휴식일 프리셋(고정 1,675)은 운동 되먹기가 없어야 "항상 같은 숫자"가 성립.
    // 300kcal 초과 운동은 effectiveDayMode가 훈련일로 복귀시키므로 되먹기 손실도 없다.
    expect(MODE_FEEDBACK).toEqual({ cut: 0.5, maintain: 1, rest: 0 });
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

describe("휴식일 프리셋 — restTargets / effectiveDayMode / 판정", () => {
  it("restTargets: K는 고정 1,675, P·F는 체중 공식 그대로, C는 나머지", () => {
    expect(REST_K).toBe(1675);
    expect(restTargets(75)).toEqual({ p: 165, c: 153, f: 45, k: 1675, weight: 75 });
    expect(restTargets(77.3)).toEqual({ p: 170, c: 145, f: 46, k: 1675, weight: 77.3 });
  });
  it("restTargets: 체중이 달라도 K는 불변(고정 안전선), 매크로 정합 유지", () => {
    for (const w of [70, 75, 80, 85]) {
      const t = restTargets(w);
      expect(t.k).toBe(1675);
      expect(t.p).toBe(Math.round(w * 2.2));
      expect(t.f).toBe(Math.round(w * 0.6));
      expect(Math.abs(t.p * 4 + t.f * 9 + t.c * 4 - t.k)).toBeLessThanOrEqual(2);
    }
  });
  it("effectiveDayMode: 도장 + 운동 ≤300 → rest, 300 초과 → 훈련일 공식 자동 복귀", () => {
    const rest = { dayType: "rest" };
    expect(effectiveDayMode(rest, 0, "cut")).toBe("rest");
    expect(effectiveDayMode(rest, REST_EX_REVERT, "cut")).toBe("rest");      // 딱 300은 휴식일 유지
    expect(effectiveDayMode(rest, REST_EX_REVERT + 1, "cut")).toBe("cut");   // 301부터 복귀
    expect(effectiveDayMode(rest, 300.4, "cut")).toBe("rest");               // 반올림 기준(표시값과 동일)
  });
  it("effectiveDayMode: 도장 없는 날·train 확정·유지 모드는 원래 모드 그대로", () => {
    expect(effectiveDayMode(undefined, 0, "cut")).toBe("cut");
    expect(effectiveDayMode({}, 0, "cut")).toBe("cut");
    expect(effectiveDayMode({ dayType: "train" }, 0, "cut")).toBe("cut");
    // 유지 모드는 목표(유지 칼로리)가 이미 프리셋보다 관대 — 도장 무시
    expect(effectiveDayMode({ dayType: "rest" }, 0, "maintain")).toBe("maintain");
  });
  it("판정: rest 모드는 되먹기 0 — 고정 1,675 하나로만 판정", () => {
    expect(isCalOk(1650, 0, REST_K, "rest")).toBe(true);    // 회식 1,650 → ✓ (여유 25)
    expect(isCalOk(1675.4, 0, REST_K, "rest")).toBe(true);  // 표시값 1675 = 목표
    expect(isCalOk(1676, 0, REST_K, "rest")).toBe(false);
    expect(isCalOk(1700, 200, REST_K, "rest")).toBe(false); // 운동 200을 해도 목표는 그대로 1,675
  });
  it("복귀 문턱에 절벽 없음: 301kcal 운동 복귀 시 훈련일 유효목표가 1,675보다 크거나 같다", () => {
    // 사용자 실측 기준(훈련일 기초 ≈1,536)에서 1536 + round(301×0.5) = 1687 ≥ 1675
    expect(1536 + Math.round((REST_EX_REVERT + 1) * 0.5)).toBeGreaterThanOrEqual(REST_K);
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

/* ── 날짜별 목표 기준 (2026-08 감사 R-10) ──────────────────────────────
   목표는 "그 달 평균 측정 체중"에서 나오는데, 그 평균을 **보고 있는 날짜**의 달에서
   뽑고 있었다. 같은 과거 날의 ✓/✗가 달력을 어디로 넘겼는지에 따라 달라졌고,
   새 측정 1건이 그 달 전체 판정을 소급으로 움직였다. 이제 그 날짜의 달로 고정한다. */
describe("monthAvgWeights / weightForMonth", () => {
  const log = [
    { date: "2026-06-05", weight: 78 }, { date: "2026-06-25", weight: 76 },
    { date: "2026-08-01", weight: 75 },
  ];
  it("달별 평균 — 측정이 없는 달은 키 자체가 없다", () => {
    const m = monthAvgWeights(log);
    expect(m["2026-06"]).toBe(77);
    expect(m["2026-08"]).toBe(75);
    expect(m["2026-07"]).toBeUndefined();
  });
  it("체중 없는/손상된 항목은 무시", () => {
    expect(monthAvgWeights([{ date: "2026-06-01", weight: 0 }, null, { weight: 70 }])).toEqual({});
    expect(monthAvgWeights(null)).toEqual({});
  });
  it("측정 없는 달은 가장 가까운 '이전' 달을 쓴다 (미래 체중으로 과거를 판정하지 않는다)", () => {
    const m = monthAvgWeights(log);
    expect(weightForMonth(m, "2026-07", 99)).toBe(77);   // 6월 평균
    expect(weightForMonth(m, "2026-09", 99)).toBe(75);   // 8월 평균
  });
  it("이전 달이 없으면 가장 이른 달, 기록이 아예 없으면 fallback", () => {
    expect(weightForMonth(monthAvgWeights(log), "2025-01", 99)).toBe(77);
    expect(weightForMonth({}, "2026-07", 99)).toBe(99);
  });
});

describe("makeDayTargets — 그 날짜 기준 목표", () => {
  const bodyLog = [
    { date: "2025-10-05", weight: 80 }, { date: "2025-10-25", weight: 79 },
    { date: "2026-07-05", weight: 75 },
  ];
  const dt = makeDayTargets({ bodyLog, height: 175, age: 42, fallbackWeight: 75, tdeeHistory: [] });

  it("같은 날짜는 언제 물어도 같은 답 (보는 시점 비의존 — R-10의 핵심 성질)", () => {
    expect(dt("cut", "2025-10-09")).toEqual(dt("cut", "2025-10-09"));
    // 10월은 10월 평균(79.5kg), 7월은 7월 평균(75kg) — 서로 다른 기준
    expect(dt("cut", "2025-10-09").k).toBeGreaterThan(dt("cut", "2026-07-09").k);
  });
  it("그 달 평균과 직접 계산이 일치한다", () => {
    expect(dt("cut", "2025-10-09")).toEqual(calcTargets(79.5, 175, 42, "cut", 0));
    expect(dt("maintain", "2026-07-09")).toEqual(calcTargets(75, 175, 42, "maintain", 0));
  });
  it("휴식일은 그 달 체중으로 P·F만 재고 K는 항상 1,675", () => {
    expect(dt("rest", "2025-10-09").k).toBe(REST_K);
    expect(dt("rest", "2025-10-09")).toEqual(restTargets(79.5));
  });
  it("그 날 유효 보정치를 반영하고, 옛 산식과 정수 보정에서 동일하다", () => {
    const hist = [{ from: "2026-06-01", adjust: -55 }];
    const d2 = makeDayTargets({ bodyLog, height: 175, age: 42, fallbackWeight: 75, tdeeHistory: hist });
    expect(d2("cut", "2026-07-09").k).toBe(calcTargets(75, 175, 42, "cut", -55).k);
    expect(d2("cut", "2025-10-09").k).toBe(calcTargets(79.5, 175, 42, "cut", 0).k); // 이력 이전 → 보정 0
    // 옛 산식 `현재목표K − 현재보정 + 그날보정`과 수학적으로 동일(round(x+a)−a+b = round(x)+b)
    const appAdjust = -55;
    const legacy = calcTargets(75, 175, 42, "cut", appAdjust).k - appAdjust + adjustForDate(hist, "2026-07-09");
    expect(d2("cut", "2026-07-09").k).toBe(legacy);
  });
  it("체중 기록이 없으면 fallback으로 동작 (크래시 없음)", () => {
    const empty = makeDayTargets({ bodyLog: [], fallbackWeight: 75 });
    expect(empty("cut", "2026-07-09").k).toBe(calcTargets(75, 175, 35, "cut", 0).k);
  });
});

/* aggregateDay 결측 방어 — 2026-08 감사 R-28.
   serving이나 매크로가 빠진 항목 하나가 합계를 NaN으로 만들면, estimateTDEE의
   `a.k > 0` 게이트에서 false가 되어 그 날이 통째로 계산에서 조용히 빠졌다. */
describe("aggregateDay — 결측 필드 방어", () => {
  it("serving이 없으면 1인분으로 센다 (NaN 전파 없음)", () => {
    const a = aggregateDay({ meals: [{ p: 10, c: 20, f: 5, k: 200 }], exercises: [] });
    expect(a).toMatchObject({ p: 10, c: 20, f: 5, k: 200 });
    expect(Number.isFinite(a.net)).toBe(true);
  });
  it("매크로가 빠진 항목은 0으로 세되 그 날은 살린다", () => {
    const a = aggregateDay({ meals: [{ k: 300, serving: 1 }, { p: 5, c: 5, f: 5, k: 100, serving: 2 }], exercises: [] });
    expect(a.k).toBe(500);
    expect(a.p).toBe(10);
    expect(Number.isNaN(a.c)).toBe(false);
  });
  it("null 항목·깨진 운동도 크래시 없이 건너뛴다", () => {
    const a = aggregateDay({ meals: [null], exercises: [null, { kcal: "300" }, { kcal: 200 }] });
    expect(a).toMatchObject({ p: 0, c: 0, f: 0, k: 0, ex: 200 });
  });
  it("정상 데이터의 결과는 그대로 (기존 동작 불변)", () => {
    const a = aggregateDay({ meals: [{ p: 10, c: 20, f: 5, k: 200, serving: 1.5 }], exercises: [{ kcal: 300 }] });
    expect(a).toEqual({ p: 15, c: 30, f: 7.5, k: 300, ex: 300, net: 0 });
  });
});

/* 체지방량 단일 출처 — 감사 R-33 (CLAUDE.md 지침 위반 시정).
   analysisExport가 같은 식을 인라인으로 다시 구현하고 있었다. 지금은 값이 같지만
   반올림 자리수 하나만 달라져도 화면(BodyTab)과 내보내기가 조용히 어긋난다. */
describe("fatMassOf — 체지방량(kg)", () => {
  it("체중 × 체지방률, 소수 1자리", () => {
    expect(fatMassOf(75.7, 18.2)).toBe(13.8);
    expect(fatMassOf(80, 25)).toBe(20);
  });
  it("bodyMetrics의 fatMass와 항상 같은 값 (두 경로가 갈라지지 않는다)", () => {
    const latest = { date: "2026-08-09", weight: 73.6, fatPct: 18.7, muscle: 39.2 };
    expect(bodyMetrics(latest, null, { height: 178, age: 42 }).fatMass).toBe(fatMassOf(73.6, 18.7));
  });
  it("값이 없거나 깨졌으면 0 (NaN을 화면으로 흘리지 않는다)", () => {
    expect(fatMassOf(0, 18)).toBe(0);
    expect(fatMassOf(75, NaN)).toBe(0);
    expect(fatMassOf(undefined, undefined)).toBe(0);
  });
});
