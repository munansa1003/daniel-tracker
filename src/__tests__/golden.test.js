// 골든셋 — 표준 시료를 순수 계산 계층에 통과시켜 출력 전체를 고정한다.
// 시료: fixtures/golden-sample.json — 실제 백업 파일 형식(BACKUP_SCHEMA) 그대로,
// 결정적으로 생성된 28일치 기록(24일 기록·10회 측정·감량 추세).
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
        // 마지막 날만 maintain 모드(목표 1784) → 같은 1741이어도 적정 판정
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
