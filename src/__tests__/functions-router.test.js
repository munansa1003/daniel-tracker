// functions.js 라우터 배선 — "어느 경로가 어느 핸들러로 가는가"만 본다.
//
// 이 파일이 지키는 것은 이전의 P0/P1 항목이다:
//   ① `/export/view/:t` → `?t=` 치환. Firebase Hosting은 Vercel과 달리 경로 조각을 쿼리로
//      바꿔 주지 않는다. 이게 깨지면 AI 공유 링크 기능 전체가 죽는다(02 §1 #13).
//   ② `req.url`이 마운트로 잘리지 않는다. Express에서 `app.use("/export", …)`처럼 하위 경로에
//      마운트하면 `req.url`이 `/view/<t>`로 줄고 export-view.js의 경로 파싱이 조용히 실패한다.
//   ③ 그룹 경계 — `api`에 없는 이름은 404여야 한다. 그 404가 "rewrite가 엉뚱한 그룹으로 갔다"를
//      알려 주는 신호이기 때문이다(겹치는 glob의 우선순위는 문서로 확정되지 않은 항목).
//
// 핸들러는 전부 모킹한다. 여기서 보고 싶은 것은 검문 로직이 아니라 배선이고,
// 실물 핸들러와의 결합은 functions-integration.test.js가 따로 본다.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createServer } from "node:http";

const { echo, calls } = vi.hoisted(() => {
  const calls = [];
  const echo = (name) => (req, res) => {
    calls.push(name);
    res.status(200).json({
      handler: name,
      url: req.url,
      method: req.method,
      query: { ...(req.query || {}) },
      group: res.getHeader("X-Function-Group"),
    });
  };
  return { echo, calls };
});

vi.mock("../../api/analyze-food.js", () => ({ default: echo("analyze-food") }));
vi.mock("../../api/analyze-exercise.js", () => ({ default: echo("analyze-exercise") }));
vi.mock("../../api/analyze-body.js", () => ({ default: echo("analyze-body") }));
vi.mock("../../api/import-inbox.js", () => ({ default: echo("import-inbox") }));
vi.mock("../../api/push-sync.js", () => ({ default: echo("push-sync") }));
vi.mock("../../api/share-create.js", () => ({ default: echo("share-create") }));
vi.mock("../../api/share-revoke.js", () => ({ default: echo("share-revoke") }));
vi.mock("../../api/health-import.js", () => ({ default: echo("health-import") }));
vi.mock("../../api/body-import.js", () => ({ default: echo("body-import") }));
vi.mock("../../api/export-view.js", () => ({ default: echo("export-view") }));
vi.mock("../../api/cron-reminders.js", () => ({ default: vi.fn(), runReminders: vi.fn() }));

const { apiApp, ingressApp, exportViewApp, API_HANDLERS, INGRESS_HANDLERS } = await import("../../functions.js");

