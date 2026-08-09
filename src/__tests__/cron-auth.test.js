// 예약 푸시 엔드포인트의 검문 — 2026-08 감사 R-40.
//
// 이 라우트는 구독자 전원에게 푸시를 발송한다. 인터넷에 열린 URL이므로 검문이 유일한 방벽이다.
// 옛 조건 `if (secret && ...)`는 CRON_SECRET이 비어 있으면 검문을 통째로 건너뛰었다 —
// env 하나가 빠지는 것만으로 아무나 푸시를 반복 발송할 수 있었다. 여기서 고정하는 계약:
//   ① 비밀값이 없으면 통과가 아니라 정지(503) — 발송은 한 건도 일어나지 않는다
//   ② 비밀값이 틀리면 401
//   ③ 503과 401은 구분된다 — "env 누락"과 "누가 두드림"을 로그에서 갈라 봐야 한다
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a) => sendNotification(...a) },
}));

// KV는 구독자 1명이 있는 상태로 — 검문을 통과하면 실제로 발송 시도가 일어나야
// "검문이 막았다"와 "원래 보낼 게 없었다"가 구분된다.
vi.mock("../../api/_lib/kv.js", () => ({
  kvConfigured: () => true,
  kv: async (cmd, key) => {
    if (cmd === "SMEMBERS") return ["uid-1"];
    if (cmd === "GET" && key === "push:sub:uid-1") return JSON.stringify({ endpoint: "https://push.example/x" });
    if (cmd === "GET" && key === "push:state:uid-1") {
      return JSON.stringify({ reminders: { record: true }, lastRecordDate: "1999-01-01" });
    }
    if (cmd === "LRANGE") return [];
    return null;
  },
}));

const makeRes = () => {
  const res = { statusCode: 0, payload: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.payload = b; return res; };
  res.setHeader = () => {};
  return res;
};
const call = async (authorization) => {
  const { default: handler } = await import("../../api/cron-reminders.js");
  const res = makeRes();
  await handler({ method: "GET", headers: authorization ? { authorization } : {} }, res);
  return res;
};

beforeEach(() => {
  vi.resetModules();
  sendNotification.mockReset().mockResolvedValue({});
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  // rateLimit은 KV env를 직접 읽는다 — 비워 두면 skip되어 검문 순서만 순수하게 본다
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("cron-reminders 검문 — CRON_SECRET 미설정 시 열리지 않는다 (R-40)", () => {
  it("CRON_SECRET이 없으면 503으로 정지하고, 푸시는 한 건도 나가지 않는다", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call();
    expect(res.statusCode).toBe(503);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("CRON_SECRET이 없으면 Authorization을 그럴듯하게 붙여도 여전히 503", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call("Bearer anything");
    expect(res.statusCode).toBe(503);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("비밀값이 틀리면 401 — 설정 누락(503)과 구분된다", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    expect((await call("Bearer wrong-secret")).statusCode).toBe(401);
    expect((await call()).statusCode).toBe(401);          // 헤더 자체가 없어도 401
    expect(sendNotification).not.toHaveBeenCalled();
  });

  // 길이가 다른 값도 던지지 않고 조용히 거절해야 한다(safeEqual의 길이 분기)
  it("길이가 다른 비밀값도 예외 없이 401", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    expect((await call("Bearer x")).statusCode).toBe(401);
    expect((await call("Bearer real-secret-plus-extra")).statusCode).toBe(401);
  });

  it("비밀값이 맞으면 통과해 실제로 발송된다 — 검문이 정상 경로를 막지 않는다", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    const res = await call("Bearer real-secret");
    expect(res.statusCode).toBe(200);
    expect(sendNotification).toHaveBeenCalled();
  });
});
