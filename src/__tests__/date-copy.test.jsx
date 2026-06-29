import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DateCopySheet, recentCopyDays, copyDupCount } from "../components/DateCopySheet.jsx";

const m = (n, k, serving = 1) => ({ n, k, serving, p: 0, c: 0, f: 0, hour: 13 });
const ex = (n, kcal, duration = 30) => ({ n, kcal, duration, m: 6, hour: 18 });

const allDays = {
  "2026-06-22": { meals: [m("닭가슴살", 300)], exercises: [ex("러닝", 400)] },
  "2026-06-23": { meals: [m("현미밥", 500)], exercises: [] },
  "2026-06-24": { meals: [], exercises: [ex("웨이트", 200, 45)] },
  "2026-06-26": { meals: [m("오늘밥", 600)], exercises: [] }, // 오늘 → 제외
};

describe("recentCopyDays — 복사 소스 후보일", () => {
  it("식단: 식단 있는 날만·오늘 제외·최신순", () => {
    const d = recentCopyDays(allDays, "diet", "2026-06-26");
    expect(d.map((x) => x.ds)).toEqual(["2026-06-23", "2026-06-22"]); // 06-24는 식단 없음
    expect(d[0].kcal).toBe(500);
    expect(d[1].kcal).toBe(300);
  });
  it("운동: 운동 있는 날만·최신순", () => {
    const d = recentCopyDays(allDays, "exercise", "2026-06-26");
    expect(d.map((x) => x.ds)).toEqual(["2026-06-24", "2026-06-22"]);
    expect(d[0].kcal).toBe(200); // 운동 소모
    expect(d[1].kcal).toBe(400);
  });
  it("라벨에 요일 포함(M.DD (요일))", () => {
    const d = recentCopyDays(allDays, "diet", "2026-06-26");
    const w = ["일", "월", "화", "수", "목", "금", "토"][new Date("2026-06-23T12:00:00").getDay()];
    expect(d[0].label).toBe(`06.23 (${w})`);
  });
});

describe("copyDupCount — 오늘 중복 항목 수", () => {
  it("식단: n+serving 일치 수", () => {
    const existing = [m("닭가슴살", 300), m("밥", 500, 2)];
    expect(copyDupCount(existing, [m("닭가슴살", 300), m("두부", 100)], "diet")).toBe(1);
    expect(copyDupCount(existing, [m("밥", 500, 1)], "diet")).toBe(0); // serving 다름
  });
  it("운동: n+duration 일치 수", () => {
    const existing = [ex("러닝", 400, 30)];
    expect(copyDupCount(existing, [ex("러닝", 400, 30), ex("러닝", 250, 20)], "exercise")).toBe(1);
  });
});

describe("DateCopySheet — 끼니 시트 렌더", () => {
  it("소스일 데이터 있으면 '그날 전체 복사' + 항목 칩", () => {
    const h = renderToStaticMarkup(
      <DateCopySheet type="diet" allDays={allDays} todayStr="2026-06-26" srcDate="2026-06-23"
        onPickDate={() => {}} onCopyItem={() => {}} onCopyGroup={() => {}} onCopyAll={() => {}} />
    );
    expect(h).toContain("그날 전체 복사");
    expect(h).toContain("현미밥");
    expect(h).toContain("점심"); // 13시 → 점심 그룹 헤더
  });
  it("기록 없는 소스일이면 안내", () => {
    const h = renderToStaticMarkup(
      <DateCopySheet type="diet" allDays={allDays} todayStr="2026-06-26" srcDate="2026-06-24"
        onPickDate={() => {}} onCopyItem={() => {}} onCopyGroup={() => {}} onCopyAll={() => {}} />
    );
    expect(h).toContain("이 날짜엔 기록이 없어요");
  });
});