// 앱마다 임시 포트에 띄운다. Hosting 에뮬레이터 없이도 라우터 자체는 순수 Node로 검증된다.
const servers = [];
function listen(app) {
  return new Promise((resolve) => {
    const srv = createServer(app);
    servers.push(srv);
    srv.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${srv.address().port}`));
  });
}
afterAll(() => { for (const s of servers) s.close(); });

const API = await listen(apiApp);
const INGRESS = await listen(ingressApp);
const EXPORT = await listen(exportViewApp);

beforeEach(() => { calls.length = 0; });

describe("api 그룹 — 앱이 부르는 7개 경로", () => {
  const names = ["analyze-food", "analyze-exercise", "analyze-body", "import-inbox", "push-sync", "share-create", "share-revoke"];

  it.each(names)("/api/%s → 같은 이름의 핸들러", async (name) => {
    const r = await fetch(`${API}/api/${name}`, { method: "POST" });
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.handler).toBe(name);
    expect(calls).toEqual([name]);
  });

  it("핸들러 맵이 Vercel 파일 목록과 1:1 — 새 api 파일을 추가하고 배선을 잊으면 여기서 걸린다", () => {
    expect(Object.keys(API_HANDLERS).sort()).toEqual([...names].sort());
    expect(Object.keys(INGRESS_HANDLERS).sort()).toEqual(["body-import", "health-import"]);
  });

  it("미등록 이름은 404 JSON — 핸들러를 부르지 않는다", async () => {
    const r = await fetch(`${API}/api/nope`, { method: "POST" });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("not-found");
    expect(calls).toEqual([]);
  });

  it("ingress 소관 경로가 api 그룹에 오면 404 — rewrite 순서가 어긋났다는 신호", async () => {
    const r = await fetch(`${API}/api/health-import`, { method: "POST" });
    expect(r.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("OPTIONS도 핸들러까지 간다 — app.all이라 preflight 분기가 핸들러 안에서 그대로 동작", async () => {
    const r = await fetch(`${API}/api/analyze-food`, { method: "OPTIONS" });
    expect(r.status).toBe(200);
    expect((await r.json()).method).toBe("OPTIONS");
  });

  it("응답에 X-Function-Group: api — 어느 함수가 답했는지 헤더로 남는다", async () => {
    const r = await fetch(`${API}/api/push-sync`, { method: "POST" });
    expect(r.headers.get("x-function-group")).toBe("api");
  });
});

describe("ingress 그룹 — 단축어 수신 창구 2개", () => {
  it.each(["health-import", "body-import"])("/api/%s → 같은 이름의 핸들러", async (name) => {
    const r = await fetch(`${INGRESS}/api/${name}`, { method: "POST" });
    expect((await r.json()).handler).toBe(name);
  });

  it("api 소관 경로가 ingress로 오면 404 — 그룹 경계가 실제로 서 있다", async () => {
    const r = await fetch(`${INGRESS}/api/analyze-food`, { method: "POST" });
    expect(r.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("응답에 X-Function-Group: ingress", async () => {
    const r = await fetch(`${INGRESS}/api/health-import`, { method: "POST" });
    expect(r.headers.get("x-function-group")).toBe("ingress");
  });
});

describe("exportView 그룹 — vercel.json의 쿼리 치환을 라우터가 재현한다", () => {
  it("/export/view/<토큰> → req.query.t 로 주입 (Hosting은 :t를 쿼리로 안 바꿔 준다)", async () => {
    const token = "a".repeat(32);
    const r = await fetch(`${EXPORT}/export/view/${token}`);
    const body = await r.json();
    expect(body.handler).toBe("export-view");
    expect(body.query.t).toBe(token);
  });

  it("경로형에서도 req.url이 온전하다 — 마운트로 잘리면 핸들러의 경로 파싱이 죽는다", async () => {
    const token = "b".repeat(32);
    const r = await fetch(`${EXPORT}/export/view/${token}`);
    expect((await r.json()).url).toBe(`/export/view/${token}`);
  });

  it("쿼리(?t=)가 이미 있으면 그것이 이긴다 — 경로 주입이 덮어쓰지 않는다", async () => {
    const r = await fetch(`${EXPORT}/export/view/path-token?t=query-token`);
    expect((await r.json()).query.t).toBe("query-token");
  });

  it("/export/view (쿼리형)은 그대로 통과 — ?token= 하위호환 경로", async () => {
    const r = await fetch(`${EXPORT}/export/view?token=abc`);
    const body = await r.json();
    expect(body.query.token).toBe("abc");
    expect(body.query.t).toBeUndefined();
  });

  it("/export/diag → req.query.diag='1' 주입", async () => {
    const r = await fetch(`${EXPORT}/export/diag`);
    const body = await r.json();
    expect(body.handler).toBe("export-view");
    expect(body.query.diag).toBe("1");
  });

  it("응답에 X-Function-Group: exportView", async () => {
    const r = await fetch(`${EXPORT}/export/diag`);
    expect(r.headers.get("x-function-group")).toBe("exportView");
  });

  it("세 경로 밖은 404 — 핸들러를 부르지 않는다", async () => {
    const r = await fetch(`${EXPORT}/export/other`);
    expect(r.status).toBe(404);
    expect(calls).toEqual([]);
  });
});
