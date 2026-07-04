import { describe, it, expect } from "vitest";
import { pendingReminders, daysBetween, reminderPush, REMINDER_DEFAULTS } from "../reminders.js";

const base = { reminders: REMINDER_DEFAULTS, recordedToday: true, lastWeighDate: "2026-07-28", todayStr: "2026-07-29", accountMature: true, backupDaysAgo: 0 };

describe("daysBetween", () => {
  it("일수 차이", () => {
    expect(daysBetween("2026-07-22", "2026-07-29")).toBe(7);
    expect(daysBetween("2026-07-29", "2026-07-29")).toBe(0);
  });
});

describe("pendingReminders", () => {
  it("조건 없으면 빈 배열", () => {
    expect(pendingReminders(base)).toEqual([]);
  });
  it("오늘 미기록 → record 배너", () => {
    expect(pendingReminders({ ...base, recordedToday: false })).toEqual([{ key: "record" }]);
  });
  it("체중 7일 이상 미측정 → weight 배너(경과일 포함)", () => {
    const r = pendingReminders({ ...base, lastWeighDate: "2026-07-20" }); // 9일 전
    expect(r).toEqual([{ key: "weight", days: 9 }]);
  });
  it("체중 기록 아예 없음 → weight 배너", () => {
    expect(pendingReminders({ ...base, lastWeighDate: null })[0].key).toBe("weight");
  });
  it("백업 15일+ & 계정 성숙 → backup 배너", () => {
    expect(pendingReminders({ ...base, backupDaysAgo: 20 })).toEqual([{ key: "backup", days: 20 }]);
  });
  it("계정 미성숙이면 backup 안 뜸", () => {
    expect(pendingReminders({ ...base, backupDaysAgo: 20, accountMature: false })).toEqual([]);
  });
  it("토글 OFF면 해당 배너 안 뜸", () => {
    const off = { record: false, weight: false, backup: false };
    expect(pendingReminders({ ...base, reminders: off, recordedToday: false, lastWeighDate: null, backupDaysAgo: 30 })).toEqual([]);
  });
  it("여러 조건 동시 → 다건", () => {
    const r = pendingReminders({ ...base, recordedToday: false, lastWeighDate: "2026-07-10", backupDaysAgo: 20 });
    expect(r.map((x) => x.key)).toEqual(["record", "weight", "backup"]);
  });
});

describe("reminderPush", () => {
  it("빈 목록 → null", () => {
    expect(reminderPush([])).toBe(null);
    expect(reminderPush(null)).toBe(null);
  });
  it("우선순위: 여러 건이면 기록 > 체중 > 백업 중 하나만", () => {
    const p = reminderPush([{ key: "backup", days: 20 }, { key: "weight", days: 9 }, { key: "record" }]);
    expect(p.tab).toBe("diet");
    expect(p.title).toContain("기록");
  });
  it("체중 배너는 경과일을 본문에 반영", () => {
    expect(reminderPush([{ key: "weight", days: 9 }]).body).toContain("9일");
    expect(reminderPush([{ key: "weight", days: 999 }]).body).toContain("아직 없어요");
  });
  it("백업 배너 tab=home", () => {
    const p = reminderPush([{ key: "backup", days: 30 }]);
    expect(p.tab).toBe("home");
    expect(p.body).toContain("30일");
  });
});
