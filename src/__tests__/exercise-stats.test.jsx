import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkoutStamp } from "../components/WorkoutStamp.jsx";
import { ExerciseRhythm } from "../components/ExerciseRhythm.jsx";

// 연속일 시나리오: 6/26(오늘)·25·24 연속(3), 23 결손, 22 단독.
// 과거 6/10~14 5연속 → 최장 5.
const HIST = {
  "2026-06-26": { exercises: [{ m: 7, duration: 45, kcal: 420 }] },
  "2026-06-25": { exercises: [{ m: 6, duration: 30, kcal: 250 }] },
  "2026-06-24": { exercises: [{ m: 6, duration: 30, kcal: 250 }] },
  "2026-06-22": { exercises: [{}] },
  "2026-06-14": { exercises: [{}] },
  "2026-06-13": { exercises: [{}] },
  "2026-06-12": { exercises: [{}] },
  "2026-06-11": { exercises: [{}] },
  "2026-06-10": { exercises: [{}] },
};

describe("WorkoutStamp (L) — 오늘 운동 도장 & 스트릭", () => {
  it("기록일: 분·평균MET·소모 + 현재 연속 3일 / 최장 5", () => {
    const h = renderToStaticMarkup(
      <WorkoutStamp date="2026-06-26" exercises={HIST["2026-06-26"].exercises} exTotal={420} allDays={HIST} todayStr="2026-06-26" />
    );
    expect(h).toContain("45분");
    expect(h).toContain("평균 MET 7.0");
    expect(h).toContain("-420");
    expect(h).toContain("🔥 3일");
    expect(h).toContain("최장 5");
    expect(h).not.toContain("미기록");
  });

  it("미기록일(오늘): 끊김 경고 + 연속 0일 (직전 2일 끊김)", () => {
    const days = { "2026-06-25": { exercises: [{}] }, "2026-06-24": { exercises: [{}] } };
    const h = renderToStaticMarkup(
      <WorkoutStamp date="2026-06-26" exercises={[]} exTotal={0} allDays={days} todayStr="2026-06-26" />
    );
    expect(h).toContain("미기록");
    expect(h).toContain("🔥2일 끊김");
    expect(h).toContain("🔥 0일");
  });

  it("분가중 평균 MET: (6×30 + 10×30)/60 = 8.0", () => {
    const ex = [{ m: 6, duration: 30, kcal: 200 }, { m: 10, duration: 30, kcal: 350 }];
    const h = renderToStaticMarkup(
      <WorkoutStamp date="2026-06-26" exercises={ex} exTotal={550} allDays={{ "2026-06-26": { exercises: ex } }} todayStr="2026-06-26" />
    );
    expect(h).toContain("60분");
    expect(h).toContain("평균 MET 8.0");
    expect(h).toContain("🔥 1일");
  });
});

describe("ExerciseRhythm — 운동 시간대 분포", () => {
  it("시간대별 소모·분 합산: 점심 -420 · 45분", () => {
    const h = renderToStaticMarkup(<ExerciseRhythm exercises={[{ hour: 13, kcal: 420, duration: 45 }]} />);
    expect(h).toContain("-420 · 45분");
    expect(h).toContain("점심");
  });

  it("같은 시간대 합산: 아침 200+100=−300 · 30+20=50분", () => {
    const ex = [{ hour: 8, kcal: 200, duration: 30 }, { hour: 9, kcal: 100, duration: 20 }];
    const h = renderToStaticMarkup(<ExerciseRhythm exercises={ex} />);
    expect(h).toContain("-300 · 50분");
  });

  it("기록 없으면 숨김(null)", () => {
    expect(renderToStaticMarkup(<ExerciseRhythm exercises={[]} />)).toBe("");
  });
});
