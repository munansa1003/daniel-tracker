// @vitest-environment happy-dom
// 설정 → 데이터 화면의 렌더 경로 — 자동 수신분 일괄 삭제 UI (2026-08 감사 R-19).
//
// 이 화면은 기존 스모크 테스트가 한 번도 열지 않던 곳이다(하단 네비 탭만 돈다).
// 그런데 여기에 **파괴적 동작**이 들어왔으므로, 최소한 "열리고, 미리보기 건수가 맞고,
// 확인을 거부하면 아무것도 지워지지 않는다"는 세 가지는 고정해 둔다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const stored = new Map();
vi.mock("../firebase.js", () => ({ db: {}, auth: {} }));
vi.mock("../auth.js", () => ({
  watchAuth: (cb) => { cb({ uid: "uid-1", email: "munansa@gmail.com", displayName: "Daniel" }); return () => {}; },
  signInWithGoogle: async () => {}, signOutUser: async () => {},
  isOwnerEmail: () => true, getIdToken: async () => "tok",
}));
vi.mock("../push.js", () => ({
  pushConfigured: () => false, enablePush: async () => {}, disablePush: async () => {}, syncPushState: async () => {},
}));

const LOCAL = {
  profile: { name: "Daniel", height: 178, age: 42, targetFat: 15 },
  bodylog: [
    { date: "2026-08-02", weight: 74.8, muscle: 39, fatPct: 19.8, source: "import" },
    { date: "2026-08-03", weight: 74.7, muscle: 39, fatPct: 19.7 },   // 손입력
  ],
  "body-drafts": { "2026-08-04": { weight: 74.6, sampleTs: 1754000000000 } },
  "day:2026-08-02": { meals: [], exercises: [{ n: "러닝", duration: 30, kcal: 300, m: 7, source: "watch" }] },
  "day:2026-08-05": { meals: [], exercises: [{ n: "벤치프레스", duration: 40, kcal: 200, m: 5 }] },
  goals: { mode: "cut" },
};

vi.mock("../store.js", () => ({
  default: {
    getLocalAll: () => ({ ...LOCAL, ...Object.fromEntries(stored) }),
    get: async (k) => (stored.has(k) ? stored.get(k) : LOCAL[k] ?? null),
    set: async (k, v) => { stored.set(k, v); },
    delete: async () => true,
    getAllData: async () => ({ ...LOCAL }),
    flushPendingSync: async () => 0,
    list: async () => [],
  },
  getCurrentUserId: () => "uid-1",
  setUserId: () => {}, logout: () => {},
  getMembership: async () => ({ owner: true }),
  joinWithInvite: async () => ({ ok: true }),
  getMigratedMark: async () => null,
  getSharedFoods: async () => [], addSharedFood: async () => null,
  getSharedExercises: async () => [], addSharedExercise: async () => null,
  listProgressPhotos: async () => [], saveProgressPhoto: async () => ({}), deleteProgressPhoto: async () => {},
}));

import App from "../App.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const byText = (div, t) => [...div.querySelectorAll("div,button,span")].find((el) => el.textContent.trim() === t);
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };

async function openDataSettings() {
  const div = document.createElement("div");
  document.body.appendChild(div);
  await act(async () => { createRoot(div).render(<App />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  // 헤더 ⋮ 메뉴 → "설정 / 데이터" → 데이터 탭.
  // 각 단계가 실제로 열렸는지 확인한다 — 못 열고 조용히 통과하면 이 테스트는 아무것도 안 지킨다.
  // button으로 좁힌다 — "*"로 찾으면 텍스트가 같은 **바깥 래퍼**가 먼저 잡히고,
  // 래퍼에는 onClick이 없어 클릭이 아무 일도 하지 않는다(조용히 실패).
  const kebab = [...div.querySelectorAll("button")].find((el) => el.textContent === "⋮");
  expect(kebab, "헤더 ⋮ 메뉴 버튼").toBeTruthy();
  await click(kebab);

  const settings = [...div.querySelectorAll("div")].find((el) => el.textContent.trim() === "⚙설정 / 데이터");
  expect(settings, "메뉴의 '설정 / 데이터' 항목").toBeTruthy();
  await click(settings);

  const dataTab = [...div.querySelectorAll("button")].find((b) => b.textContent === "데이터");
  expect(dataTab, "설정 모달의 '데이터' 탭").toBeTruthy();
  await click(dataTab);
  return div;
}

describe("자동 수신분 일괄 삭제 UI (R-19)", () => {
  beforeEach(() => {
    document.body.innerHTML = ""; stored.clear(); vi.restoreAllMocks();
    // 시계 고정 — 일괄 삭제 패널의 기본 범위는 today()-13 ~ today()(App.jsx)라, 픽스처(2026-08-02~08-05)와
    // 겹치려면 "오늘"이 2026-08-18 이전이어야 한다. 실제 달력이 지나자(2026-08-18~) 기본 범위가 비어
    // 세 번째 케이스가 confirm 대신 alert 경로로 들어갔고, happy-dom에는 alert가 없어 unhandled
    // rejection으로 게이트 전체가 빨간불이 됐다(2026-09-07 발견). 날짜를 픽스처 안으로 못 박는다.
    vi.useFakeTimers({ toFake: ["Date"] });           // Date만 가짜 — setTimeout(act 대기)은 실제 타이머 유지
    vi.setSystemTime(new Date("2026-08-10T12:00:00+09:00"));
    // happy-dom에는 window.alert이 없다 — 어떤 경로로든 alert에 닿으면 TypeError가 아니라 호출 기록이 남게 한다
    vi.stubGlobal("alert", vi.fn());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("데이터 화면이 열리고 일괄 삭제 항목이 보인다", async () => {
    const div = await openDataSettings();
    expect(div.textContent).toContain("자동 수신분 일괄 삭제");
  });

  it("펼치면 기간 입력과 미리보기 건수가 나온다 — 자동분만 센다", async () => {
    const div = await openDataSettings();
    await click(byText(div, "자동 수신분 일괄 삭제"));
    const dates = [...div.querySelectorAll('input[type="date"]')];
    expect(dates).toHaveLength(2);

    // 2026-08-01 ~ 2026-08-10: 자동 운동 1 · 자동 체성분 1 · 초안 1 (손입력 08-03·08-05는 제외)
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(dates[0], "2026-08-01"); dates[0].dispatchEvent(new Event("input", { bubbles: true }));
      set.call(dates[1], "2026-08-10"); dates[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(div.textContent).toContain("운동 1건");
    expect(div.textContent).toContain("체성분 1건");
    expect(div.textContent).toContain("초안 1건");
  });

  it("확인 창에서 취소하면 아무것도 지워지지 않는다", async () => {
    const div = await openDataSettings();
    await click(byText(div, "자동 수신분 일괄 삭제"));
    globalThis.confirm = vi.fn(() => false);
    const btn = [...div.querySelectorAll("button")].find((b) => b.textContent.includes("자동 수신분 삭제"));
    expect(btn).toBeTruthy();
    await click(btn);
    // confirm 경로를 실제로 탔는지 명시적으로 본다 — 기본 범위가 비어 alert("지울 것 없음")로 빠지면
    // 저장 0건은 같아도 "취소를 존중했다"는 검증이 아니다(조용한 통과 방지).
    expect(globalThis.alert).not.toHaveBeenCalled();
    expect(globalThis.confirm).toHaveBeenCalledTimes(1);
    // 저장이 한 번도 일어나지 않았다
    expect(stored.size).toBe(0);
  });
});
