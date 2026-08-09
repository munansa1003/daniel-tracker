// 마이그레이션 병합(mergeMigrated) — 경로 B 전환의 데이터 안전을 지키는 순수 로직 테스트.
// 핵심 계약: ① 새 계정에 이미 생긴 기록을 레거시가 덮지 않는다(비파괴)
//           ② 같은 입력으로 재실행해도 결과가 같다(멱등 — 재실행 시 중복 증식 금지)
import { describe, it, expect, vi } from "vitest";

// store.js는 firebase를 임포트하므로 통째로 mock (mergeMigrated는 순수라 실제 구현 사용)
vi.mock("../firebase.js", () => ({ db: {}, auth: {} }));
import { mergeMigrated } from "../store.js";
import { recalcExerciseKcal, findWatchOverlap } from "../importMerge.js";

describe("mergeMigrated — 마이그레이션 병합", () => {
  it("bodylog: 날짜 합집합, 같은 날짜는 새 계정 기록 우선, 날짜순 정렬", () => {
    const legacy = [
      { date: "2026-07-01", weight: 77.5 },
      { date: "2026-07-08", weight: 77.4 }, // 전환일 아침(레거시)
    ];
    const current = [{ date: "2026-07-08", weight: 77.2 }]; // 전환일 저녁(새 계정)
    const merged = mergeMigrated("bodylog", legacy, current);
    expect(merged).toEqual([
      { date: "2026-07-01", weight: 77.5 },
      { date: "2026-07-08", weight: 77.2 }, // 새 계정 값이 이김
    ]);
  });

  it("day:*: meals/exercises 합집합(ts 기준 dedup), mode 스탬프는 새 계정 우선", () => {
    const legacy = { meals: [{ n: "아침밥", ts: 1, hour: 8 }], exercises: [], mode: "cut" };
    const current = { meals: [{ n: "점심밥", ts: 2, hour: 13 }], exercises: [{ n: "러닝", ts: 3, hour: 18 }], mode: "maintain" };
    const merged = mergeMigrated("day:2026-07-08", legacy, current);
    expect(merged.meals.map(m => m.n)).toEqual(["아침밥", "점심밥"]);
    expect(merged.exercises.map(e => e.n)).toEqual(["러닝"]);
    expect(merged.mode).toBe("maintain"); // 그날 스탬프 — 새 계정 값 보존
  });

  it("day:*: 재실행 멱등 — 이미 병합된 결과에 레거시를 다시 병합해도 중복 증식 없음", () => {
    const legacy = { meals: [{ n: "아침밥", ts: 1, hour: 8 }], exercises: [] };
    const current = { meals: [{ n: "점심밥", ts: 2, hour: 13 }], exercises: [] };
    const once = mergeMigrated("day:2026-07-08", legacy, current);
    const twice = mergeMigrated("day:2026-07-08", legacy, once); // 재실행 시나리오
    expect(twice).toEqual(once);
  });

  it("custom-foods: 이름 dedup 합집합 (레거시 우선, 새 계정 고유 항목 보존)", () => {
    const legacy = [{ n: "닭가슴살 소스", p: 1, custom: true }];
    const current = [
      { n: "닭가슴살 소스", p: 2, custom: true }, // 중복 이름 → 레거시 유지
      { n: "새 계정 음식", p: 3, custom: true },
    ];
    const merged = mergeMigrated("custom-foods", legacy, current);
    expect(merged).toEqual([
      { n: "닭가슴살 소스", p: 1, custom: true },
      { n: "새 계정 음식", p: 3, custom: true },
    ]);
    expect(mergeMigrated("custom-foods", legacy, merged)).toEqual(merged); // 멱등
  });

  it("goals: 레거시(7개월 축적 설정) 우선 / profile: 온보딩 입력 우선 / lastBackup: 최신", () => {
    expect(mergeMigrated("goals", { mode: "cut", tdeeHistory: [1] }, { mode: "maintain" })).toEqual({ mode: "cut", tdeeHistory: [1] });
    expect(mergeMigrated("profile", { name: "옛날" }, { name: "온보딩" })).toEqual({ name: "온보딩" });
    expect(mergeMigrated("lastBackup", "2026-06-01", "2026-07-01")).toBe("2026-07-01");
    expect(mergeMigrated("lastBackup", "2026-07-05", "2026-07-01")).toBe("2026-07-05");
  });

  it("한쪽이 없으면 있는 쪽을 그대로 반환", () => {
    expect(mergeMigrated("bodylog", [{ date: "2026-07-01", weight: 77 }], undefined)).toEqual([{ date: "2026-07-01", weight: 77 }]);
    expect(mergeMigrated("goals", undefined, { mode: "cut" })).toEqual({ mode: "cut" });
  });
});

