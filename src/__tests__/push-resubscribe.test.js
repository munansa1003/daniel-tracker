// 구독 재등록 — 2026-11 "밤 8시 푸시가 요즘 안 온다".
//
// 크론은 푸시 서비스가 404/410을 주면 서버의 push:sub를 지운다(cron-reminders.js).
// 예전 syncPushState는 상태만 보내서, 한 번 지워진 구독이 다시는 서버에 올라가지 않았다.
// 화면은 브라우저 권한만 보고 "알림 켜짐 ✓"를 계속 띄우므로 사용자가 알아챌 수도, 고칠 수도 없었다.
// 여기서 고정하는 계약:
//   ① 브라우저에 구독이 있으면 앱이 상태를 올릴 때마다 현재 구독도 함께 올린다
//   ② 구독이 없으면(사용자가 끔) 아무것도 보내지 않는다 — 끈 알림을 되살리지 않는다
//   ③ 서버(push-sync)는 subscription이 오면 push:sub 저장 + push:uids 등록을 한다(재등록 경로)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../store.js", () => ({ getCurrentUserId: () => "uid-1" }));
vi.mock("../auth.js", () => ({ getIdToken: async () => "tok" }));

const SUB = { endpoint: "https://push.example/new", keys: { p256dh: "p", auth: "a" } };

function stubBrowser(currentSub) {
  const fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { Notification: {}, PushManager: {} });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: { getSubscription: async () => (currentSub ? { toJSON: () => currentSub } : null) },
      }),
    },
  });
  return fetchMock;
}

async function loadPush() {
  vi.resetModules();
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "test-public-key");
  return import("../push.js");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("syncPushState — 지워진 구독이 다음 실행에서 저절로 복구된다", () => {
  it("① 구독이 있으면 상태와 함께 현재 구독을 올린다", async () => {
    const fetchMock = stubBrowser(SUB);
    const { syncPushState } = await loadPush();
    await syncPushState({ state: { lastRecordDate: "2026-11-22" }, reminders: { record: true } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/push-sync");
    const body = JSON.parse(init.body);
    expect(body.uid).toBe("uid-1");
    expect(body.subscription).toEqual(SUB);
    expect(body.state).toEqual({ lastRecordDate: "2026-11-22" });
    expect(body.idToken).toBe("tok");
    expect(body.enabled).toBeUndefined(); // 해제 요청으로 오인되면 안 된다
  });

  it("② 구독이 없으면(사용자가 끔) 아무것도 보내지 않는다", async () => {
    const fetchMock = stubBrowser(null);
    const { syncPushState } = await loadPush();
    await syncPushState({ state: {}, reminders: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ③ 서버 쪽 — subscription이 오면 재등록된다. 클라이언트 수정이 의미를 가지려면 이 경로가 살아 있어야 한다.
const kvCalls = [];
vi.mock("../../api/_lib/kv.js", () => ({
  kvConfigured: () => true,
  kv: async (...args) => { kvCalls.push(args); return null; },
}));
vi.mock("../../api/_lib/security.js", async (orig) => ({
  ...(await orig()),
  checkOrigin: () => true,
  rateLimit: async () => true,
}));

describe("push-sync — 크론이 지운 구독을 다시 받아 등록한다", () => {
  beforeEach(() => { kvCalls.length = 0; });

  it("③ subscription이 오면 push:sub 저장 + push:uids 등록", async () => {
    // push-sync는 ID 토큰을 Google identitytoolkit으로 검증한다 — 그 응답만 흉내 낸다(uid 일치)
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ users: [{ localId: "uid-1" }] }) })));
    const { default: handler } = await import("../../api/push-sync.js");
    const res = { statusCode: 0, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: "POST", headers: {}, body: { uid: "uid-1", idToken: "tok", subscription: SUB, state: {}, reminders: {} } }, res);

    expect(res.statusCode).toBe(200);
    expect(kvCalls).toContainEqual(["SET", "push:sub:uid-1", JSON.stringify(SUB)]);
    expect(kvCalls).toContainEqual(["SADD", "push:uids", "uid-1"]);
  });
});
