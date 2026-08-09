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

  // 백업 파일은 클라우드·메일로 옮겨진다. shareLink({token,expiresAt})는 로그인 없이
  // 열리는 URL의 전체 권한이므로 파일에 실리면 안 된다 — 2026-08 감사 R-07.
  it("공유 링크 토큰은 백업에 담기지 않는다 (파일 유출 = 링크 유출 차단)", () => {
    const withLink = {
      ...state,
      goals: { ...state.goals, shareLink: { token: "a".repeat(32), expiresAt: 1_800_000_000_000, createdAt: 1 } },
    };
    const b = buildBackup(withLink, "2026-07-07T12:00:00Z");
    expect(b.data.goals.shareLink).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain("a".repeat(32));
    // 나머지 goals는 그대로 — 토큰만 걷어낸다
    expect(b.data.goals.mode).toBe("cut");
    expect(b.data.goals.reminders).toEqual({ record: true });
    expect(validateBackup(b).ok).toBe(true);
  });

  it("goals가 없어도 안전 (빈 객체)", () => {
    const b = buildBackup({ ...state, goals: undefined }, "2026-07-07T12:00:00Z");
    expect(b.data.goals).toEqual({});
    expect(validateBackup(b).ok).toBe(true);
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

/* 프로필(키·나이)은 목표 계산의 입력 — 2026-08 감사 R-43.
   백업에 없으면 복원 후 기본값(175cm/35세)으로 폴백해 목표 kcal이 조용히 달라진다. */
describe("buildBackup — 프로필 포함", () => {
  it("프로필이 있으면 백업에 담기고 복원 가능하다", () => {
    const b = buildBackup({ ...state, profile: { name: "다니엘", height: 178, age: 42 } }, "2026-07-07T12:00:00Z");
    expect(b.data.profile).toEqual({ name: "다니엘", height: 178, age: 42 });
    expect(validateBackup(b).ok).toBe(true);
  });
  it("프로필이 없으면 키 자체를 생략 (구버전 백업과 바이트 동일)", () => {
    const b = buildBackup(state, "2026-07-07T12:00:00Z");
    expect("profile" in b.data).toBe(false);
    expect(validateBackup(b).ok).toBe(true);
  });
  // 앱의 user 객체는 profile + 계정 식별자(uid·email·isOwner)다. 백업 파일은 클라우드·메일로
  // 옮겨지므로 계산에 쓰이지 않는 식별자가 실리면 안 된다 — 호출측 실수도 모듈이 막는다.
  it("user 객체를 그대로 넘겨도 계정 식별자(uid·email)는 백업에 담기지 않는다", () => {
    const asUser = { name: "다니엘", height: 178, age: 42, targetFat: 15, uid: "AbCdEf123456", email: "munansa@gmail.com", isOwner: true };
    const b = buildBackup({ ...state, profile: asUser }, "2026-07-07T12:00:00Z");
    expect(b.data.profile).toEqual({ name: "다니엘", height: 178, age: 42, targetFat: 15 });
    const json = JSON.stringify(b);
    expect(json).not.toContain("munansa@gmail.com");
    expect(json).not.toContain("AbCdEf123456");
    expect(json).not.toContain("isOwner");
    expect(validateBackup(b).ok).toBe(true);
  });
  it("식별자만 있는 프로필은 키 자체를 생략 (빈 껍데기를 남기지 않는다)", () => {
    const b = buildBackup({ ...state, profile: { uid: "u1", email: "a@b.c", isOwner: false } }, "2026-07-07T12:00:00Z");
    expect("profile" in b.data).toBe(false);
  });
  it("프로필 형식이 깨진 백업은 거부", () => {
    const bad = JSON.parse(JSON.stringify(buildBackup(state, "2026-07-07T12:00:00Z")));
    bad.data.profile = [1, 2];
    expect(validateBackup(bad).ok).toBe(false);
  });
});
