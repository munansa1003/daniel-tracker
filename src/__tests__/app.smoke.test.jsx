// @vitest-environment happy-dom
// 렌더 스모크 테스트 — 빌드(TS/린트 없음)가 못 잡는 "import 누락 → 흰 화면" 회귀 방어.
// 세션 복원 → MainApp 홈 탭까지 실제 마운트하여 모듈 분리 후 참조가 살아있는지 확인한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../store.js", () => {
  const profile = { id: "daniel", name: "Daniel", height: 175, age: 42, targetFat: 15, color: "#4a8fc9", createdAt: "2025-01-01T00:00:00.000Z" };
  return {
    default: {
      getLocalAll: () => ({}),
      getAllData: async () => ({}),
      get: async () => null,
      set: async () => {},
    },
    getCurrentUserId: () => "daniel",
    setUserId: () => {},
    logout: () => {},
    getProfiles: async () => [profile],
    saveProfiles: async () => {},
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
      // 식단 탭 상단 통계 위젯(RemainingMacros)이 실제 렌더되는지 확인
      if (label === "식단") expect(div.textContent, "식단 탭 '남은 목표' 위젯").toContain("남은 목표");
      // 운동 탭 상단 통계 위젯(WorkoutStamp)이 실제 렌더되는지 확인
      if (label === "운동") expect(div.textContent, "운동 탭 '최장' 스트릭 위젯").toContain("최장");
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

    await act(async () => { root.unmount(); });
  });
});
