// runReminders() — HTTP 검문에서 분리된 발송 본체.
//
// 이전 후 크론의 호출 주체가 둘이 된다:
//   · Vercel Cron  → default export 핸들러(Bearer 검문 후 본체) — 병행 기간 동안 살아 있어야 함
//   · Cloud Scheduler → functions.js의 onSchedule이 본체를 **직접** 부른다. 검문 코드가 없다.
//     방벽이 비밀값이 아니라 IAM이기 때문이다(스케줄러 SA에만 run.invoker).
// 그래서 "검문 없이 부를 수 있는 본체"가 실제로 발송까지 가는지, 그리고 그 본체가 옛
// HTTP 계약(설정 누락 500·내부 오류 500·정상 200)과 어긋나지 않는지를 여기서 고정한다.
// 검문 자체(503/401)의 계약은 cron-auth.test.js가 그대로 지킨다 — 그 파일은 손대지 않았다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a) => sendNotification(...a) },
}));

// 리마인더 종류를 하나만 켜 둔다 — 기본값은 5종이 다 켜져 있어 "몇 건 나갔나"가 흔들린다.
const ONLY_RECORD = { record: true, weight: false, backup: false, report: false, sync: false };
const NOTHING = { record: false, weight: false, backup: false, report: false, sync: false };

const kvState = { configured: true, uids: ["uid-1"], sub: { endpoint: "https://push.example/x" }, state: null, removed: [], throwOnMembers: false };
vi.mock("../../api/_lib/kv.js", () => ({
  kvConfigured: () => kvState.configured,
  kv: async (cmd, key, ...rest) => {
    if (cmd === "SMEMBERS") {
      if (kvState.throwOnMembers) throw new Error("KV down");
      return kvState.uids;
    }
    if (cmd === "GET" && key.startsWith("push:sub:")) return kvState.sub ? JSON.stringify(kvState.sub) : null;
    if (cmd === "GET" && key.startsWith("push:state:")) return kvState.state ? JSON.stringify(kvState.state) : null;
    if (cmd === "LRANGE") return [];
    if (cmd === "SREM" || cmd === "DEL") { kvState.removed.push(`${cmd} ${key} ${rest.join(" ")}`.trim()); return 1; }
    return null;
  },
}));

const load = async () => {
  vi.resetModules();
  return await import("../../api/cron-reminders.js");
};

beforeEach(() => {
  sendNotification.mockReset().mockResolvedValue({});
  kvState.configured = true;
  kvState.uids = ["uid-1"];
  kvState.sub = { endpoint: "https://push.example/x" };
  kvState.state = { reminders: ONLY_RECORD, lastRecordDate: "1999-01-01" };
  kvState.removed = [];
  kvState.throwOnMembers = false;
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("runReminders — 검문 없이 직접 부를 수 있다 (Cloud Scheduler 경로)", () => {
  it("구독자가 있으면 실제로 발송하고 집계를 돌려준다", async () => {
    const { runReminders } = await load();
    const result = await runReminders();
    expect(sendNotification).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, checked: 1, sent: 1, cleaned: 0 });
    expect(result.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("now를 주입하면 그 시각의 KST 날짜로 판단한다 — 밤 8시 KST가 기준", async () => {
    const { runReminders } = await load();
    // 2026-09-07 12:00 UTC = 2026-09-07 21:00 KST → 같은 날
    expect((await runReminders({ now: Date.UTC(2026, 8, 7, 12, 0, 0) })).today).toBe("2026-09-07");
    // 2026-09-07 16:00 UTC = 2026-09-08 01:00 KST → 다음 날. 스케줄이 UTC로 굳으면
    // 알림이 하루 밀리는데, 그게 이 한 줄로 드러난다(v2 기본 시간대가 UTC라 실수하기 쉽다).
    expect((await runReminders({ now: Date.UTC(2026, 8, 7, 16, 0, 0) })).today).toBe("2026-09-08");
  });

  it("만료된 구독(404/410)은 정리하고 계속 돈다 — 조용히 멈추지 않는다", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const { runReminders } = await load();
    const result = await runReminders();
    expect(result).toMatchObject({ checked: 1, sent: 0, cleaned: 1 });
    expect(kvState.removed.some(r => r.startsWith("DEL push:sub:uid-1"))).toBe(true);
  });

  it("VAPID 미설정이면 설정 오류로 던진다 — 조용히 0건 성공하지 않는다", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const { runReminders } = await load();
    await expect(runReminders()).rejects.toThrow(/VAPID not configured/);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("KV 미설정이면 설정 오류로 던진다", async () => {
    kvState.configured = false;
    const { runReminders } = await load();
    await expect(runReminders()).rejects.toThrow(/KV not configured/);
  });

  it("보낼 것이 없으면 발송 0 — 조건 판단은 그대로다", async () => {
    kvState.state = { reminders: NOTHING };
    const { runReminders } = await load();
    const result = await runReminders();
    expect(result.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("default export 핸들러 — 옛 HTTP 계약이 그대로다 (Vercel 병행)", () => {
  const makeRes = () => {
    const res = { statusCode: 0, payload: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.payload = b; return res; };
    res.setHeader = () => {};
    return res;
  };
  const call = async () => {
    const { default: handler } = await load();
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer real-secret" } }, res);
    return res;
  };

  it("검문 통과 → 200 + 집계", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ ok: true, checked: 1, sent: 1 });
  });

  it("설정 누락은 500 + 원인이 드러나는 메시지 (옛 동작 그대로)", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(res.payload.error).toBe("VAPID not configured");
  });

  it("발송 실패(상태코드 없음)는 루프 안에서 흡수된다 — 200 · sent 0 (옛 동작)", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    sendNotification.mockRejectedValue(new Error("transient"));
    const res = await call();
    err.mockRestore();
    expect(res.statusCode).toBe(200);
    expect(res.payload.sent).toBe(0);
    expect(res.payload.cleaned).toBe(0);   // 상태코드가 404/410이 아니면 구독을 지우지 않는다
  });

  it("본체가 던지면 500 'cron failed' — 원인은 로그로만 나간다", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    kvState.throwOnMembers = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    err.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.payload.error).toBe("cron failed");
    expect(JSON.stringify(res.payload)).not.toContain("KV down");  // 내부 사정은 응답에 안 싣는다
  });
});
