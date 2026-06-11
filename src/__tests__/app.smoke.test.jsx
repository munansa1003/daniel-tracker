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
    }
    await act(async () => { root.unmount(); });
  });
});
