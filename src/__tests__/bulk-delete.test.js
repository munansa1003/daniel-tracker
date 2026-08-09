// 자동 유입분 기간 일괄 삭제 — 2026-08 감사 R-19.
//
// 파괴적 동작이라 계약을 촘촘히 고정한다. 가장 중요한 것: **손으로 입력한 기록은 절대
// 건드리지 않는다.** 자동 수신이 잘못 들어온 구간을 되돌리려다 사용자가 직접 적은 것을
// 함께 지우면, 이 기능은 있느니만 못하다.
import { describe, it, expect } from "vitest";
import { planAutoDelete, isAutoExercise, isAutoBody } from "../bulkDelete.js";

const watchEx = (n = "러닝") => ({ n, duration: 30, kcal: 300, m: 7, source: "watch", importKey: `k-${n}` });
const manualEx = (n = "벤치프레스") => ({ n, duration: 40, kcal: 200, m: 5 });

const state = () => ({
  allDays: {
    "2026-07-28": { meals: [{ n: "밥", k: 300, serving: 1 }], exercises: [watchEx(), manualEx()] },
    "2026-08-02": { meals: [], exercises: [watchEx("걷기")], mode: "cut", dayType: "rest" },
    "2026-08-05": { meals: [], exercises: [manualEx()] },
    "2026-08-20": { meals: [], exercises: [watchEx("수영")] },   // 기간 밖
  },
  bodyLog: [
    { date: "2026-07-28", weight: 75.0, muscle: 39, fatPct: 20, auto: true },
    { date: "2026-08-02", weight: 74.8, muscle: 39, fatPct: 19.8, source: "import" },
    { date: "2026-08-03", weight: 74.7, muscle: 39, fatPct: 19.7 },                    // 손입력
    { date: "2026-08-20", weight: 74.0, muscle: 39, fatPct: 19, auto: true },           // 기간 밖
  ],
  bodyDrafts: {
    "2026-08-04": { weight: 74.6, sampleTs: 1754000000000 },
    "2026-08-21": { weight: 74.1, sampleTs: 1755000000000 },                            // 기간 밖
  },
});

const RANGE = { start: "2026-08-01", end: "2026-08-10" };

describe("planAutoDelete — 자동 유입분만, 기간 안에서만", () => {
  it("기간 안 자동 운동만 지우고 손입력·기간 밖은 남긴다", () => {
    const r = planAutoDelete({ ...state(), ...RANGE });
    expect(r.counts.exercises).toBe(1);
    expect(r.updatedDays["2026-08-02"].exercises).toEqual([]);
    expect(r.updatedDays["2026-07-28"]).toBeUndefined();   // 기간 밖 — 손대지 않음
    expect(r.updatedDays["2026-08-20"]).toBeUndefined();   // 기간 밖
    expect(r.updatedDays["2026-08-05"]).toBeUndefined();   // 손입력뿐 — 바뀔 것이 없다
  });

  it("운동을 지워도 그 날의 나머지(식사·모드·휴식일 도장)는 그대로", () => {
    const r = planAutoDelete({ ...state(), ...RANGE });
    const d = r.updatedDays["2026-08-02"];
    expect(d.meals).toEqual([]);
    expect(d.mode).toBe("cut");
    expect(d.dayType).toBe("rest");        // 휴식일 도장이 삭제에 휩쓸리지 않는다
  });

  it("체성분은 auto·source:import만 지우고 손입력은 남긴다", () => {
    const r = planAutoDelete({ ...state(), ...RANGE });
    expect(r.counts.bodyRecords).toBe(1);              // 08-02(source:import)만
    expect(r.bodyDates).toEqual(["2026-08-02"]);
    const dates = r.bodyLog.map((b) => b.date);
    expect(dates).toContain("2026-08-03");             // 손입력 보존
    expect(dates).toContain("2026-07-28");             // 기간 밖 보존(자동이지만)
    expect(dates).toContain("2026-08-20");             // 기간 밖 보존
    expect(dates).not.toContain("2026-08-02");
  });

  it("초안은 기간 안의 것만 지우고, 삭제 흔적 키를 date|sampleTs로 돌려준다", () => {
    const r = planAutoDelete({ ...state(), ...RANGE });
    expect(r.counts.drafts).toBe(1);
    expect(r.draftKeys).toEqual(["2026-08-04|1754000000000"]);
    expect(Object.keys(r.bodyDrafts)).toEqual(["2026-08-21"]);
  });

  it("입력이 이상하면 아무것도 하지 않는다 (파괴적 동작의 기본자세)", () => {
    const s = state();
    for (const bad of [{ start: "2026-08-10", end: "2026-08-01" },   // 뒤집힘
                       { start: "", end: "2026-08-10" },
                       { start: "2026-08-01", end: "8/10" }]) {
      const r = planAutoDelete({ ...s, ...bad });
      expect(r.counts).toEqual({ exercises: 0, bodyRecords: 0, drafts: 0 });
      expect(r.updatedDays).toEqual({});
      expect(r.bodyLog).toHaveLength(4);
      expect(Object.keys(r.bodyDrafts)).toHaveLength(2);
    }
  });

  it("지울 것이 없으면 건수 0 — 미리보기가 '0건'을 정직하게 보여준다", () => {
    const r = planAutoDelete({ ...state(), start: "2026-01-01", end: "2026-01-31" });
    expect(r.counts).toEqual({ exercises: 0, bodyRecords: 0, drafts: 0 });
  });

  it("같은 범위로 두 번 돌려도 결과가 같다 (멱등 — 두 번 눌러도 더 지워지지 않는다)", () => {
    const s = state();
    const r1 = planAutoDelete({ ...s, ...RANGE });
    const after = { allDays: { ...s.allDays, ...r1.updatedDays }, bodyLog: r1.bodyLog, bodyDrafts: r1.bodyDrafts };
    const r2 = planAutoDelete({ ...after, ...RANGE });
    expect(r2.counts).toEqual({ exercises: 0, bodyRecords: 0, drafts: 0 });
    expect(r2.bodyLog).toEqual(r1.bodyLog);
  });

  it("빈 상태·누락 필드에도 던지지 않는다", () => {
    const r = planAutoDelete({ allDays: null, bodyLog: null, bodyDrafts: null, ...RANGE });
    expect(r.counts).toEqual({ exercises: 0, bodyRecords: 0, drafts: 0 });
    expect(r.bodyLog).toEqual([]);
  });
});

describe("판별 함수 — 무엇이 '자동'인가", () => {
  it("운동은 source가 watch일 때만 자동", () => {
    expect(isAutoExercise(watchEx())).toBe(true);
    expect(isAutoExercise(manualEx())).toBe(false);
    expect(isAutoExercise(null)).toBe(false);
  });
  it("체성분은 auto:true 또는 source:import일 때 자동", () => {
    expect(isAutoBody({ auto: true })).toBe(true);
    expect(isAutoBody({ source: "import" })).toBe(true);
    expect(isAutoBody({ weight: 75 })).toBe(false);
    expect(isAutoBody(undefined)).toBe(false);
  });
});
