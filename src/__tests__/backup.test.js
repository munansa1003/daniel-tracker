import { describe, it, expect } from "vitest";
import { buildBackup, validateBackup, summarizeBackup, BACKUP_SCHEMA } from "../backup.js";

const state = {
  allDays: {
    "2026-07-01": { meals: [{ n: "닭가슴살", k: 165, serving: 1 }], exercises: [{ n: "조깅", kcal: 300 }], mode: "cut" },
    "2026-07-02": { meals: [], exercises: [] },
  },
  bodyLog: [{ date: "2026-07-01", weight: 77.9, muscle: 39.2, fatPct: 21.5 }],
  goals: { mode: "cut", reminders: { record: true }, healthEvents: [] },
  customFoods: [{ n: "내음식", k: 100 }],
  customExercises: [],
};

describe("buildBackup + validateBackup 왕복", () => {
  it("만든 백업은 항상 유효", () => {
    const b = buildBackup(state, "2026-07-07T12:00:00Z");
    expect(b.schema).toBe(BACKUP_SCHEMA);
    expect(validateBackup(b).ok).toBe(true);
    // JSON 직렬화 왕복 후에도 유효 + 데이터 보존
    const round = JSON.parse(JSON.stringify(b));
    expect(validateBackup(round).ok).toBe(true);
    expect(round.data.days["2026-07-01"].meals[0].n).toBe("닭가슴살");
    expect(round.data.bodylog[0].weight).toBe(77.9);
    expect(round.data.goals.mode).toBe("cut");
  });
});

describe("validateBackup — 불량 파일 거부", () => {
  const good = () => JSON.parse(JSON.stringify(buildBackup(state, "2026-07-07T12:00:00Z")));
  it("다른 앱/버전/비객체 거부", () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup({ app: "other", schema: 1, data: {} }).ok).toBe(false);
    const b = good(); b.schema = 99;
    expect(validateBackup(b).ok).toBe(false);
  });
  it("날짜 키·일별 형식 오류 거부", () => {
    const b1 = good(); b1.data.days["bad-key"] = { meals: [] };
    expect(validateBackup(b1).ok).toBe(false);
    const b2 = good(); b2.data.days["2026-07-03"] = { meals: "not-array" };
    expect(validateBackup(b2).ok).toBe(false);
  });
  it("bodylog 형식 오류 거부", () => {
    const b = good(); b.data.bodylog = [{ date: "2026-07-01" }]; // weight 없음
    expect(validateBackup(b).ok).toBe(false);
    const b2 = good(); b2.data.bodylog = "nope";
    expect(validateBackup(b2).ok).toBe(false);
  });
  it("goals 형식 오류 거부", () => {
    const b = good(); b.data.goals = [];
    expect(validateBackup(b).ok).toBe(false);
  });
});

describe("summarizeBackup", () => {
  it("건수·기간 요약", () => {
    const s = summarizeBackup(buildBackup(state, "2026-07-07T12:00:00Z"));
    expect(s.days).toBe(2);
    expect(s.firstDay).toBe("2026-07-01");
    expect(s.lastDay).toBe("2026-07-02");
    expect(s.bodyLog).toBe(1);
    expect(s.customFoods).toBe(1);
    expect(s.exportedAt).toBe("2026-07-07T12:00:00Z");
  });
});
