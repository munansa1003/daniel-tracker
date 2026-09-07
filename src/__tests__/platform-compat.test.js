// Vercel ↔ Firebase 플랫폼 차이 — 한 코드가 두 곳에서 각자 맞게 도는가.
//
// 병행 기간(DR-8, 14일) 동안 같은 커밋이 Vercel과 Firebase 양쪽에 배포된다.
// 그래서 "Firebase에 맞춘 변경"은 전부 **옛 동작을 지우지 않는 형태**여야 한다.
// 여기서 고정하는 것이 그 조건이다.
import { describe, it, expect, vi, afterEach } from "vitest";
import { getClientIp } from "../../api/_lib/security.js";
import { bridgeParams, resetParamsBridge } from "../../api/_lib/params-bridge.js";

afterEach(() => { vi.unstubAllEnvs(); resetParamsBridge(); });

const req = (headers, socket) => ({ headers, socket });

describe("getClientIp — rate limit 버킷 키의 우선순위", () => {
  it("Firebase Hosting: fastly-client-ip가 최우선", () => {
    // Hosting 앞단이 Fastly라 XFF에는 CDN IP가 실린다. 그대로 쓰면 전 사용자가 한 버킷으로
    // 뭉쳐 남이 쓴 횟수 때문에 내가 429를 맞는다 — 이 순서가 그걸 막는다.
    expect(getClientIp(req({ "fastly-client-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1" })))
      .toBe("203.0.113.7");
  });

  it("Vercel: fastly 헤더가 없으면 x-forwarded-for 첫 항목 (옛 동작 그대로)", () => {
    expect(getClientIp(req({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
  });

  it("x-real-ip 폴백도 유지 — 옛 코드의 마지막 수단이었다", () => {
    expect(getClientIp(req({ "x-real-ip": "192.0.2.5" }))).toBe("192.0.2.5");
  });

  it("헤더가 하나도 없으면 소켓 주소 → 그것도 없으면 'unknown'", () => {
    expect(getClientIp(req({}, { remoteAddress: "127.0.0.1" }))).toBe("127.0.0.1");
    expect(getClientIp(req({}))).toBe("unknown");
  });

  it("빈 문자열·공백뿐인 헤더는 값이 아니다 — 다음 후보로 넘어간다", () => {
    expect(getClientIp(req({ "fastly-client-ip": "   ", "x-forwarded-for": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(getClientIp(req({ "fastly-client-ip": "", "x-real-ip": "192.0.2.5" }))).toBe("192.0.2.5");
  });

  it("XFF 항목의 앞뒤 공백은 잘라낸다", () => {
    expect(getClientIp(req({ "x-forwarded-for": "  198.51.100.1 , 10.0.0.1" }))).toBe("198.51.100.1");
  });
});

describe("WEB_API_KEY — 이름이 둘인 이유(FIREBASE_ 접두사는 Functions에서 예약어)", () => {
  // 세 파일이 같은 값을 같은 규칙으로 읽는다. 하나만 고치면 로그인 검증이 파일마다 달라진다.
  const load = async () => {
    vi.resetModules();
    return {
      auth: await import("../../api/_lib/verify-auth.js"),
      uid: await import("../../api/_lib/verify-uid.js"),
    };
  };

  const capturedKey = async (fn) => {
    let url = "";
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
      url = String(u);
      return { ok: false, json: async () => ({}) };
    });
    await fn();
    spy.mockRestore();
    return new URL(url).searchParams.get("key");
  };

  it("새 이름 WEB_API_KEY가 최우선", async () => {
    vi.stubEnv("WEB_API_KEY", "new-key");
    vi.stubEnv("FIREBASE_WEB_API_KEY", "old-key");
    const { auth, uid } = await load();
    expect(await capturedKey(() => auth.verifyIdToken("tok"))).toBe("new-key");
    expect(await capturedKey(() => uid.verifyUid("tok", "u1"))).toBe("new-key");
  });

  it("새 이름이 없으면 옛 이름을 읽는다 — Vercel 병행 배포가 그대로 산다", async () => {
    vi.stubEnv("WEB_API_KEY", "");
    vi.stubEnv("FIREBASE_WEB_API_KEY", "old-key");
    const { auth } = await load();
    expect(await capturedKey(() => auth.verifyIdToken("tok"))).toBe("old-key");
  });

  it("둘 다 없어도 공개 웹 키 폴백으로 동작한다 — 미설정이 고장이 아니다", async () => {
    vi.stubEnv("WEB_API_KEY", "");
    vi.stubEnv("FIREBASE_WEB_API_KEY", "");
    const { auth } = await load();
    const key = await capturedKey(() => auth.verifyIdToken("tok"));
    expect(key).toMatch(/^AIza/);
  });

  it("값은 import 시점이 아니라 호출 시점에 읽는다 — params 어댑터보다 먼저 굳으면 안 된다", async () => {
    vi.stubEnv("WEB_API_KEY", "");
    const { auth } = await load();                 // 여기서는 값이 없다
    vi.stubEnv("WEB_API_KEY", "late-key");         // 모듈 로드 뒤에 채워진다
    expect(await capturedKey(() => auth.verifyIdToken("tok"))).toBe("late-key");
  });
});

describe("params 어댑터 — 빈 자리만 메운다", () => {
  const param = (v) => ({ value: () => v });

  it("process.env에 없으면 채운다", () => {
    vi.stubEnv("BRIDGE_TEST_A", "");
    expect(bridgeParams({ BRIDGE_TEST_A: param("from-param") })).toEqual(["BRIDGE_TEST_A"]);
    expect(globalThis.process.env.BRIDGE_TEST_A).toBe("from-param");
  });

  it("이미 값이 있으면 덮지 않는다 — 런타임이 넣어 준 시크릿이 이긴다", () => {
    vi.stubEnv("BRIDGE_TEST_B", "runtime-value");
    expect(bridgeParams({ BRIDGE_TEST_B: param("from-param") }, { key: "b" })).toEqual([]);
    expect(globalThis.process.env.BRIDGE_TEST_B).toBe("runtime-value");
  });

  it("빈 값·던지는 param은 건너뛴다 — 값 부재는 정상 상태(기능 off)다", () => {
    vi.stubEnv("BRIDGE_TEST_C", "");
    vi.stubEnv("BRIDGE_TEST_D", "");
    const filled = bridgeParams({
      BRIDGE_TEST_C: param(""),
      BRIDGE_TEST_D: { value: () => { throw new Error("unbound secret"); } },
    }, { key: "c" });
    expect(filled).toEqual([]);
    expect(globalThis.process.env.BRIDGE_TEST_C).toBe("");
  });

  it("그룹별로 1회씩 — 에뮬레이터는 네 그룹이 한 프로세스라 전역 플래그면 하나만 채워진다", () => {
    vi.stubEnv("BRIDGE_TEST_E", "");
    vi.stubEnv("BRIDGE_TEST_F", "");
    bridgeParams({ BRIDGE_TEST_E: param("e") }, { key: "api" });
    bridgeParams({ BRIDGE_TEST_F: param("f") }, { key: "ingress" });
    expect(globalThis.process.env.BRIDGE_TEST_E).toBe("e");
    expect(globalThis.process.env.BRIDGE_TEST_F).toBe("f");
    // 같은 그룹의 두 번째 호출은 건너뛴다(경고 반복 방지)
    vi.stubEnv("BRIDGE_TEST_G", "");
    expect(bridgeParams({ BRIDGE_TEST_G: param("g") }, { key: "api" })).toEqual([]);
  });
});

describe("export-view 진단 필드 — 필드 이름은 유지, 출처만 플랫폼별", () => {
  const loadHandler = async () => {
    vi.resetModules();
    return (await import("../../api/export-view.js")).default;
  };
  const makeRes = () => {
    const res = { statusCode: 0, body: "", headers: {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = JSON.stringify(b); return res; };
    res.send = (b) => { res.body = b; return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    return res;
  };
  const diag = async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler({ method: "GET", headers: {}, query: { diag: "1" }, url: "/export/diag" }, res);
    return JSON.parse(res.body);
  };

  it("Vercel 값이 있으면 그대로 쓴다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    const body = await diag();
    expect(body.vercelEnv).toBe("production");
    expect(body.commit).toBe("abcdef1");
    expect(body.branch).toBe("main");
  });

  it("Firebase에서는 Cloud Run의 K_SERVICE/K_REVISION으로 대체된다", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "");
    vi.stubEnv("K_SERVICE", "exportview");
    vi.stubEnv("K_REVISION", "exportview-00007-abc");
    const body = await diag();
    expect(body.vercelEnv).toBe("exportview");
    expect(body.commit).toBe("exportview-00007-abc");
    expect(body.branch).toBe("unknown");
  });

  it("어느 쪽도 없으면 unknown — 진단이 죽지 않는다", async () => {
    for (const k of ["VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_REF", "K_SERVICE", "K_REVISION"]) {
      vi.stubEnv(k, "");
    }
    const body = await diag();
    expect(body.vercelEnv).toBe("unknown");
    expect(body.commit).toBe("unknown");
    expect(body.branch).toBe("unknown");
    expect(body.route).toBe("export-view");
  });
});
