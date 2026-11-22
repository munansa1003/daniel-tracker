import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// AI 분석 API 로그인 확인 (api/_lib/ai-auth.js + analyze-* 라우트 + 클라이언트 postAI).
// 실제 Google·Anthropic 호출 없이: 토큰 검증은 verify-auth.js 목, Anthropic은 fetch 스텁.

vi.mock("../auth.js", () => ({ getIdToken: vi.fn(async () => "good-token") }));

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: "",
    status(c) { res.statusCode = c; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    json(o) { res.body = JSON.stringify(o); return res; },
    end() { return res; },
  };
  return res;
}
const ORIGIN = "http://localhost:5173";
const makeReq = (body = {}) => ({ method: "POST", body, query: {}, headers: { origin: ORIGIN } });

// Anthropic 응답 스텁 — 라우트별로 파싱 가능한 텍스트
const anthropicText = {
  "analyze-food": '{"n":"사과 1개","u":"1개","p":0,"c":25,"f":0,"k":100}',
  "analyze-exercise": '[{"n":"걷기","m":3.5}]',
  "analyze-body": '{"coaching":"좋아요. 근육이 늘었어요."}',
};
let verifyCalls = 0;
let anthropicCalls = 0;

beforeEach(() => {
  vi.resetModules();
  verifyCalls = 0;
  anthropicCalls = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.doMock("../../api/_lib/verify-auth.js", () => ({
    verifyIdToken: async (t) => {
      verifyCalls++;
      return t === "good-token" ? "uid-daniel" : t === "other-token" ? "uid-stranger" : null;
    },
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function stubAnthropic(route) {
  vi.stubGlobal("fetch", vi.fn(async () => {
    anthropicCalls++;
    return { ok: true, json: async () => ({ content: [{ text: anthropicText[route] }] }) };
  }));
}
const load = async (route) => (await import(`../../api/${route}.js`)).default;
const bodyFor = {
  "analyze-food": { query: "사과 1개" },
  "analyze-exercise": { query: "걷기" },
  "analyze-body": { current: { weight: 72, muscle: 33, fatPct: 15 } },
};

describe("parseAllowedUids", () => {
  it("빈 값·공백·없음은 null(스위치 꺼짐), 콤마 목록은 배열", async () => {
    const { parseAllowedUids } = await import("../../api/_lib/ai-auth.js");
    expect(parseAllowedUids(undefined)).toBe(null);
    expect(parseAllowedUids("")).toBe(null);
    expect(parseAllowedUids(" , ")).toBe(null);
    expect(parseAllowedUids(" a , b ")).toEqual(["a", "b"]);
    expect(parseAllowedUids("*")).toEqual(["*"]);
  });
});

describe.each(["analyze-food", "analyze-exercise", "analyze-body"])("%s 로그인 확인", (route) => {
  it("AI_ALLOWED_UIDS 없음 → 토큰 없이도 지금처럼 동작 (병행 호환)", async () => {
    stubAnthropic(route);
    const res = makeRes();
    await (await load(route))(makeReq(bodyFor[route]), res);
    expect(res.statusCode).toBe(200);
    expect(anthropicCalls).toBe(1);
    expect(verifyCalls).toBe(0);
  });

  it("설정됨 + 토큰 없음 → 401, Anthropic 호출 안 함", async () => {
    vi.stubEnv("AI_ALLOWED_UIDS", "uid-daniel");
    stubAnthropic(route);
    const res = makeRes();
    await (await load(route))(makeReq(bodyFor[route]), res);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("auth_required");
    expect(anthropicCalls).toBe(0);
  });

  it("설정됨 + 가짜 토큰 → 401", async () => {
    vi.stubEnv("AI_ALLOWED_UIDS", "uid-daniel");
    stubAnthropic(route);
    const res = makeRes();
    await (await load(route))(makeReq({ ...bodyFor[route], idToken: "forged" }), res);
    expect(res.statusCode).toBe(401);
    expect(anthropicCalls).toBe(0);
  });

  it("설정됨 + 목록에 없는 계정 → 403", async () => {
    vi.stubEnv("AI_ALLOWED_UIDS", "uid-daniel");
    stubAnthropic(route);
    const res = makeRes();
    await (await load(route))(makeReq({ ...bodyFor[route], idToken: "other-token" }), res);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe("not_allowed");
    expect(anthropicCalls).toBe(0);
  });

  it("설정됨 + 허용 계정 → 200", async () => {
    vi.stubEnv("AI_ALLOWED_UIDS", "someone-else, uid-daniel");
    stubAnthropic(route);
    const res = makeRes();
    await (await load(route))(makeReq({ ...bodyFor[route], idToken: "good-token" }), res);
    expect(res.statusCode).toBe(200);
    expect(anthropicCalls).toBe(1);
  });
});

describe("requireAiAuth 세부", () => {
  it('"*" → 로그인만 되어 있으면 누구든 통과, 미로그인은 401', async () => {
    vi.stubEnv("AI_ALLOWED_UIDS", "*");
    const { requireAiAuth } = await import("../../api/_lib/ai-auth.js");
    expect(await requireAiAuth(makeReq({ idToken: "other-token" }), makeRes())).toBe(true);
    const res = makeRes();
    expect(await requireAiAuth(makeReq({}), res)).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("같은 토큰은 잠깐 기억해 Google 조회를 반복하지 않는다", async () => {
    vi.stubEnv("AI_ALLOWED_UIDS", "uid-daniel");
    const { requireAiAuth } = await import("../../api/_lib/ai-auth.js");
    for (let i = 0; i < 3; i++) {
      expect(await requireAiAuth(makeReq({ idToken: "good-token" }), makeRes())).toBe(true);
    }
    expect(verifyCalls).toBe(1);
  });

  it("실패한 토큰은 기억하지 않는다(매번 다시 확인)", async () => {
    vi.stubEnv("AI_ALLOWED_UIDS", "uid-daniel");
    const { requireAiAuth } = await import("../../api/_lib/ai-auth.js");
    await requireAiAuth(makeReq({ idToken: "forged" }), makeRes());
    await requireAiAuth(makeReq({ idToken: "forged" }), makeRes());
    expect(verifyCalls).toBe(2);
  });

  it("토큰이 문자열이 아니면 검증 시도 없이 401", async () => {
    vi.stubEnv("AI_ALLOWED_UIDS", "uid-daniel");
    const { requireAiAuth } = await import("../../api/_lib/ai-auth.js");
    const res = makeRes();
    expect(await requireAiAuth(makeReq({ idToken: { evil: 1 } }), res)).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(verifyCalls).toBe(0);
  });
});

describe("클라이언트 postAI", () => {
  it("로그인 토큰을 본문 idToken으로 함께 보낸다", async () => {
    const f = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", f);
    const { postAI } = await import("../aiApi.js");
    await postAI("/api/analyze-food", { query: "사과" });
    const [path, opts] = f.mock.calls[0];
    expect(path).toBe("/api/analyze-food");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ query: "사과", idToken: "good-token" });
  });

  it("미로그인(토큰 null)이면 idToken 없이 보낸다", async () => {
    const auth = await import("../auth.js");
    auth.getIdToken.mockResolvedValueOnce(null);
    const f = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", f);
    const { postAI } = await import("../aiApi.js");
    await postAI("/api/analyze-exercise", { query: "걷기" });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ query: "걷기" });
  });
});
