// functions.js × 실물 핸들러 — 라우터를 통과한 요청이 검문까지 그대로 도달하는가.
//
// functions-router.test.js가 "어디로 가는가"를 봤다면, 여기서는 "가서 무엇이 되는가"를 본다.
// 배선은 맞는데 요청의 모양(본문 타입·헤더·쿼리)이 Vercel과 달라 검문이 다르게 끝나는 경우가
// 이 이전의 진짜 위험이고, 그건 핸들러를 모킹하면 절대 안 잡힌다.
//
// 여기서 고정하는 계약(02 §2 컷오버 런북 B3의 스모크 3종과 같은 것):
//   · `/export/view/<32hex>` → 404 + `X-Share-View`  (AI 공유 링크가 살아 있다는 신호)
//   · `/export/diag`         → JSON `route: "export-view"`
//   · `/api/health-import` 잘못된 토큰 → 401 (함수가 살아 있고 env 3종이 있다는 신호)
//
// 본문 파싱은 functions-framework 흉내를 낸다: JSON은 파싱하고 그 밖의 Content-Type은
// **Buffer**로 준다. 그래야 "단축어가 본문을 파일로 첨부하는" 경로(기존 Buffer 분기)가
// Firebase에서도 같은 결과를 내는지 확인할 수 있다.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import express from "express";

// KV는 인메모리로 — "설정돼 있다"까지만 재현한다. 실제 저장은 여기 관심사가 아니다.
vi.mock("../../api/_lib/kv.js", () => ({
  kvConfigured: () => true,
  kv: async () => null,
}));

const { apiApp, ingressApp, exportViewApp } = await import("../../functions.js");

// functions-framework의 본문 파서 순서(JSON 먼저, 나머지는 raw Buffer)를 그대로 흉내낸다.
const jsonParser = express.json({ limit: "10mb" });
const rawParser = express.raw({ type: "*/*", limit: "10mb" });
const framework = (app) => (req, res) =>
  jsonParser(req, res, () => rawParser(req, res, () => app(req, res)));

