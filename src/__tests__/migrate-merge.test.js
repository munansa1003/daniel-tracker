// 마이그레이션 병합(mergeMigrated) — 경로 B 전환의 데이터 안전을 지키는 순수 로직 테스트.
// 핵심 계약: ① 새 계정에 이미 생긴 기록을 레거시가 덮지 않는다(비파괴)
//           ② 같은 입력으로 재실행해도 결과가 같다(멱등 — 재실행 시 중복 증식 금지)
import { describe, it, expect, vi } from "vitest";

// store.js는 firebase를 임포트하므로 통째로 mock (mergeMigrated는 순수라 실제 구현 사용)
vi.mock("../firebase.js", () => ({ db: {}, auth: {} }));
import { mergeMigrated } from "../store.js";

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
