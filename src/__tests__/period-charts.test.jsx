import { describe, it, expect } from "vitest";
import { periodStart } from "../utils.js";
import { buildCalorieSeries } from "../components/CalorieBandChart.jsx";
import { buildWeekdayTotals } from "../components/WeekdayRadar.jsx";

const TBM = { cut: { p: 165, c: 120, f: 45, k: 1546 }, maintain: { p: 165, c: 164, f: 45, k: 1721 } };
const meal = (k) => ({ meals: [{ k, serving: 1, p: 0, c: 0, f: 0 }], exercises: [] });
const ex = (kcal) => ({ meals: [], exercises: [{ kcal }] });

describe("periodStart — 기간 시작일", () => {
  it("1주/1달/3개월/전체", () => {
    expect(periodStart("1w", "2026-06-26")).toBe("2026-06-19");
    expect(periodStart("1m", "2026-06-26")).toBe("2026-05-26");
    expect(periodStart("3m", "2026-06-26")).toBe("2026-03-26");
    expect(periodStart("all", "2026-06-26")).toBe("0000-00-00");
  });
});

describe("buildCalorieSeries (D1) — 칼로리 시리즈·판정", () => {
  const allDays = {
    "2026-06-10": meal(1400), // 적정
    "2026-06-11": meal(1700), // 초과(1700 > 1546)
    "2026-06-12": meal(1500), // 적정
    "2026-06-26": meal(900),  // 오늘 → 제외
  };

  it("전체 기간: n=3(오늘 제외), 초과 1일, 목표 1546", () => {
    const s = buildCalorieSeries(allDays, TBM, "cut", "all", "2026-06-26");
    expect(s.n).toBe(3);
    expect(s.overCount).toBe(1);
    expect(s.targetK).toBe(1546);
    expect(s.min).toBe(1400);
    expect(s.max).toBe(1700);
  });

  it("그 날의 모드로 판정: maintain일(1700)은 목표 1721 → 적정", () => {
    const dd = { ...meal(1700), mode: "maintain" };
    const s = buildCalorieSeries({ "2026-06-13": dd }, TBM, "cut", "all", "2026-06-26");
    expect(s.n).toBe(1);
    expect(s.overCount).toBe(0); // 1700 ≤ 1721
  });

  it("기간 필터: 1주(06-19~)면 06-10~12는 제외 → n=0", () => {
    const s = buildCalorieSeries(allDays, TBM, "cut", "1w", "2026-06-26");
    expect(s.n).toBe(0);
  });

  it("운동 되먹기 반영: 섭취 1800·운동 600(감량 50%)이면 목표+300=1846 → 적정", () => {
    const dd = { meals: [{ k: 1800, serving: 1, p: 0, c: 0, f: 0 }], exercises: [{ kcal: 600 }] };
    const s = buildCalorieSeries({ "2026-06-14": dd }, TBM, "cut", "all", "2026-06-26");
    expect(s.overCount).toBe(0);
  });
});

describe("buildWeekdayTotals (E9) — 요일별 소모 합산", () => {
  const allDays = {
    "2026-06-22": ex(500),
    "2026-06-23": ex(300),
    "2026-06-24": { meals: [], exercises: [] }, // 운동 0 → 제외
    "2026-06-26": ex(999), // 오늘 → 제외
  };

  it("운동 있는 날만, 오늘 제외 → 합 800", () => {
    const t = buildWeekdayTotals(allDays, "all", "2026-06-26");
    expect(t.reduce((a, b) => a + b, 0)).toBe(800);
  });

  it("올바른 요일 버킷(월=0…일=6)에 누적", () => {
    const t = buildWeekdayTotals(allDays, "all", "2026-06-26");
    const wd22 = (new Date("2026-06-22T12:00:00").getDay() + 6) % 7;
    const wd23 = (new Date("2026-06-23T12:00:00").getDay() + 6) % 7;
    expect(t[wd22]).toBe(500);
    expect(t[wd23]).toBe(300);
  });

  it("기간 필터: 1주(06-19~)면 포함 / 1달 밖 데이터는 제외", () => {
    const old = { "2026-04-01": ex(700), "2026-06-22": ex(500) };
    expect(buildWeekdayTotals(old, "1w", "2026-06-26").reduce((a, b) => a + b, 0)).toBe(500);
    expect(buildWeekdayTotals(old, "all", "2026-06-26").reduce((a, b) => a + b, 0)).toBe(1200);
  });
});
