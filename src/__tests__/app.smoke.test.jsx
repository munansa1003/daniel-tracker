// @vitest-environment happy-dom
// 렌더 스모크 테스트 — 빌드(TS/린트 없음)가 못 잡는 "import 누락 → 흰 화면" 회귀 방어.
// 세션 복원 → MainApp 홈 탭까지 실제 마운트하여 모듈 분리 후 참조가 살아있는지 확인한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Firebase Auth 대체 — 로그인된 사용자를 즉시 발화시켜 MainApp까지 진입 (firebase/auth 미로딩)
vi.mock("../auth.js", () => ({
  OWNER_EMAIL: "munansa@gmail.com",
  isOwnerEmail: (e) => e === "munansa@gmail.com",
  watchAuth: (cb) => { cb({ uid: "auth-uid-1", email: "munansa@gmail.com", displayName: "Daniel" }); return () => {}; },
  signInWithGoogle: async () => {},
  signOutUser: async () => {},
  getIdToken: async () => null,
}));

vi.mock("../store.js", () => {
  const profile = { name: "Daniel", height: 175, age: 42, targetFat: 15, color: "#4a8fc9", createdAt: "2025-01-01T00:00:00.000Z" };
  return {
    default: {
      getLocalAll: () => ({}),
      getAllData: async () => ({ "day:2025-02-03": { meals: [{ n: "스모크밥", k: 520, serving: 1, p: 30, c: 60, f: 10, hour: 13 }], exercises: [{ n: "스모크런", kcal: 300, duration: 30, m: 6, hour: 18 }] } }),
      get: async (key) => (key === "profile" ? profile : null),
      set: async () => {},
      flushPendingSync: async () => 0,
    },
    getCurrentUserId: () => "auth-uid-1",
    setUserId: () => {},
    logout: () => {},
    getMembership: async () => ({ email: "munansa@gmail.com", joinedAt: "2026-07-01T00:00:00.000Z" }),
    joinWithInvite: async () => ({ ok: true }),
    getMigratedMark: () => null,
    getSharedFoods: async () => [],
    addSharedFood: async () => [],
    getSharedExercises: async () => [],
    addSharedExercise: async () => [],
  };
});

import App from "../App.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("App 렌더 스모크", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("저장된 세션 복원 → MainApp 홈 탭이 크래시 없이 렌더링된다", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(<App />); });
    // 비동기 프로필 로드 → MainApp 마운트까지 대기
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const text = div.textContent;
    expect(text).toContain("보정 섭취");   // NetCalCard
    expect(text).toContain("단백질");      // 홈 매크로 도넛 라벨
    expect(text).toContain("Daniel");      // 헤더 사용자명

    // 하단 네비로 전 탭 전환 — 각 탭의 렌더 경로에서 ReferenceError(임포트 누락)가 없는지 확인
    for (const label of ["식단", "운동", "체성분", "통계", "홈"]) {
      const btn = [...div.querySelectorAll("button")].find(b => b.textContent === label);
      expect(btn, `하단 네비 "${label}" 버튼`).toBeTruthy();
      await act(async () => { btn.click(); });
      expect(div.textContent.length, `"${label}" 탭 렌더`).toBeGreaterThan(0);
      // 식단 탭 통계 위젯(NextMealTip + CalorieBandChart D1)이 실제 렌더되는지 확인
      if (label === "식단") {
        expect(div.textContent, "식단 탭 '다음 끼니' 위젯").toContain("다음 끼니");
        expect(div.textContent, "식단 탭 'D1 칼로리 밴드' 위젯").toContain("섭취 vs 목표");
      }
      // 운동 탭 통계 위젯(WorkoutStamp + WeekdayRadar E9)이 실제 렌더되는지 확인
      if (label === "운동") {
        expect(div.textContent, "운동 탭 '최장' 스트릭 위젯").toContain("최장");
        expect(div.textContent, "운동 탭 'E9 요일 레이더' 위젯").toContain("요일별 운동");
      }
    }

    // 헤더 날짜 버튼 → 달력 펼침: 달력 렌더 경로(B1 칩 포함)가 크래시 없이 동작하고
    // 요일 헤더가 일요일 시작인지 확인 (첫 칸이 '일', 마지막이 '토')
    const dateBtn = [...div.querySelectorAll("button")].find(b => b.textContent.includes("▼"));
    expect(dateBtn, "헤더 날짜 버튼").toBeTruthy();
    await act(async () => { dateBtn.click(); });
    const dowCells = [...div.querySelectorAll("div")].filter(el =>
      el.children.length === 7 && [...el.children].every(c => ["일","월","화","수","목","금","토"].includes(c.textContent)));
    expect(dowCells.length, "요일 헤더 행").toBeGreaterThan(0);
    const labels = [...dowCells[0].children].map(c => c.textContent);
    expect(labels).toEqual(["일","월","화","수","목","금","토"]); // 일요일 시작

    // 날짜별 복사(컨셉 D): 식단 탭 → '📅 날짜' 칩 → 모달 열림 확인 (모달 핸들러 배선 방어)
    await act(async () => { [...div.querySelectorAll("button")].find(b => b.textContent === "식단")?.click(); });
    const importBtn = [...div.querySelectorAll("span")].find(el => el.textContent === "📅 날짜");
    expect(importBtn, "식단 '📅 날짜' 칩").toBeTruthy();
    await act(async () => { importBtn.click(); });
    expect(div.textContent, "날짜별 복사 모달 렌더").toContain("그날 전체 복사");

    await act(async () => { root.unmount(); });
  });
});