const servers = [];
function listen(app) {
  return new Promise((resolve) => {
    const srv = createServer(framework(app));
    servers.push(srv);
    srv.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${srv.address().port}`));
  });
}
afterAll(() => { for (const s of servers) s.close(); vi.unstubAllEnvs(); });

const ORIGIN = "https://bodyplan.example";
const TOKEN = "correct-import-token";

beforeAll(() => {
  vi.stubEnv("PRODUCTION_ORIGIN", ORIGIN);
  vi.stubEnv("PREVIEW_ORIGIN_SUFFIX", "");
  vi.stubEnv("IMPORT_TOKEN", TOKEN);
  vi.stubEnv("IMPORT_UID", "uid-1");
  vi.stubEnv("IMPORT_CUTOVER_DATE", "2026-01-01");
  vi.stubEnv("IMPORT_BODY_CUTOVER_DATE", "2026-01-01");
  vi.stubEnv("SHARE_TEST_TOKEN", "");
  // rateLimit이 실제 네트워크를 타지 않도록 KV env는 비워 둔다(fail-open으로 통과).
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});

const API = await listen(apiApp);
const INGRESS = await listen(ingressApp);
const EXPORT = await listen(exportViewApp);

describe("api 그룹 — checkOrigin이 라우터 뒤에서 그대로 선다", () => {
  it("Origin 없는 POST는 403 — 라우터가 통과시켜도 검문은 그대로", async () => {
    const r = await fetch(`${API}/api/analyze-food`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(403);
    expect(r.headers.get("x-function-group")).toBe("api");
    expect((await r.json()).error).toBe("Forbidden origin");
  });

  it("허용 origin의 OPTIONS는 200 + CORS 헤더 — preflight 분기가 살아 있다", async () => {
    const r = await fetch(`${API}/api/analyze-food`, { method: "OPTIONS", headers: { Origin: ORIGIN } });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("PREVIEW_ORIGIN_SUFFIX가 켜지면 프리뷰 채널 origin도 통과한다(스테이징 전용)", async () => {
    vi.stubEnv("PREVIEW_ORIGIN_SUFFIX", "bodyplan-staging--*.web.app");
    const ok = await fetch(`${API}/api/analyze-food`, {
      method: "OPTIONS",
      headers: { Origin: "https://bodyplan-staging--pr-12-ab34cd.web.app" },
    });
    // 같은 `.web.app`이라도 프로젝트가 다르면 막힌다 — 패턴이 프로젝트를 묶는다는 증거
    const other = await fetch(`${API}/api/analyze-food`, {
      method: "OPTIONS",
      headers: { Origin: "https://someone-else--pr-1-zz.web.app" },
    });
    vi.stubEnv("PREVIEW_ORIGIN_SUFFIX", "");
    expect(ok.status).toBe(200);
    expect(other.status).toBe(403);
  });

  it("PREVIEW_ORIGIN_SUFFIX가 비어 있으면 프리뷰 origin은 막힌다 — prod의 기본 상태", async () => {
    const r = await fetch(`${API}/api/analyze-food`, {
      method: "OPTIONS",
      headers: { Origin: "https://bodyplan-staging--pr-12-ab34cd.web.app" },
    });
    expect(r.status).toBe(403);
  });
});

describe("ingress 그룹 — 단축어 검문(런북 B3 스모크)", () => {
  it("잘못된 토큰은 401 + X-Function-Group: ingress", async () => {
    const r = await fetch(`${INGRESS}/api/health-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Import-Token": "wrong" },
      body: "{}",
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("x-function-group")).toBe("ingress");
  });

  it("비JSON Content-Type이어도 401이다 — 400(파싱 실패)이 아니다", async () => {
    // 단축어의 'URL 콘텐츠 가져오기'가 본문을 파일로 첨부하면 이 모양으로 온다.
    // 토큰 검문이 본문 파싱보다 앞이므로, 여기서 400이 나오면 순서가 뒤집힌 것이다.
    const r = await fetch(`${INGRESS}/api/health-import`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Import-Token": "wrong" },
      body: '{"data":{"workouts":[]}}',
    });
    expect(r.status).toBe(401);
  });

  it("비JSON 본문이 Buffer로 도착해도 기존 분기가 JSON으로 파싱한다", async () => {
    const r = await fetch(`${INGRESS}/api/health-import`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Import-Token": TOKEN },
      body: '{"source":"test","workouts":[]}',
    });
    const body = await r.json();
    // 봉투 검증에서 무엇이 나오든 상관없다. 확인하려는 것은 "파싱 자체는 됐다" 한 가지다.
    expect(body.message || "").not.toContain("본문 JSON 파싱 실패");
  });

  it("비JSON 본문이 진짜 JSON이 아니면 400 — Buffer 분기가 실제로 도는 증거", async () => {
    const r = await fetch(`${INGRESS}/api/health-import`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Import-Token": TOKEN },
      body: "this is not json",
    });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toContain("본문 JSON 파싱 실패");
  });
});

describe("exportView 그룹 — AI 공유 링크(P1)", () => {
  it("/export/view/<32hex>는 404 + X-Share-View — 경로형 토큰이 핸들러까지 갔다는 증거", async () => {
    const r = await fetch(`${EXPORT}/export/view/${"0".repeat(32)}`);
    expect(r.status).toBe(404);
    expect(r.headers.get("x-share-view")).toBeTruthy();
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("토큰 형식이 아니면 같은 404 — 존재 여부가 새지 않는다", async () => {
    const r = await fetch(`${EXPORT}/export/view/not-a-token`);
    expect(r.status).toBe(404);
  });

  it("/export/diag는 200 JSON route=export-view (런북 B3 스모크)", async () => {
    const r = await fetch(`${EXPORT}/export/diag`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.route).toBe("export-view");
    expect(body.tokenConfigured).toBe(false);   // SHARE_TEST_TOKEN 미설정 = 진단 샘플 off
    expect(body.shareEnabled).toBe(true);
  });

  it("진단에 값은 실리지 않는다 — 설정 여부·길이만", async () => {
    const r = await fetch(`${EXPORT}/export/diag`);
    const raw = await r.text();
    expect(raw).not.toContain(TOKEN);
    expect(JSON.parse(raw).tokenLength).toBe(0);
  });

  it("GET이 아니면 405 — 공개 경로의 메서드 제한이 그대로", async () => {
    const r = await fetch(`${EXPORT}/export/view`, { method: "POST" });
    expect(r.status).toBe(405);
  });
});
