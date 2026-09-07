// Hosting 에뮬레이터 스모크 — 단위 테스트로는 절대 못 잡는 것만 본다.
//
// 단위 테스트는 express 앱을 직접 두드리므로 "라우터가 맞다"까지만 증명한다.
// 여기서 증명하는 것은 그 앞단이다:
//   ① firebase.json의 rewrite가 실제로 함수로 프록시되는가
//   ② **겹치는 glob의 우선순위** — `/api/health-import`(ingress)가 `/api/**`(api)보다 앞이라는
//      전제는 공식 문서 원문으로 확인되지 않은 항목이다(01 §3.2 [미확인]). 그래서 눈이 아니라
//      `X-Function-Group` 헤더로 "무엇이 응답했나"를 직접 읽는다. 이 두 줄이 이 파일의 존재 이유다.
//   ③ 정적 파일 우선·SPA fallback·캐시 헤더가 의도대로 붙는가
//
// 전제: `npm run build`로 dist/가 있어야 하고(Hosting이 그걸 서빙한다), 에뮬레이터가 떠 있어야 한다.
// 시크릿은 하나도 없는 상태로 돈다 — KV 미설정(rate limit fail-open)·Anthropic 미설정에서도
// 5xx가 아니라 **설계된 상태 코드**가 나오는지가 확인 대상이다.
import { describe, it, expect, beforeAll } from "vitest";

const BASE = globalThis.process.env.EMU_BASE || "http://127.0.0.1:5000";

const get = (path, init) => fetch(`${BASE}${path}`, { redirect: "manual", ...init });

beforeAll(async () => {
  // 첫 호출은 함수 콜드스타트라 느리다 — 여기서 한 번 깨워 두고 본 테스트의 시간을 아낀다.
  try { await get("/export/diag"); } catch { /* 아래 테스트가 실패로 드러낸다 */ }
});

describe("정적 서빙 · SPA fallback", () => {
  it("/ 는 200 HTML이고 **no-cache** — 앱 셸이 캐시되면 배포가 늦게 잡힌다", async () => {
    // 사용자가 실제로 여는 주소는 `/`다. 헤더 규칙에 `/index.html`만 적으면 이 요청에는
    // 안 붙고 Hosting 기본 캐시(1시간)로 떨어진다 — 눈에 안 띄는 지연이라 여기서 못 박는다.
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("cache-control")).toContain("no-cache");
  });

  it("없는 경로는 index.html로 — SPA fallback(마지막 rewrite)", async () => {
    const r = await get("/nonexistent-page");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<div id=\"root\">");
  });

  it("sw.js는 no-cache — 배포가 즉시 잡혀야 한다", async () => {
    const r = await get("/sw.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-cache");
  });

  it("push-sw.js도 정적으로 그대로 나온다", async () => {
    const r = await get("/push-sw.js");
    expect(r.status).toBe(200);
  });
});

describe("rewrite → 함수 (겹치는 glob의 우선순위)", () => {
  it("/api/analyze-food 는 api 그룹이 받는다", async () => {
    const r = await get("/api/analyze-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(r.headers.get("x-function-group")).toBe("api");
    expect(r.status).toBe(403);          // Origin이 없으니 checkOrigin이 막는 것이 정답
  });

  it("OPTIONS는 함수까지 라우팅되고 4xx/5xx로 죽지 않는다", async () => {
    // ⚠️ 여기서 `X-Function-Group`을 요구하면 안 된다 — **에뮬레이터에서만** 그 헤더가 없다.
    // 원인: 함수 에뮬레이터가 `FIREBASE_DEBUG_FEATURES={"enableCors":true}`를 넣고
    // (firebase-tools `lib/emulator/functionsEmulator.js:996-998`), firebase-functions의
    // `onRequest`가 그 플래그를 보면 핸들러를 cors 미들웨어로 감싼다
    // (`lib/v2/providers/https.js:53-65`). 그 미들웨어가 preflight를 **204로 먼저 끝내서**
    // 우리 라우터가 아예 돌지 않는다.
    // 프로덕션에서는 `cors` 옵션을 주지 않았고 디버그 플래그도 없으므로 이 감싸기가 없다 →
    // OPTIONS가 핸들러까지 가서 Vercel과 같게 동작한다(checkOrigin → 403/200).
    // 그 계약은 functions-router.test.js·functions-integration.test.js가 지킨다.
    //
    // 그래서 여기서는 두 환경 모두에서 참인 것만 본다: 라우팅이 되고(404가 아니고)
    // 터지지 않는다(5xx가 아니다). 204(에뮬레이터)·403(프로덕션, Origin 없음)이 정상이다.
    const r = await get("/api/analyze-food", { method: "OPTIONS" });
    expect([200, 204, 403]).toContain(r.status);
  });

  it("/api/health-import 는 **ingress**가 받는다 — 구체 경로가 /api/** 를 이긴다", async () => {
    const r = await get("/api/health-import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Import-Token": "wrong" },
      body: "{}",
    });
    expect(r.headers.get("x-function-group")).toBe("ingress");
    // env 3종이 없으면 503(비활성), 있으면 토큰 불일치로 401. 어느 쪽이든 5xx 크래시가 아니다.
    expect([401, 503]).toContain(r.status);
  });

  it("/api/body-import 도 ingress", async () => {
    const r = await get("/api/body-import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Import-Token": "wrong" },
      body: "{}",
    });
    expect(r.headers.get("x-function-group")).toBe("ingress");
  });

  it("비JSON Content-Type POST도 같은 결과 — 400(파싱 실패)이 아니다", async () => {
    // 단축어가 본문을 파일로 첨부하면 이 모양으로 온다. functions-framework가 Buffer로 주고
    // 핸들러의 기존 분기가 받는다 — 검문이 본문 파싱보다 앞이라 상태 코드는 위와 같아야 한다.
    const r = await get("/api/health-import", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Import-Token": "wrong" },
      body: '{"data":{"workouts":[]}}',
    });
    expect([401, 503]).toContain(r.status);
    expect(r.status).not.toBe(400);
  });
});

describe("공유 뷰 — AI 리더 시나리오(P1)", () => {
  it("/export/view/<32hex> → 404 + X-Share-View (경로형 토큰이 함수까지 갔다)", async () => {
    const r = await get(`/export/view/${"0".repeat(32)}`);
    expect(r.headers.get("x-function-group")).toBe("exportView");
    expect(r.status).toBe(404);
    expect(r.headers.get("x-share-view")).toBeTruthy();
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("/export/diag → JSON route=export-view", async () => {
    const r = await get("/export/diag");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.route).toBe("export-view");
    expect(body).toHaveProperty("tokenConfigured");
    expect(body).toHaveProperty("shareEnabled");
  });

  it("/export/view (쿼리형)도 함수가 받는다 — 하위호환 경로", async () => {
    const r = await get("/export/view");
    expect(r.headers.get("x-function-group")).toBe("exportView");
    expect(r.status).toBe(404);          // 토큰이 없으니 404가 정답(존재를 숨김)
  });
});
