// @vitest-environment happy-dom
// 가로모드 렌더 스모크 — useOrientation을 가로로 고정하고 App→MainApp을 실제 마운트해
// 좌측 레일·홈 2컬럼 그리드·체성분 히어로 차트·통계 2컬럼 경로의 임포트/배선 회귀를 방어한다.
// (세로 경로는 app.smoke.test.jsx가 담당)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../auth.js", () => ({
  OWNER_EMAIL: "munansa@gmail.com",
  isOwnerEmail: (e) => e === "munansa@gmail.com",
  watchAuth: (cb) => { cb({ uid: "auth-uid-1", email: "munansa@gmail.com", displayName: "Daniel" }); return () => {}; },
  signInWithGoogle: async () => {},
  signOutUser: async () => {},
  getIdToken: async () => null,
}));

// 가로(landscape) 고정 — 레이아웃 분기의 가로 경로를 결정적으로 검증
vi.mock("../hooks/useOrientation.js", () => ({ useOrientation: () => true }));

vi.mock("../store.js", () => {
  const profile = { name: "Daniel", height: 175, age: 42, targetFat: 15, color: "#4a8fc9", createdAt: "2025-01-01T00:00:00.000Z" };
  return {
    default: {
      getLocalAll: () => ({}),
      // bodylog 2건 → 체성분 탭 히어로 추이 차트(기록 2건 이상 조건)까지 렌더 경로 확보
      getAllData: async () => ({
        "day:2025-02-03": { meals: [{ n: "스모크밥", k: 520, serving: 1, p: 30, c: 60, f: 10, hour: 13 }], exercises: [{ n: "스모크런", kcal: 300, duration: 30, m: 6, hour: 18 }] },
        "bodylog": [
          { date: "2025-01-20", weight: 78.6, muscle: 33.8, fatPct: 22.9, score: 74 },
          { date: "2025-02-01", weight: 77.4, muscle: 34.2, fatPct: 21.5, score: 78 },
        ],
      }),
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
    listProgressPhotos: async () => [],
    saveProgressPhoto: async () => ({}),
    deleteProgressPhoto: async () => {},
  };
});

import App from "../App.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("App 가로모드 렌더 스모크", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("가로모드: 좌측 레일 + 홈 2컬럼 + 전 탭 전환이 크래시 없이 렌더링된다", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(<App />); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    // 홈 콘텐츠가 렌더됨
    expect(div.textContent).toContain("보정 섭취");   // NetCalCard
    expect(div.textContent).toContain("Daniel");      // 슬림 헤더 사용자명

    // 내비가 하단 탭바가 아니라 "세로 레일"로 렌더됨 (flexDirection: column)
    const homeBtn = [...div.querySelectorAll("button")].find(b => b.textContent === "홈");
    expect(homeBtn, "레일 '홈' 버튼").toBeTruthy();
    expect(homeBtn.parentElement.style.flexDirection, "레일은 세로 방향").toBe("column");

    // 홈 2컬럼 그리드 래퍼 존재
    const grid = [...div.querySelectorAll("div")].find(el => el.style.display === "grid" && el.style.gridTemplateColumns === "1fr 1fr");
    expect(grid, "홈 2컬럼 그리드").toBeTruthy();
    expect(grid.textContent).toContain("오늘의 요약");
    expect(grid.textContent).toContain("오늘 먹은 것");

    // 전 탭 전환 — 각 탭의 가로 레이아웃 렌더 경로에서 ReferenceError가 없는지 확인
    const clickTab = async (label) => {
      const btn = [...div.querySelectorAll("button")].find(b => b.textContent === label);
      expect(btn, `레일 "${label}" 버튼`).toBeTruthy();
      await act(async () => { btn.click(); });
    };

    await clickTab("체성분");
    // 히어로 차트(기간 버튼) + 2컬럼 카드(목표/히스토리)가 함께 렌더됨
    expect(div.textContent, "체성분 기간 선택").toContain("3개월");
    expect(div.textContent, "체성분 목표 카드").toContain("목표 설정");
    expect(div.textContent, "체성분 히스토리 카드").toContain("기록 히스토리");

    await clickTab("통계");
    expect(div.textContent, "통계 주간 성적표").toContain("주간 성적표");

    await clickTab("식단");
    expect(div.textContent, "식단 '다음 끼니' 위젯").toContain("다음 끼니");

    await clickTab("운동");
    expect(div.textContent, "운동 요일 레이더").toContain("요일별 운동");

    await clickTab("홈");
    expect(div.textContent).toContain("보정 섭취");

    await act(async () => { root.unmount(); });
  });
});
