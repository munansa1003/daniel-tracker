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
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const { bridgeSpy, runRemindersSpy } = vi.hoisted(() => ({
  bridgeSpy: vi.fn(() => []),
  runRemindersSpy: vi.fn(async () => ({ ok: true, checked: 0, sent: 0, cleaned: 0 })),
}));

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
vi.mock("../../api/cron-reminders.js", () => ({ default: vi.fn(), runReminders: runRemindersSpy }));

// params 어댑터는 배선 여부만 보면 되므로 스파이로 바꾼다(동작은 platform-compat.test.js가 본다).
vi.mock("../../api/_lib/params-bridge.js", () => ({ bridgeParams: bridgeSpy, resetParamsBridge: () => {} }));

const { apiApp, ingressApp, exportViewApp, API_HANDLERS, INGRESS_HANDLERS, cronReminders } = await import("../../functions.js");

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

  it("**디스크의 api/*.js 전부**가 어느 그룹엔가 배선돼 있다", () => {
    // 앞 버전은 맵의 키를 같은 파일의 하드코딩 배열과 비교했다 — 새 파일을 추가하고 배선을
    // 잊어도 절대 걸리지 않는, 이름만 그럴듯한 단언이었다. 이제 실제 디렉터리를 읽는다.
    const dir = fileURLToPath(new URL("../../api", import.meta.url));
    const onDisk = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)).sort();
    // 이 둘은 HTTP 라우트가 아니다: cron-reminders는 onSchedule, export-view는 /export/* 전용.
    const routed = onDisk.filter((n) => n !== "cron-reminders" && n !== "export-view");
    const wired = [...Object.keys(API_HANDLERS), ...Object.keys(INGRESS_HANDLERS)].sort();
    expect(onDisk.length).toBeGreaterThan(8);          // 자기검증: 디렉터리를 실제로 읽었다
    expect(wired).toEqual(routed);
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

  it("요청마다 params 어댑터가 **그 그룹의 키로** 호출된다", async () => {
    // 이 배선(group() 미들웨어의 bridgeParams 한 줄)은 지워도 다른 테스트가 전부 통과한다.
    // 어댑터의 동작 자체는 platform-compat.test.js가 보므로, 여기서는 "배선이 있는가"만 본다.
    // 그룹 키가 섞이면 에뮬레이터(4그룹 한 프로세스)에서 param이 안 채워지므로 키까지 확인한다.
    bridgeSpy.mockClear();
    await fetch(`${API}/api/push-sync`, { method: "POST" });
    expect(bridgeSpy).toHaveBeenCalled();
    expect(bridgeSpy.mock.calls[0][1]).toEqual({ key: "api" });
    // 넘긴 param 목록에 이 그룹이 실제로 쓰는 이름이 들어 있다
    expect(Object.keys(bridgeSpy.mock.calls[0][0])).toEqual(
      expect.arrayContaining(["PRODUCTION_ORIGIN", "PREVIEW_ORIGIN_SUFFIX", "KV_REST_API_URL", "ANTHROPIC_API_KEY"])
    );
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

  it("후행 슬래시(/export/diag/)도 진단으로 인식한다", async () => {
    // express는 이 경로도 같은 라우트로 보낸다. 경로 비교가 엄격하면 diag 주입만 빠져서
    // 진단을 열려던 사람에게 "링크를 찾을 수 없음" 404가 나간다 — 원인 찾기 가장 어려운 형태.
    const r = await fetch(`${EXPORT}/export/diag/`);
    expect((await r.json()).query.diag).toBe("1");
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

describe("cronReminders — onSchedule 본문이 실제로 발송 본체를 부른다", () => {
  it(".run()이 runReminders를 부르고 params 어댑터도 돈다", async () => {
    // 이 본문은 HTTP가 아니라 스케줄러가 부른다 — 라우터 테스트로는 절대 안 걸린다.
    // 본체를 안 부르는 상태로 배포되면 증상은 "밤 8시에 아무 일도 안 일어남" 하나뿐이고,
    // 그것도 하루 뒤에야 안다.
    runRemindersSpy.mockClear();
    bridgeSpy.mockClear();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronReminders.run({ scheduleTime: "2026-09-07T11:00:00Z", jobName: "test" });
    log.mockRestore();
    expect(runRemindersSpy).toHaveBeenCalledTimes(1);
    expect(bridgeSpy.mock.calls.at(-1)[1]).toEqual({ key: "cronReminders" });
  });
});
