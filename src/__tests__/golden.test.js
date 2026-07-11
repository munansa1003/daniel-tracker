// 골든셋 — 표준 시료를 순수 계산 계층에 통과시켜 출력 전체를 고정한다.
// 시료: fixtures/golden-sample.json — 실제 백업 파일 형식(BACKUP_SCHEMA) 그대로,
// 결정적으로 생성된 기록 38일치(2026-05-15~06-30)·체성분 10회 측정·감량 추세.
// 이 값들이 바뀌는 것은 계산 로직이 바뀌었다는 뜻이다. 의도된 변경이라면
// 왜 바뀌는지 확인하고 골든 값을 갱신하되, 의도가 없다면 회귀다.
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/golden-sample.json";
import { validateBackup, summarizeBackup } from "../backup.js";
import { bodyMetrics } from "../bodyMetrics.js";
import { calcTargets, aggregateDay } from "../utils.js";
import { estimateTDEE } from "../adaptiveTDEE.js";
import { buildCalorieSeries } from "../components/CalorieBandChart.jsx";
import { buildWeekdayTotals } from "../components/WeekdayRadar.jsx";

const TODAY = "2026-07-01"; // 시료 기준일(마지막 기록 다음날) — 고정
const PROFILE = { height: 175, age: 35 };
const days = fixture.data.days;
const bodylog = fixture.data.bodylog;
const latest = bodylog[bodylog.length - 1];
const prev = bodylog[bodylog.length - 2];

describe("골든셋: 표준 시료 무결성", () => {
  it("실제 백업 스키마(validateBackup)를 통과한다", () => {
    expect(validateBackup(fixture)).toEqual({ ok: true });
  });
  it("요약 건수·기간이 고정값과 일치한다", () => {
    expect(summarizeBackup(fixture)).toEqual({
      exportedAt: "2026-07-01T09:00:00.000Z",
      days: 38, firstDay: "2026-05-15", lastDay: "2026-06-30",
      bodyLog: 10, customFoods: 1, customExercises: 1,
    });
  });
});

describe("골든셋: 체성분 파생 지표 (bodyMetrics)", () => {
  it("최신·직전 측정 기준 전체 지표", () => {
    expect(bodyMetrics(latest, prev, PROFILE)).toEqual({
      bmi: 25.3, bmr: 1699, fatMass: 16.4, leanMass: 61.1,
      idealWeight: 67.4, weightAdj: -10.1,
      stdWeight: 67.4, stdMuscle: 34.1, stdFatPct: 15,
      dW: 0.1, dM: 0.1, dF: -0.2, dS: 1,
    });
  });
  it("기록 없음 폴백 (latest=undefined → 0/null)", () => {
    expect(bodyMetrics(undefined, null, PROFILE)).toEqual({
      bmi: 0, bmr: 0, fatMass: 0, leanMass: 0,
      idealWeight: 67.4, weightAdj: 0,
      stdWeight: 67.4, stdMuscle: 34.1, stdFatPct: 15,
      dW: null, dM: null, dF: null, dS: null,
    });
  });
});

describe("골든셋: 목표·합산·TDEE 역산", () => {
  it("calcTargets — cut/maintain", () => {
    expect(calcTargets(latest.weight, PROFILE.height, PROFILE.age, "cut", 0))
      .toEqual({ p: 171, c: 126, f: 47, k: 1609, weight: 77.5 });
    expect(calcTargets(latest.weight, PROFILE.height, PROFILE.age, "maintain", 0))
      .toEqual({ p: 171, c: 169, f: 47, k: 1784, weight: 77.5 });
  });
  it("aggregateDay — 2026-06-05 하루 합산", () => {
    expect(aggregateDay(days["2026-06-05"]))
      .toEqual({ p: 89, c: 185, f: 35, k: 1423, ex: 520, net: 903 });
  });
  it("estimateTDEE — 28일 창 역산 전체 결과", () => {
    const bmr = bodyMetrics(latest, prev, PROFILE).bmr;
    expect(estimateTDEE(bodylog, days, TODAY, bmr, 28)).toEqual({
      windowDays: 28, loggedDays: 24, weighIns: 10,
      valid: true, confident: true,
      avgIntake: 1576, avgExercise: 236, deltaWeight: -1.4,
      measuredTDEE: 1973, measuredMaint: 1737, formulaMaint: 1784,
      delta: -47,
    });
  });
});

