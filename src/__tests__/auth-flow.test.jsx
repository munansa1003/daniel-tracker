// @vitest-environment happy-dom
// 인증 상태 기계(경로 B) 렌더 테스트 — App이 로그인/초대/온보딩 단계를 올바르게 보여주는지.
// firebase를 로드하지 않도록 auth.js·store.js를 통째로 mock하고, 홀더 객체로 단계를 바꾼다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// 테스트별로 바꾸는 상태 홀더 (vi.mock 팩토리는 호이스팅되므로 vi.hoisted 사용)
const holder = vi.hoisted(() => ({
  user: null,          // watchAuth가 발화할 사용자
  membership: null,    // getMembership 결과
  profile: null,       // store.get("profile") 결과
  joinCalls: [],       // joinWithInvite 호출 기록
  joinResult: { ok: true },
}));

vi.mock("../auth.js", () => ({
  OWNER_EMAIL: "munansa@gmail.com",
  isOwnerEmail: (e) => e === "munansa@gmail.com",
  watchAuth: (cb) => { cb(holder.user); return () => {}; },
  signInWithGoogle: async () => {},
  signOutUser: async () => {},
  getIdToken: async () => null,
}));

vi.mock("../store.js", () => ({
  default: {
    getLocalAll: () => ({}),
    getAllData: async () => ({}),
    get: async (key) => (key === "profile" ? holder.profile : null),
    set: async () => {},
    flushPendingSync: async () => 0,
  },
  getCurrentUserId: () => (holder.user ? holder.user.uid : null),
  setUserId: () => {},
  logout: () => {},
  getMembership: async () => holder.membership,
  joinWithInvite: async (code, email) => { holder.joinCalls.push({ code, email }); return holder.joinResult; },
  getSharedFoods: async () => [],
  addSharedFood: async () => [],
  getSharedExercises: async () => [],
  addSharedExercise: async () => [],
}));

import App from "../App.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function render() {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(<App />); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { div, root };
}

describe("인증 상태 기계 (경로 B)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    holder.user = null;
    holder.membership = null;
    holder.profile = null;
    holder.joinCalls = [];
    holder.joinResult = { ok: true };
  });

  it("로그아웃 상태 → Google 로그인 화면", async () => {
    const { div, root } = await render();
    expect(div.textContent).toContain("Google로 계속하기");
    expect(div.textContent).toContain("초대받은 사용자만");
    await act(async () => { root.unmount(); });
  });

  it("로그인 + 비멤버(일반 계정) → 초대 코드 게이트", async () => {
    holder.user = { uid: "u-friend", email: "friend@example.com", displayName: "친구" };
    const { div, root } = await render();
    expect(div.textContent).toContain("초대 코드 입력");
    expect(div.textContent).toContain("friend@example.com");
    // 일반 계정은 자동 가입(joinWithInvite) 시도가 없어야 함
    expect(holder.joinCalls.length).toBe(0);
    await act(async () => { root.unmount(); });
  });

  it("초대 코드 거부(permission-denied) → 오류 메시지", async () => {
    holder.user = { uid: "u-friend", email: "friend@example.com", displayName: "친구" };
    holder.joinResult = { ok: false, error: "permission-denied" };
    const { div, root } = await render();
    const input = div.querySelector("input");
    const btn = [...div.querySelectorAll("button")].find(b => b.textContent.includes("등록"));
    await act(async () => {
      // happy-dom에서 React 제어 input 값 주입
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "WRONG-CODE");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { btn.click(); });
    expect(div.textContent).toContain("유효하지 않은 초대 코드");
    await act(async () => { root.unmount(); });
  });

  it("운영자 이메일 + 비멤버 → 코드 없이 자동 가입 후 온보딩", async () => {
    holder.user = { uid: "u-owner", email: "munansa@gmail.com", displayName: "Daniel" };
    const { div, root } = await render();
    expect(holder.joinCalls.length).toBe(1);
    expect(holder.joinCalls[0].code).toBe(null); // 운영자는 초대 코드 없이
    expect(div.textContent).toContain("프로필 설정"); // 프로필 없음 → 온보딩
    await act(async () => { root.unmount(); });
  });

  it("멤버 + 프로필 없음 → 온보딩 (키·나이 입력)", async () => {
    holder.user = { uid: "u-friend", email: "friend@example.com", displayName: "친구" };
    holder.membership = { joinedAt: "2026-07-01" };
    const { div, root } = await render();
    expect(div.textContent).toContain("프로필 설정");
    expect(div.textContent).toContain("키 (cm)");
    await act(async () => { root.unmount(); });
  });

  it("멤버 + 프로필 있음 → MainApp 진입", async () => {
    holder.user = { uid: "u-friend", email: "friend@example.com", displayName: "친구" };
    holder.membership = { joinedAt: "2026-07-01" };
    holder.profile = { name: "친구", height: 170, age: 30, targetFat: 18, color: "#4a8fc9" };
    const { div, root } = await render();
    expect(div.textContent).toContain("보정 섭취"); // NetCalCard = MainApp 홈
    expect(div.textContent).toContain("친구");      // 헤더 사용자명
    await act(async () => { root.unmount(); });
  });
});
