import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// shareLink.js는 auth.js→firebase.js를 끌어오므로(node 환경엔 self 없음) 인증 seam만 목킹.
// 아래 검증 대상은 순수 유틸 + 서버 라우트라 실제 Firebase는 필요 없다.
vi.mock("../auth.js", () => ({ getIdToken: async () => "good-token" }));

import { isValidToken, ttlHoursOf, TTL_OPTIONS, shareKey } from "../../api/_lib/share-store.js";
import { shareUrlOf, remainingText, isExpired, TTL_CHOICES } from "../shareLink.js";

// ── 순수 유틸 ──
describe("share-store 순수 유틸", () => {
  it("토큰 형식 — 32자 hex만 허용(경로 주입 차단)", () => {
    expect(isValidToken("a".repeat(32))).toBe(true);
    expect(isValidToken("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isValidToken("A".repeat(32))).toBe(false);      // 대문자 불가
    expect(isValidToken("a".repeat(31))).toBe(false);      // 길이
    expect(isValidToken("../../etc/passwd")).toBe(false);
    expect(isValidToken(null)).toBe(false);
  });
  it("TTL 매핑 — 미지정/이상값은 24시간", () => {
    expect(ttlHoursOf("1h")).toBe(1);
    expect(ttlHoursOf("24h")).toBe(24);
    expect(ttlHoursOf("7d")).toBe(168);
    expect(ttlHoursOf("bogus")).toBe(24);
    expect(ttlHoursOf(undefined)).toBe(24);
  });
  it("KV 키 네임스페이스", () => {
    expect(shareKey("abc")).toBe("share:abc");
    expect(TTL_OPTIONS.map((o) => o.key)).toEqual(["1h", "24h", "7d"]);
  });
});

describe("shareLink 클라이언트 유틸", () => {
  it("공유 URL은 절대주소(origin 포함) + 경로형 토큰", () => {
    // 경로형(/export/view/<token>) — 일부 외부 리더가 쿼리스트링을 유실해서
    expect(shareUrlOf("abc123", "https://x.app")).toBe("https://x.app/export/view/abc123");
  });
  it("남은 시간 표기", () => {
    const now = 1_000_000_000_000;
    expect(remainingText(now + 3 * 86400000 + 3600000, now)).toBe("3일 1시간 남음");
    expect(remainingText(now + 5 * 3600000, now)).toBe("5시간 0분 남음");
    expect(remainingText(now + 30 * 60000, now)).toBe("30분 남음");
    expect(remainingText(now - 1, now)).toBe(null); // 만료
  });
  it("만료 판정 — 토큰/시각 없으면 만료 취급", () => {
    const now = 1_000_000_000_000;
    expect(isExpired(null, now)).toBe(true);
    expect(isExpired({ token: "a", expiresAt: now - 1 }, now)).toBe(true);
    expect(isExpired({ token: "a", expiresAt: now + 1000 }, now)).toBe(false);
    expect(isExpired({ expiresAt: now + 1000 }, now)).toBe(true); // 토큰 없음
  });
  it("UI 선택지 3종", () => {
    expect(TTL_CHOICES.map((o) => o.key)).toEqual(["1h", "24h", "7d"]);
  });
});

// ── 서버 라우트 ──
function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: "",
    status(c) { res.statusCode = c; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    send(b) { res.body = typeof b === "string" ? b : JSON.stringify(b); return res; },
    json(o) { res.body = JSON.stringify(o); return res; },
    end() { return res; },
  };
  return res;
}
const ORIGIN = "http://localhost:5173"; // security.js 화이트리스트에 있는 dev origin
const makeReq = (body = {}, method = "POST") => ({ method, body, query: {}, headers: { origin: ORIGIN } });

// KV·인증을 목킹 — 실제 Upstash/Google 호출 없이 라우트 로직만 검증
const kvStore = new Map();
beforeEach(() => {
  kvStore.clear();
  vi.resetModules();
  // KV env는 일부러 비워둔다 — rateLimit(env 직접 참조)은 skip되어 소음이 없고,
  // 핸들러의 kvConfigured/kv는 아래 mock 모듈이 대신한다.
  vi.doMock("../../api/_lib/kv.js", () => ({
    kvConfigured: () => true,
    kv: async (...args) => {
      const [cmd, key, value] = args;
      if (cmd === "SET") { kvStore.set(key, value); return "OK"; }
      if (cmd === "GET") return kvStore.get(key) ?? null;
      if (cmd === "DEL") { kvStore.delete(key); return 1; }
      return null;
    },
  }));
  vi.doMock("../../api/_lib/verify-auth.js", () => ({
    verifyIdToken: async (t) => (t === "good-token" ? "uid-1" : t === "other-token" ? "uid-2" : null),
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const loadCreate = async () => (await import("../../api/share-create.js")).default;
const loadRevoke = async () => (await import("../../api/share-revoke.js")).default;
const loadView = async () => (await import("../../api/export-view.js")).default;

describe("share-create", () => {
  it("정상 발급 — 32자 hex 토큰·만료시각·경로 반환, KV에 저장", async () => {
    const handler = await loadCreate();
    const res = makeRes();
    await handler(makeReq({ idToken: "good-token", pkg: "x".repeat(200), ttl: "24h" }), res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(isValidToken(body.token)).toBe(true);
    expect(body.path).toBe(`/export/view/${body.token}`);
    expect(body.ttlHours).toBe(24);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    // KV에 uid와 함께 저장됐는지
    const saved = JSON.parse(kvStore.get(`share:${body.token}`));
    expect(saved.uid).toBe("uid-1");
    expect(saved.pkg.length).toBe(200);
  });

  it("인증 실패 → 401 · 저장 없음", async () => {
    const handler = await loadCreate();
    const res = makeRes();
    await handler(makeReq({ idToken: "bad", pkg: "x".repeat(200) }), res);
    expect(res.statusCode).toBe(401);
    expect(kvStore.size).toBe(0);
  });

  it("패키지 누락/과대 → 400 / 413", async () => {
    const handler = await loadCreate();
    const r1 = makeRes();
    await handler(makeReq({ idToken: "good-token", pkg: "짧음" }), r1);
    expect(r1.statusCode).toBe(400);

    const r2 = makeRes();
    await handler(makeReq({ idToken: "good-token", pkg: "x".repeat(700 * 1024) }), r2);
    expect(r2.statusCode).toBe(413);
    expect(kvStore.size).toBe(0);
  });

  it("GET → 405", async () => {
    const handler = await loadCreate();
    const res = makeRes();
    await handler(makeReq({}, "GET"), res);
    expect(res.statusCode).toBe(405);
  });
});

describe("share-revoke", () => {
  it("소유자만 폐기 가능 — 남의 링크는 403, 내 링크는 tombstone으로 전환", async () => {
    const create = await loadCreate();
    const cRes = makeRes();
    await create(makeReq({ idToken: "good-token", pkg: "x".repeat(200) }), cRes);
    const token = JSON.parse(cRes.body).token;

    const revoke = await loadRevoke();
    const other = makeRes();
    await revoke(makeReq({ idToken: "other-token", token }), other);
    expect(other.statusCode).toBe(403);
    expect(kvStore.has(`share:${token}`)).toBe(true); // 그대로 남음

    const mine = makeRes();
    await revoke(makeReq({ idToken: "good-token", token }), mine);
    expect(mine.statusCode).toBe(200);
    // DEL이 아니라 폐기 흔적(tombstone) — 뷰가 410으로 안내할 수 있게 스냅샷 본문은 소멸
    const tomb = JSON.parse(kvStore.get(`share:${token}`));
    expect(tomb.revoked).toBe(true);
    expect(tomb.pkg).toBeUndefined();

    // 재폐기는 멱등 성공
    const again = makeRes();
    await revoke(makeReq({ idToken: "good-token", token }), again);
    expect(again.statusCode).toBe(200);
    expect(JSON.parse(again.body).alreadyGone).toBe(true);
  });

  it("이미 없는 토큰도 200(멱등)", async () => {
    const revoke = await loadRevoke();
    const res = makeRes();
    await revoke(makeReq({ idToken: "good-token", token: "a".repeat(32) }), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).alreadyGone).toBe(true);
  });
});

describe("export-view — 공유 링크(?t=)", () => {
  const viewReq = (query) => ({ method: "GET", query, headers: {} });

  it("유효 토큰 → 저장된 스냅샷 렌더 + noindex/no-store", async () => {
    const create = await loadCreate();
    const cRes = makeRes();
    await create(makeReq({ idToken: "good-token", pkg: "# Body Plan 분석 요청\n실제 스냅샷 내용".padEnd(200, " ") }), cRes);
    const token = JSON.parse(cRes.body).token;

    const view = await loadView();
    const res = makeRes();
    await view(viewReq({ t: token }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("Body Plan 분석 요청");
    expect(res.body).toContain("공유 시점 스냅샷");
    expect(res.body).toContain('content="noindex, nofollow"');
  });

  it("폐기된 토큰 → 410 Gone (X-Share-View: revoked, 본문 데이터 없음)", async () => {
    const create = await loadCreate();
    const cRes = makeRes();
    await create(makeReq({ idToken: "good-token", pkg: "x".repeat(200) }), cRes);
    const token = JSON.parse(cRes.body).token;
    const revoke = await loadRevoke();
    await revoke(makeReq({ idToken: "good-token", token }), makeRes());

    const view = await loadView();
    const res = makeRes();
    await view(viewReq({ t: token }), res);
    expect(res.statusCode).toBe(410);
    expect(res.headers["x-share-view"]).toBe("revoked");
    expect(res.body).toContain("만료되었거나 폐기");
    expect(res.body).not.toContain("Body Plan 분석 요청");
  });

  it("만료 경계(TTL 정리 직전, expiresAt 경과) → 410 expired", async () => {
    const token = "b".repeat(32);
    kvStore.set(`share:${token}`, JSON.stringify({ uid: "uid-1", pkg: "x".repeat(200), createdAt: 1, expiresAt: Date.now() - 1000 }));
    const view = await loadView();
    const res = makeRes();
    await view(viewReq({ t: token }), res);
    expect(res.statusCode).toBe(410);
    expect(res.headers["x-share-view"]).toBe("expired");
  });

  it("정상 조회 시 접근 통계 갱신 (accessCount·lastAccessedAt, TTL 보존)", async () => {
    const create = await loadCreate();
    const cRes = makeRes();
    await create(makeReq({ idToken: "good-token", pkg: "x".repeat(200) }), cRes);
    const token = JSON.parse(cRes.body).token;

    const view = await loadView();
    await view(viewReq({ t: token }), makeRes());
    await view(viewReq({ t: token }), makeRes());
    // touchShare는 fire-and-forget — mock KV는 동기라 즉시 반영됨
    const rec = JSON.parse(kvStore.get(`share:${token}`));
    expect(rec.accessCount).toBe(2);
    expect(rec.lastAccessedAt).toBeGreaterThan(0);
    expect(rec.pkg.length).toBe(200); // 본문 보존
  });

  it("형식이 틀린 토큰 → 404 (KV 조회 안 함)", async () => {
    const view = await loadView();
    const res = makeRes();
    await view(viewReq({ t: "../../secret" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("진단 모드가 shareEnabled를 보고함", async () => {
    const view = await loadView();
    const res = makeRes();
    await view(viewReq({ diag: "1" }), res);
    expect(JSON.parse(res.body).shareEnabled).toBe(true);
  });
});
