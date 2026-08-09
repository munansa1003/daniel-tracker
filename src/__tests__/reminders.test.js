import { describe, it, expect } from "vitest";
import { pendingReminders, daysBetween, reminderPush, weeklyReportPush, mondayOf, REMINDER_DEFAULTS, importSilencePush, IMPORT_SILENCE_DAYS } from "../reminders.js";

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

describe("weeklyReportPush — 월요일 성적표", () => {
  // 2026-07-13 = 월요일, 지난주 월요일 = 2026-07-06
  const MON = "2026-07-13";
  it("월요일이 아니면 null", () => {
    expect(weeklyReportPush(null, "2026-07-14")).toBe(null); // 화요일
    expect(weeklyReportPush(null, "2026-07-12")).toBe(null); // 일요일
  });
  it("월요일 + 지난주 요약 있음 → 수치 포함", () => {
    const wr = { weekStart: "2026-07-06", recorded: 6, calOk: 5, protHit: 4, workouts: 3 };
    const p = weeklyReportPush(wr, MON);
    expect(p.tab).toBe("stats");
    expect(p.tag).toBe("daniel-weekly");
    expect(p.body).toContain("6/7일");
    expect(p.body).toContain("칼로리 적정 5일");
    expect(p.body).toContain("운동 3회");
  });
  it("요약이 옛 주(stale)면 일반 안내", () => {
    const wr = { weekStart: "2026-06-29", recorded: 6, calOk: 5, protHit: 4, workouts: 3 };
    const p = weeklyReportPush(wr, MON);
    expect(p.body).not.toContain("6/7일");
    expect(p.body).toContain("확인");
  });
  it("report 기본 ON + mondayOf 월요일 시작", () => {
    expect(REMINDER_DEFAULTS.report).toBe(true);
    expect(mondayOf("2026-07-13")).toBe("2026-07-13"); // 월
    expect(mondayOf("2026-07-12")).toBe("2026-07-06"); // 일 → 그 주 월
    expect(mondayOf("2026-07-15")).toBe("2026-07-13"); // 수
  });
});

// 자동 수신 침묵 감지 — 2026-08 감사 R-06.
// 감사 전에는 운동 자동 수신이 2주 죽어도 알림이 0건이었다(식단만 기록해도 record
// 리마인더가 충족되므로). 체성분은 7일 체중 리마인더가 유일한 간접 신호였다.
describe("importSilencePush — 자동 수신 침묵", () => {
  const TODAY = "2026-08-09";
  const call = (ex, bd) => importSilencePush({ lastExerciseAt: ex, lastBodyAt: bd, todayStr: TODAY });

  it("기본 임계 5일 + sync 기본 ON", () => {
    expect(IMPORT_SILENCE_DAYS).toBe(5);
    expect(REMINDER_DEFAULTS.sync).toBe(true);
  });
  it("임계 미만이면 침묵 아님", () => {
    expect(call("2026-08-05T08:00:00.000Z", "2026-08-06T08:00:00.000Z")).toBe(null);
  });
  it("경계 — 정확히 5일이면 알린다", () => {
    expect(call("2026-08-04T08:00:00.000Z", null).body).toContain("워치 운동 5일");
  });
  it("운동만 죽으면 운동만 지목한다 (체성분은 정상 유입 중)", () => {
    const p = call("2026-07-26T08:00:00.000Z", "2026-08-09T08:00:00.000Z");
    expect(p.body).toContain("워치 운동 14일");
    expect(p.body).not.toContain("인바디 체성분"); // 채널 라벨 — 끝의 "인바디 연결을 확인" 안내와 구분
    expect(p.tag).toBe("daniel-import-silence");
  });
  it("둘 다 죽으면 한 건에 묶어 보낸다", () => {
    const p = call("2026-07-30T08:00:00.000Z", "2026-07-28T08:00:00.000Z");
    expect(p.body).toContain("워치 운동 10일");
    expect(p.body).toContain("인바디 체성분 12일");
  });
  it("한 번도 들어온 적 없는 경로(null)는 침묵으로 치지 않는다 — 안 쓰는 기능 독촉 금지", () => {
    expect(call(null, null)).toBe(null);
    expect(call(null, "2026-07-01T08:00:00.000Z").body).not.toContain("워치 운동");
  });
  it("손상된 값은 조용히 무시 (로그 파싱 실패·빈 문자열)", () => {
    expect(call("", undefined)).toBe(null);
    expect(call("not-a-date", "2026-08-09T08:00:00.000Z")).toBe(null);
  });
});