/* 자동 수신 운동의 실측 kcal 보존 — 2026-08 감사 R-42.
   워치가 측정한 소모 kcal을 편집 폼이 MET 근사로 갈아치워, 메모만 고쳐도
   실측값이 추정값으로 바뀌었다. */
describe("recalcExerciseKcal — 실측과 추정의 구분", () => {
  const watch = { n: "러닝", m: 8, duration: 60, kcal: 437, source: "watch" };
  const manual = { n: "러닝", m: 8, duration: 60, kcal: 600 };

  it("워치 항목: 시간이 그대로면 실측 kcal을 그대로 유지", () => {
    expect(recalcExerciseKcal(watch, 60, 75)).toBe(437);
  });
  it("워치 항목: 시간을 바꾸면 실측값을 비율로만 조정 (MET 근사로 대체하지 않음)", () => {
    expect(recalcExerciseKcal(watch, 30, 75)).toBe(219);   // 437 × 30/60
    expect(recalcExerciseKcal(watch, 90, 75)).toBe(656);   // 437 × 90/60
  });
  it("수동 항목: 기존대로 MET로 재계산", () => {
    expect(recalcExerciseKcal(manual, 60, 75)).toBe(600);  // 8 × 75 × 60/60
    expect(recalcExerciseKcal(manual, 30, 75)).toBe(300);
  });
  it("시간이 비었으면 원래 시간을 쓴다", () => {
    expect(recalcExerciseKcal(watch, undefined, 75)).toBe(437);
    expect(recalcExerciseKcal(manual, 0, 75)).toBe(600);
  });
});

/* 수동 입력이 자동 수신분과 겹치는지 — 이중 계상 경고(감사 R-18).
   막는 것이 아니라 알리는 기능이라, 판별이 지나치게 넓으면 정상 기록마다 경고가 뜨고
   지나치게 좁으면 있으나 마나다. 경계를 여기서 고정한다. */
describe("findWatchOverlap — 이중 계상 후보 판별", () => {
  const watch = (n, hour) => ({ n, hour, duration: 30, kcal: 300, source: "watch" });
  const list = [watch("러닝", 7), watch("근력 운동", 19), { n: "러닝", hour: 12, duration: 30, kcal: 300 }];

  it("같은 시간대(±1h)의 같은 종목이면 겹침으로 본다", () => {
    expect(findWatchOverlap(list, { n: "러닝" }, 7)?.hour).toBe(7);
    expect(findWatchOverlap(list, { n: "러닝" }, 6)?.hour).toBe(7);   // -1h
    expect(findWatchOverlap(list, { n: "러닝" }, 8)?.hour).toBe(7);   // +1h
  });
  it("2시간 이상 떨어지면 겹침이 아니다 (아침 러닝 + 저녁 러닝은 정상)", () => {
    expect(findWatchOverlap(list, { n: "러닝" }, 9)).toBe(null);
    expect(findWatchOverlap(list, { n: "러닝" }, 19)).toBe(null);     // 19시는 근력이라 이름도 다름
  });
  it("종목명이 서로를 포함하면 겹침 (공백·대소문자 무시)", () => {
    expect(findWatchOverlap(list, { n: "야외 러닝" }, 7)).toBeTruthy();
    expect(findWatchOverlap(list, { n: "근 력 운동" }, 19)).toBeTruthy();
  });
  it("다른 종목이면 겹치지 않는다", () => {
    expect(findWatchOverlap(list, { n: "수영" }, 7)).toBe(null);
  });
  it("손입력끼리는 경고하지 않는다 — 자동 수신분과의 충돌만 본다", () => {
    expect(findWatchOverlap(list, { n: "러닝" }, 12)).toBe(null);     // 12시 항목은 source 없음
  });
  it("시간·이름이 없으면 판단하지 않는다 (억지 경고 금지)", () => {
    expect(findWatchOverlap(list, { n: "러닝" }, undefined)).toBe(null);
    expect(findWatchOverlap(list, { n: "" }, 7)).toBe(null);
    expect(findWatchOverlap(null, { n: "러닝" }, 7)).toBe(null);
  });
});