describe("골든셋: 기간 차트 시리즈", () => {
  const targetsByMode = { cut: { k: 1609 }, maintain: { k: 1784 } };
  it("buildCalorieSeries — 1달 섭취 시리즈 (그 날의 모드로 판정)", () => {
    expect(buildCalorieSeries(days, targetsByMode, "cut", "1m", TODAY)).toEqual({
      points: [
        { k: 1578, ok: true }, { k: 1586, ok: true }, { k: 1423, ok: true },
        { k: 1741, ok: false }, { k: 1586, ok: true }, { k: 1578, ok: true },
        { k: 1586, ok: true }, { k: 1423, ok: true }, { k: 1741, ok: false },
        { k: 1423, ok: true }, { k: 1586, ok: true }, { k: 1586, ok: true },
        { k: 1423, ok: true }, { k: 1741, ok: false }, { k: 1423, ok: true },
        { k: 1586, ok: true }, { k: 1578, ok: true }, { k: 1586, ok: true },
        { k: 1741, ok: false }, { k: 1423, ok: true }, { k: 1586, ok: true },
        { k: 1578, ok: true }, { k: 1586, ok: true },
        // 마지막 날(06-30)만 maintain 모드가 판정을 뒤집는다(목표 1784 → 같은 1741도 적정).
        // 다른 maintain일(06-09·06-16)은 값이 cut 목표(1609) 이하라 모드와 무관하게 적정.
        { k: 1741, ok: true },
      ],
      targetK: 1609, min: 1423, max: 1741, overCount: 4, n: 24,
    });
  });
  it("buildWeekdayTotals — 요일별(월~일) 운동 소모 합", () => {
    expect(buildWeekdayTotals(days, "1m", TODAY))
      .toEqual([325, 520, 832, 832, 1157, 1157, 845]);
  });
  it("buildCalorieSeries — 3개월: 30점 초과 균등 샘플링 + 운동 되먹기 판정", () => {
    // 38일 기록 > MAX 30 → 균등 샘플링 분기 실행(n:30에 고정).
    // 4번째 점(05-20): 섭취 1741 > 목표 1609이지만 운동 400×0.5 되먹기로 적정 — 되먹기 존재를 고정.
    // 7번째 점(05-25): 섭취 1901, 운동 400 → 0.5 계수로는 초과(1.0이었다면 적정) — 계수 값을 고정.
    expect(buildCalorieSeries(days, targetsByMode, "cut", "3m", TODAY)).toEqual({
      points: [
        { k: 1578, ok: true }, { k: 1586, ok: true }, { k: 1423, ok: true },
        { k: 1741, ok: true }, { k: 1578, ok: true }, { k: 1586, ok: true },
        { k: 1901, ok: false }, { k: 1586, ok: true }, { k: 1578, ok: true },
        { k: 1423, ok: true }, { k: 1423, ok: true }, { k: 1578, ok: true },
        { k: 1586, ok: true }, { k: 1741, ok: false }, { k: 1586, ok: true },
        { k: 1578, ok: true }, { k: 1586, ok: true }, { k: 1741, ok: false },
        { k: 1423, ok: true }, { k: 1586, ok: true }, { k: 1423, ok: true },
        { k: 1741, ok: false }, { k: 1423, ok: true }, { k: 1586, ok: true },
        { k: 1586, ok: true }, { k: 1741, ok: false }, { k: 1423, ok: true },
        { k: 1586, ok: true }, { k: 1586, ok: true }, { k: 1741, ok: true },
      ],
      targetK: 1609, min: 1423, max: 1901, overCount: 5, n: 30,
    });
  });
});

