import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 공유 뷰(SSR 텍스트) 라우트 — 토큰 게이트·이스케이프·헤더를 게이트(vitest)에 편입.
// 환경변수는 vi.stubEnv 사용(src/** eslint는 브라우저 globals라 bare process 참조 금지).
const TOKEN = "test-share-token-123";

// 가짜 res — Vercel의 status/setHeader/send 체인을 최소 재현
function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    status(c) { res.statusCode = c; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    send(b) { res.body = typeof b === "string" ? b : JSON.stringify(b); return res; },
    json(o) { res.body = JSON.stringify(o); return res; },
  };
  return res;
}
const makeReq = (query = {}, method = "GET") => ({ method, query, headers: {} });

async function loadHandler() {
  const mod = await import("../../api/export-view.js");
  return mod.default;
}

beforeEach(() => { vi.stubEnv("SHARE_TEST_TOKEN", TOKEN); vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("export-view — 토큰 게이트", () => {
  it("a) 올바른 토큰 → 200 · text/html · 분석 패키지 본문 · noindex · no-store", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq({ token: TOKEN }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("Body Plan 분석 요청");           // 패키지 본문
    expect(res.body).toContain('name="robots" content="noindex, nofollow"');
    expect(res.body).toContain("Phase 1 테스트(가상 데이터)");    // 상단 메타 1줄
    expect(res.body).toContain("<pre>");
    expect(res.body).not.toContain("<script");                   // 클라이언트 JS 없음
  });

  it("b) 토큰 불일치 → 404 · 샘플 데이터 미포함", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq({ token: "wrong-token" }), res);

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("Body Plan 분석 요청");
    expect(res.body).not.toContain("닭가슴살");   // 픽스처 음식명
    expect(res.body).not.toContain("체성분");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("c) 토큰 누락 → 404", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq({}), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("Body Plan 분석 요청");
  });

  it("c-2) 서버에 토큰 미설정이면 올바른 값이 와도 404 (기본 차단)", async () => {
    vi.stubEnv("SHARE_TEST_TOKEN", "");
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq({ token: "" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("d) POST → 405", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq({ token: TOKEN }, "POST"), res);
    expect(res.statusCode).toBe(405);
    expect(res.body).not.toContain("Body Plan 분석 요청");
  });
});

describe("export-view — HTML 이스케이프", () => {
  it("e) 픽스처 음식명에 <script>가 있어도 응답에서 이스케이프됨", async () => {
    // 프로덕션 표면을 오염시키지 않도록, 테스트에서 픽스처 모듈만 교체
    vi.doMock("../../api/_lib/sample-state.js", async (orig) => {
      const real = await orig();
      return {
        sampleState: (todayStr) => {
          const s = real.sampleState(todayStr);
          const days = { ...s.allDays };
          days[todayStr] = {
            ...days[todayStr],
            meals: [{ n: "<script>alert('xss')</script> & 김밥", k: 500, p: 30, c: 60, f: 15, serving: 1, hour: 12 }],
          };
          return { ...s, allDays: days };
        },
      };
    });
    const handler = (await import("../../api/export-view.js")).default;
    const res = makeRes();
    // 상세본이 아니어도 '자주 먹은 음식 TOP'에 음식명이 실린다
    await handler(makeReq({ token: TOKEN }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("&lt;script&gt;");   // 이스케이프됨
    expect(res.body).toContain("&amp; 김밥");        // & 도 이스케이프
    expect(res.body).not.toContain("<script>alert"); // 원문 태그가 살아 있으면 안 됨
  });
});

describe("export-view — 진단 모드(?diag=1)", () => {
  it("토큰 없이도 200 · 설정 여부/커밋만 · 토큰 값과 사용자 데이터는 미노출", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq({ diag: "1" }), res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.route).toBe("export-view");
    expect(body.tokenConfigured).toBe(true);
    expect(body.tokenLength).toBe(TOKEN.length);
    expect(res.body).not.toContain(TOKEN);              // 값 자체는 절대 노출 안 함
    expect(res.body).not.toContain("Body Plan 분석 요청"); // 데이터도 없음
  });

  it("서버에 토큰 미설정이면 tokenConfigured=false (원인 구분 가능)", async () => {
    vi.stubEnv("SHARE_TEST_TOKEN", "");
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq({ diag: "1" }), res);
    expect(JSON.parse(res.body).tokenConfigured).toBe(false);
  });

  it("404 응답의 X-Share-View 헤더로 설정누락/값불일치 구분", async () => {
    const handler = await loadHandler();
    const res1 = makeRes();
    await handler(makeReq({ token: "wrong" }), res1);
    expect(res1.headers["x-share-view"]).toBe("denied");

    vi.stubEnv("SHARE_TEST_TOKEN", "");
    vi.resetModules();
    const handler2 = await loadHandler();
    const res2 = makeRes();
    await handler2(makeReq({ token: "anything" }), res2);
    expect(res2.headers["x-share-view"]).toBe("unconfigured");
  });
});
