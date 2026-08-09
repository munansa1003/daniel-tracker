// @vitest-environment happy-dom
// 오프라인 재동기화 큐 — 데이터 유실/오염 방지의 핵심 성질을 검증한다:
// ① 실패 시 "키만" 큐에 ② flush는 localStorage "현재 값"을 전송(낡은 값 전송 불가)
// ③ 성공 set은 대기분 해소 ④ 부분 실패 시 실패 키만 큐에 잔류
import { describe, it, expect, vi, beforeEach } from "vitest";

const { setDocMock, getDocMock } = vi.hoisted(() => ({ setDocMock: vi.fn(), getDocMock: vi.fn() }));
vi.mock("../firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...path) => path.join("/"),
  getDoc: (...a) => getDocMock(...a),
  setDoc: (...a) => setDocMock(...a),
  deleteDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
}));

import store, { setUserId, mergeForFlush } from "../store.js";
import { getPending, addPending, removePending, addTombstone, getTombstoneIds } from "../syncQueue.js";

beforeEach(() => {
  localStorage.clear();
  setUserId("t1");
  setDocMock.mockReset();
  getDocMock.mockReset();
  getDocMock.mockResolvedValue({ exists: () => false });
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

  it("⭐ setDoc이 오프라인으로 '무한 대기'(hang)해도 로컬 기록+큐 등록은 즉시 — 앱 종료 대비", () => {
    // Firestore SDK는 순수 오프라인에서 reject하지 않고 promise를 pending으로 둔다.
    setDocMock.mockReturnValueOnce(new Promise(() => {})); // 영원히 안 끝나는 쓰기
    store.set("day:2026-02-02", { v: 9 }); // await 없이 — hang 중 상태를 검사
    // set()의 동기 구간(await 이전)에서 이미 로컬+큐가 기록되어 있어야 한다
    expect(JSON.parse(localStorage.getItem("dt_t1_day:2026-02-02"))).toEqual({ v: 9 });
    expect(getPending("t1")).toContain("day:2026-02-02");
    // → 이 상태에서 앱이 죽어도 다음 시작의 flush(getAllData 이전)가 서버로 밀어올린다
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

/* ── 재전송 병합 (2026-08 감사 R-02, P0) ────────────────────────────────
   bodylog는 배열 하나가 문서 하나다. 오프라인 대기분을 그대로 재전송하면 그 사이 다른
   기기가 확정한 날이 통째로 사라진다 — 자동 확정이 도입된 뒤로는 앱을 여는 것만으로
   이 쓰기가 일어나 창이 넓다. 합치되, 사용자가 명시적으로 지운 것은 되살리지 않는다. */
describe("mergeForFlush — 집합 문서 병합 규칙", () => {
  const auto = (date, w, ts) => ({ date, weight: w, muscle: 35, fatPct: 18, score: 80, auto: true, sampleTs: ts, source: "import" });
  const manual = (date, w) => ({ date, weight: w, muscle: 35, fatPct: 18, score: 80 });

  it("다른 기기가 확정한 날이 살아남는다 (P0 유실 경로)", () => {
    const local = [auto("2026-08-08", 75.0, 100)];
    const remote = [auto("2026-08-09", 74.8, 200)];
    expect(mergeForFlush("bodylog", local, remote).map((b) => b.date)).toEqual(["2026-08-08", "2026-08-09"]);
  });

  it("같은 날 충돌 — 사람이 손댄 값이 자동값을 이긴다 (잠금 철학과 같은 방향)", () => {
    expect(mergeForFlush("bodylog", [manual("2026-08-09", 70)], [auto("2026-08-09", 99, 999)])[0].weight).toBe(70);
    expect(mergeForFlush("bodylog", [auto("2026-08-09", 99, 999)], [manual("2026-08-09", 70)])[0].weight).toBe(70);
  });

  it("같은 날 둘 다 자동이면 더 최신 측정이 이긴다", () => {
    expect(mergeForFlush("bodylog", [auto("2026-08-09", 75, 100)], [auto("2026-08-09", 76, 200)])[0].weight).toBe(76);
    expect(mergeForFlush("bodylog", [auto("2026-08-09", 75, 300)], [auto("2026-08-09", 76, 200)])[0].weight).toBe(75);
  });

  it("지운 기록은 되살아나지 않는다 (흔적 존중)", () => {
    const remote = [auto("2026-08-08", 75, 100), auto("2026-08-09", 74, 200)];
    const merged = mergeForFlush("bodylog", [auto("2026-08-09", 74, 200)], remote, new Set(["2026-08-08"]));
    expect(merged.map((b) => b.date)).toEqual(["2026-08-09"]);
  });

  it("body-drafts는 날짜 맵으로 합치고 더 최신 sampleTs가 이긴다", () => {
    const local = { "2026-08-09": { weight: 75, sampleTs: 100 } };
    const remote = { "2026-08-08": { weight: 74, sampleTs: 50 }, "2026-08-09": { weight: 76, sampleTs: 300 } };
    const m = mergeForFlush("body-drafts", local, remote);
    expect(Object.keys(m).sort()).toEqual(["2026-08-08", "2026-08-09"]);
    expect(m["2026-08-09"].weight).toBe(76);
  });

  it("day 문서는 합치지 않는다 — 합치면 지운 끼니·운동이 되살아난다", () => {
    const local = { meals: [], exercises: [] };
    expect(mergeForFlush("day:2026-08-09", local, { meals: [{ n: "밥" }], exercises: [] })).toBe(local);
  });

  it("원격이 없거나 형식이 깨졌으면 로컬 그대로", () => {
    const local = [auto("2026-08-09", 75, 100)];
    expect(mergeForFlush("bodylog", local, undefined)).toBe(local);
    expect(mergeForFlush("bodylog", local, "corrupt")).toBe(local);
  });
});

describe("삭제 흔적(tombstone)", () => {
  it("키별로 분리되고 기한(60일)이 지나면 사라진다", () => {
    addTombstone("t1", "bodylog", "2026-08-08");
    addTombstone("t1", "body-drafts", "2026-08-07");
    expect([...getTombstoneIds("t1", "bodylog")]).toEqual(["2026-08-08"]);
    expect([...getTombstoneIds("t1", "body-drafts")]).toEqual(["2026-08-07"]);
    const later = Date.now() + 61 * 86400000;
    expect(getTombstoneIds("t1", "bodylog", later).size).toBe(0);
  });
  it("데이터 프리픽스 밖에 저장돼 getLocalAll을 오염시키지 않는다", () => {
    addTombstone("t1", "bodylog", "2026-08-08");
    expect(Object.keys(store.getLocalAll())).not.toContain("tombstones");
    expect(localStorage.getItem("dt_tombstones_t1")).not.toBe(null);
  });
});

describe("flushPendingSync — 병합 경로", () => {
  it("bodylog 재전송이 원격의 다른 날을 지우지 않는다", async () => {
    const localLog = [{ date: "2026-08-08", weight: 75, auto: true, sampleTs: 100 }];
    localStorage.setItem("dt_t1_bodylog", JSON.stringify(localLog));
    addPending("t1", "bodylog");
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ value: [{ date: "2026-08-09", weight: 74, auto: true, sampleTs: 200 }] }) });
    setDocMock.mockResolvedValue(undefined);

    expect(await store.flushPendingSync()).toBe(1);
    const sent = setDocMock.mock.calls[0][1].value;
    expect(sent.map((b) => b.date)).toEqual(["2026-08-08", "2026-08-09"]);
    // 로컬 미러도 합친 값으로 갱신돼 다음 렌더가 같은 진실을 본다
    expect(JSON.parse(localStorage.getItem("dt_t1_bodylog")).map((b) => b.date)).toEqual(["2026-08-08", "2026-08-09"]);
  });

  it("원격 조회 실패 시 덮어쓰지 않고 큐에 남긴다 (못 읽은 채 덮으면 유실)", async () => {
    localStorage.setItem("dt_t1_bodylog", JSON.stringify([{ date: "2026-08-08", weight: 75 }]));
    addPending("t1", "bodylog");
    getDocMock.mockRejectedValue(new Error("offline"));

    expect(await store.flushPendingSync()).toBe(0);
    expect(setDocMock).not.toHaveBeenCalled();
    expect(getPending("t1")).toEqual(["bodylog"]);
  });

  it("병합 대상이 아닌 키는 원격을 읽지 않는다 (읽기 비용·기존 동작 유지)", async () => {
    localStorage.setItem("dt_t1_day:2026-08-09", JSON.stringify({ meals: [], exercises: [] }));
    addPending("t1", "day:2026-08-09");
    setDocMock.mockResolvedValue(undefined);

    expect(await store.flushPendingSync()).toBe(1);
    expect(getDocMock).not.toHaveBeenCalled();
  });
});