// 무결성 게이트 — 기대값 동결(위)과 별개로, 시료 자체가 물리적·구조적으로
// 정상 범위인지 검증한다. 시료를 손댈 때 오염(NaN·범위 이탈·날짜 역전·필드 누락)이
// 몰래 들어오는 것을 막는 안전망. 현재 시료는 전부 통과하며, 이 경계가 깨지면
// 시료가 손상된 것이다.
describe("골든셋: 시료 무결성 (스키마·물리 범위·단조·NaN)", () => {
  it("백업 JSON 필수 필드가 모두 존재한다 (스키마 체크)", () => {
    expect(fixture.app).toBe("daniel-tracker");
    expect(fixture.schema).toBe(1);
    expect(typeof fixture.exportedAt).toBe("string");
    expect(typeof fixture.data).toBe("object");
    for (const key of ["days", "bodylog", "goals", "customFoods", "customExercises"]) {
      expect(fixture.data, `data.${key} 누락`).toHaveProperty(key);
    }
    for (const b of bodylog) {
      for (const key of ["date", "weight", "muscle", "fatPct", "score"]) {
        expect(b, `bodylog ${b.date} — ${key} 누락`).toHaveProperty(key);
      }
    }
  });

  it("행 수 > 0 (기록·측정이 비어 있지 않다)", () => {
    expect(Object.keys(days).length).toBeGreaterThan(0);
    expect(bodylog.length).toBeGreaterThan(0);
  });

  it("체성분 측정값이 물리적 범위 안에 있다 (체중 40~150 · 체지방 3~60 · 골격근 < 체중)", () => {
    for (const b of bodylog) {
      expect(b.weight, `${b.date} 체중`).toBeGreaterThanOrEqual(40);
      expect(b.weight, `${b.date} 체중`).toBeLessThanOrEqual(150);
      expect(b.fatPct, `${b.date} 체지방률`).toBeGreaterThanOrEqual(3);
      expect(b.fatPct, `${b.date} 체지방률`).toBeLessThanOrEqual(60);
      expect(b.muscle, `${b.date} 골격근량 < 체중`).toBeLessThan(b.weight);
    }
  });

  it("bodylog 측정일이 순증가하고, days 키가 모두 실재 날짜다", () => {
    // bodylog은 순서가 의미 있는 배열 → 측정일이 strict 순증가해야 한다(역전·중복 차단).
    for (let i = 1; i < bodylog.length; i++) {
      expect(
        bodylog[i].date > bodylog[i - 1].date,
        `bodylog 날짜 역전: ${bodylog[i - 1].date} → ${bodylog[i].date}`
      ).toBe(true);
    }
    // days는 맵이라 키 순서엔 검증 가능한 불변식이 없다(키는 유일 → 정렬하면 항상 순증가 = 공허).
    // 대신 각 키가 형식·달력상 실재하는 날짜인지 본다(2026-02-30·2026-13-99 같은 오염 차단).
    for (const key of Object.keys(days)) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
      expect(m, `days 키가 YYYY-MM-DD 형식이 아님: ${key}`).not.toBeNull();
      const [, y, mo, d] = m.map(Number);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      expect(
        dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d,
        `days 키가 실재하지 않는 날짜(롤오버): ${key}`
      ).toBe(true);
    }
  });

  it("파생 지표·합산·시리즈에 NaN이 없다", () => {
    const allFinite = (obj) =>
      Object.values(obj).every((v) => v === null || typeof v !== "number" || Number.isFinite(v));
    // 원시 측정값 자체가 유한수여야 한다 (weight/muscle/fatPct/score 오염 → 파생 NaN 전파 차단).
    for (const b of bodylog) {
      for (const key of ["weight", "muscle", "fatPct", "score"]) {
        expect(Number.isFinite(b[key]), `bodylog ${b.date}.${key} 비유한수: ${b[key]}`).toBe(true);
      }
    }
    const bmr = bodyMetrics(latest, prev, PROFILE).bmr;
    expect(allFinite(bodyMetrics(latest, prev, PROFILE))).toBe(true);
    expect(allFinite(calcTargets(latest.weight, PROFILE.height, PROFILE.age, "cut", 0))).toBe(true);
    expect(allFinite(estimateTDEE(bodylog, days, TODAY, bmr, 28))).toBe(true);
    for (const ds of Object.keys(days)) {
      expect(allFinite(aggregateDay(days[ds])), `aggregateDay(${ds})`).toBe(true);
    }
    const series = buildCalorieSeries(days, { cut: { k: 1609 }, maintain: { k: 1784 } }, "cut", "3m", TODAY);
    expect(series.points.every((p) => Number.isFinite(p.k))).toBe(true);
    expect([series.targetK, series.min, series.max, series.overCount, series.n].every(Number.isFinite)).toBe(true);
    expect(buildWeekdayTotals(days, "1m", TODAY).every(Number.isFinite)).toBe(true);
  });
});
