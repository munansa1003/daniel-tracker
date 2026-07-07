import { describe, it, expect } from "vitest";
import { dateInEvent, eventsForDate, activeEvents, isExcludedDate, eventDays, typeMeta } from "../healthEvents.js";

const injury = { id: 1, type: "injury", label: "손목", start: "2026-07-04", end: null, exclude: false };
const illness = { id: 2, type: "illness", label: "장염", start: "2026-06-20", end: "2026-06-23", exclude: true };

describe("dateInEvent", () => {
  it("닫힌 구간 포함/경계", () => {
    expect(dateInEvent("2026-06-20", illness)).toBe(true);
    expect(dateInEvent("2026-06-23", illness)).toBe(true);
    expect(dateInEvent("2026-06-24", illness)).toBe(false);
    expect(dateInEvent("2026-06-19", illness)).toBe(false);
  });
  it("진행중(end=null)은 start 이후 무한", () => {
    expect(dateInEvent("2026-07-04", injury)).toBe(true);
    expect(dateInEvent("2026-12-01", injury)).toBe(true);
    expect(dateInEvent("2026-07-03", injury)).toBe(false);
  });
});

describe("activeEvents", () => {
  it("오늘 걸린 것만, 시작 최신순", () => {
    const r = activeEvents([illness, injury], "2026-07-05");
    expect(r.map((e) => e.id)).toEqual([1]); // 장염은 지남
  });
  it("오늘 회복(end=오늘)도 오늘은 표시 (홈 배지·달력 일관)", () => {
    const ev = { id: 3, type: "injury", start: "2026-07-01", end: "2026-07-05" };
    expect(activeEvents([ev], "2026-07-05").map((e) => e.id)).toEqual([3]);
    expect(activeEvents([ev], "2026-07-06")).toEqual([]); // 회복 다음날 빠짐
  });
});

describe("eventsForDate", () => {
  it("그 날짜의 이벤트", () => {
    expect(eventsForDate([illness, injury], "2026-06-21").map((e) => e.id)).toEqual([2]);
  });
});

describe("isExcludedDate", () => {
  it("exclude=true 구간만 제외", () => {
    expect(isExcludedDate([illness, injury], "2026-06-21")).toBe(true); // 장염 exclude
    expect(isExcludedDate([illness, injury], "2026-07-10")).toBe(false); // 부상은 exclude=false
  });
  it("빈 목록이면 항상 false (정상일 계산 불변 보장)", () => {
    expect(isExcludedDate([], "2026-07-01")).toBe(false);
    expect(isExcludedDate(undefined, "2026-07-01")).toBe(false);
  });
});

describe("eventDays", () => {
  it("닫힌 구간 포함 일수", () => {
    expect(eventDays(illness, "2026-07-05")).toBe(4); // 6/20~6/23
  });
  it("진행중은 start~today", () => {
    expect(eventDays(injury, "2026-07-06")).toBe(3); // 7/4,5,6
  });
});

describe("typeMeta", () => {
  it("키로 메타 조회, 미상은 기타", () => {
    expect(typeMeta("injury").ico).toBe("🤕");
    expect(typeMeta("zzz").name).toBe("기타");
  });
});
