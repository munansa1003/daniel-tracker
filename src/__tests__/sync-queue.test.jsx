// @vitest-environment happy-dom
// 오프라인 재동기화 큐 — 데이터 유실/오염 방지의 핵심 성질을 검증한다:
// ① 실패 시 "키만" 큐에 ② flush는 localStorage "현재 값"을 전송(낡은 값 전송 불가)
// ③ 성공 set은 대기분 해소 ④ 부분 실패 시 실패 키만 큐에 잔류
import { describe, it, expect, vi, beforeEach } from "vitest";

const { setDocMock } = vi.hoisted(() => ({ setDocMock: vi.fn() }));
vi.mock("../firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...path) => path.join("/"),
  getDoc: vi.fn(),
  setDoc: (...a) => setDocMock(...a),
  deleteDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
}));

import store, { setUserId } from "../store.js";
import { getPending, addPending, removePending } from "../syncQueue.js";

beforeEach(() => {
  localStorage.clear();
  setUserId("t1");
  setDocMock.mockReset();
});

describe("syncQueue 헬퍼", () => {
  it("빈 큐 → [], add는 중복 없이, remove는 해당 키만", () => {
    expect(getPending("t1")).toEqual([]);
    addPending("t1", "day:2026-01-01");
    addPending("t1", "day:2026-01-01"); // 중복
    addPending("t1", "goals");
    expect(getPending("t1")).toEqual(["day:2026-01-01", "goals"]);
    removePending("t1", "day:2026-01-01");
    expect(getPending("t1")).toEqual(["goals"]);
  });

  it("큐 저장 키는 데이터 프리픽스(dt_t1_*) 밖 — getLocalAll 순회 미오염", () => {
    addPending("t1", "goals");
    expect(localStorage.getItem("dt_pendingSync_t1")).toBeTruthy();
    expect(store.getLocalAll()).toEqual({}); // 데이터 키로 잡히지 않음
  });

  it("손상된 큐 JSON → 빈 배열 폴백(크래시 없음)", () => {
    localStorage.setItem("dt_pendingSync_t1", "{broken");
    expect(getPending("t1")).toEqual([]);
  });
});

describe("store.set × 대기열", () => {
  it("Firestore 실패 → localStorage엔 기록 + 키가 큐에 등록", async () => {
    setDocMock.mockRejectedValueOnce(new Error("offline"));
    const ok = await store.set("day:2026-01-01", { meals: [1] });
    expect(ok).toBe(false);
    expect(JSON.parse(localStorage.getItem("dt_t1_day:2026-01-01"))).toEqual({ meals: [1] });
    expect(getPending("t1")).toEqual(["day:2026-01-01"]);
  });

  it("성공 set은 같은 키의 대기분을 해소(이후 flush가 덮어쓸 일 없음)", async () => {
    addPending("t1", "goals");
    setDocMock.mockResolvedValueOnce();
    await store.set("goals", { weight: 72 });
    expect(getPending("t1")).toEqual([]);
  });
});

describe("store.flushPendingSync", () => {
  it("낡은 값이 아니라 localStorage '현재 값'을 전송한다 (핵심 안전 성질)", async () => {
    // 오프라인 기록(v1) → 큐 등록
    setDocMock.mockRejectedValueOnce(new Error("offline"));
    await store.set("day:2026-01-01", { v: 1 });
    // 이후 로컬이 v2로 갱신됐다고 가정(다른 경로의 수정)
    localStorage.setItem("dt_t1_day:2026-01-01", JSON.stringify({ v: 2 }));
    // flush → 전송된 값은 v2여야 함
    setDocMock.mockResolvedValue();
    const n = await store.flushPendingSync();
    expect(n).toBe(1);
    expect(getPending("t1")).toEqual([]);
    const [ref, payload] = setDocMock.mock.calls.at(-1);
    expect(ref).toBe("users/t1/data/day:2026-01-01");
    expect(payload.value).toEqual({ v: 2 });
  });

  it("부분 실패: 실패한 키만 큐에 남고 성공 키는 해소", async () => {
    setDocMock.mockRejectedValue(new Error("offline"));
    await store.set("day:2026-01-01", { a: 1 });
    await store.set("goals", { weight: 72 });
    expect(getPending("t1")).toEqual(["day:2026-01-01", "goals"]);
    // 첫 키는 실패, 둘째 키는 성공
    setDocMock.mockReset();
    setDocMock.mockRejectedValueOnce(new Error("still offline")).mockResolvedValueOnce();
    const n = await store.flushPendingSync();
    expect(n).toBe(1);
    expect(getPending("t1")).toEqual(["day:2026-01-01"]);
  });

  it("로컬 값이 사라진 키는 전송 없이 대기열만 정리", async () => {
    addPending("t1", "ghost-key");
    const n = await store.flushPendingSync();
    expect(n).toBe(0);
    expect(getPending("t1")).toEqual([]);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it("uid 없으면 no-op", async () => {
    localStorage.removeItem("dt_currentUser");
    const { logout } = await import("../store.js");
    logout();
    expect(await store.flushPendingSync()).toBe(0);
  });
});
