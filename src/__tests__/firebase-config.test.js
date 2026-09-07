// firebase.json · package.json · functions.js가 서로 어긋나지 않는지.
//
// 이 파일이 막는 것은 전부 "조용히 틀리는" 종류다 — 빌드도 통과하고 테스트도 통과하는데
// 배포하면 안 되거나 엉뚱하게 도는 것들:
//   · rewrite의 region이 함수 region과 다르면 Hosting이 없는 함수를 부른다(404/500).
//   · 겹치는 glob의 순서가 뒤집히면 `/api/health-import`가 ingress가 아니라 api로 간다.
//   · SPA fallback(`**`)이 마지막이 아니면 모든 API 경로가 index.html로 간다.
//   · `functions.ignore`에 `src/__tests__`·`dist`가 빠지면 배포본이 불필요하게 커진다.
//   · `pinTag`(DR-15)와 `minInstances`는 양립 불가 — 둘 다 켜면 배포가 거부된다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const firebaseJson = readJson("firebase.json");
const pkg = readJson("package.json");
const firebaserc = readJson(".firebaserc");

const mod = await import("../../functions.js");
const { FUNCTIONS_REGION } = mod;

const rewrites = firebaseJson.hosting.rewrites;
const fnRewrites = rewrites.filter(r => r.function);
const sourceOf = (src) => rewrites.findIndex(r => r.source === src);

describe("리전 — 리터럴이 두 파일에 흩어져 있다", () => {
  it("모든 함수 rewrite의 region이 FUNCTIONS_REGION과 같다", () => {
    expect(fnRewrites.length).toBeGreaterThan(0);
    for (const r of fnRewrites) {
      expect(r.function.region, `rewrite ${r.source}`).toBe(FUNCTIONS_REGION);
    }
  });

  it("배포되는 함수 4개의 region도 같다 — rewrite만 맞고 함수가 다른 리전이면 못 찾는다", () => {
    for (const name of ["api", "ingress", "exportView", "cronReminders"]) {
      expect(mod[name].__endpoint.region, name).toEqual([FUNCTIONS_REGION]);
    }
  });

  it("rewrite가 가리키는 functionId가 실제 export 이름이다", () => {
    for (const r of fnRewrites) {
      expect(typeof mod[r.function.functionId], `functionId ${r.function.functionId}`).toBe("function");
      expect(mod[r.function.functionId].__endpoint).toBeTruthy();
    }
  });
});

describe("rewrite 순서 — Hosting은 첫 번째로 맞는 규칙을 쓴다", () => {
  it("구체 경로가 /api/** 보다 앞에 있다", () => {
    const wildcard = sourceOf("/api/**");
    expect(wildcard).toBeGreaterThan(-1);
    for (const src of ["/api/health-import", "/api/body-import"]) {
      expect(sourceOf(src), src).toBeGreaterThan(-1);
      expect(sourceOf(src), `${src} 는 /api/** 보다 앞이어야 한다`).toBeLessThan(wildcard);
    }
  });

  it("/api/health-import·/api/body-import는 ingress, 나머지 /api/**는 api로 간다", () => {
    expect(rewrites[sourceOf("/api/health-import")].function.functionId).toBe("ingress");
    expect(rewrites[sourceOf("/api/body-import")].function.functionId).toBe("ingress");
    expect(rewrites[sourceOf("/api/**")].function.functionId).toBe("api");
  });

  it("/export/* 3종이 전부 exportView로 간다 (경로형 포함)", () => {
    for (const src of ["/export/diag", "/export/view", "/export/view/**"]) {
      expect(sourceOf(src), src).toBeGreaterThan(-1);
      expect(rewrites[sourceOf(src)].function.functionId).toBe("exportView");
    }
  });

  it("SPA fallback(**)이 맨 마지막이고 index.html로 간다", () => {
    const last = rewrites[rewrites.length - 1];
    expect(last.source).toBe("**");
    expect(last.destination).toBe("/index.html");
    expect(rewrites.filter(r => r.source === "**")).toHaveLength(1);
  });
});

describe("pinTag (DR-15) — 채널마다 함수 버전을 고정한다", () => {
  it("함수 rewrite 전부 pinTag: true", () => {
    for (const r of fnRewrites) expect(r.function.pinTag, r.source).toBe(true);
  });

  it("어떤 함수도 예열 인스턴스를 잡지 않는다 — minInstances는 pinTag와 양립 불가", () => {
    // 미설정이면 SDK가 ResetValue 표식을 넣는다(숫자가 아님) — 숫자일 때만 0인지 본다.
    for (const name of ["api", "ingress", "exportView", "cronReminders"]) {
      const mi = mod[name].__endpoint.minInstances;
      expect(typeof mi === "number" ? mi : 0, name).toBe(0);
    }
  });
});

describe("functions 블록", () => {
  const fns = firebaseJson.functions[0];

  it("루트가 함수 소스이고 런타임은 nodejs22 (DR-3·DR-4)", () => {
    expect(fns.source).toBe(".");
    expect(fns.runtime).toBe("nodejs22");
  });

  it("ignore가 테스트·빌드 산출물·로컬 비밀을 배포본에서 뺀다", () => {
    for (const p of ["node_modules", ".git", "dist", "docs", "src/__tests__", "public", ".secret.local", ".env.local"]) {
      expect(fns.ignore, p).toContain(p);
    }
  });

  it("src는 통째로 제외하지 않는다 — api/*가 ../src의 순수 모듈을 import한다", () => {
    expect(fns.ignore).not.toContain("src");
  });
});

describe("package.json — 함수 패키지로서의 계약", () => {
  it("main이 함수 진입점이고 engines.node가 런타임과 같다", () => {
    expect(pkg.main).toBe("functions.js");
    expect(pkg.engines.node).toBe("22");
    expect(`nodejs${pkg.engines.node}`).toBe(firebaseJson.functions[0].runtime);
  });

  it("express는 4.x — 5는 req.query가 매번 새 객체라 쿼리 주입이 사라진다", () => {
    expect(pkg.dependencies.express).toMatch(/^\^?4\./);
    expect(pkg.dependencies["firebase-functions"]).toMatch(/^\^?7\./);
  });

  it("firebase-tools는 의존성이 아니다 — SessionStart 훅의 npm ci가 느려진다", () => {
    expect(pkg.dependencies["firebase-tools"]).toBeUndefined();
    expect(pkg.devDependencies["firebase-tools"]).toBeUndefined();
  });

  it("firebase-admin은 넣지 않는다 — 서버가 Firestore 자격증명을 갖지 않는 태세(원칙 2)", () => {
    expect(pkg.dependencies["firebase-admin"]).toBeUndefined();
    expect(pkg.devDependencies["firebase-admin"]).toBeUndefined();
  });

  it("test:emu 스크립트가 있고 기본 test와 섞이지 않는다", () => {
    expect(pkg.scripts["test:emu"]).toContain("emulators:exec");
    expect(pkg.scripts.test).toBe("vitest");
  });
});

describe("hosting · .firebaserc", () => {
  it("hosting.public이 빌드 산출물 디렉터리다", () => {
    expect(firebaseJson.hosting.public).toBe("dist");
  });

  it("sw/manifest/index는 no-cache — 배포가 즉시 잡혀야 한다", () => {
    const noCache = firebaseJson.hosting.headers.find(h => h.headers.some(x => x.value === "no-cache"));
    expect(noCache.source).toContain("sw.js");
    expect(noCache.source).toContain("index.html");
    const immutable = firebaseJson.hosting.headers.find(h => h.source === "/assets/**");
    expect(immutable.headers[0].value).toContain("immutable");
  });

  it("프로젝트 별칭 3종 — default·prod는 기존 프로젝트, staging은 별도", () => {
    expect(firebaserc.projects.default).toBe("daniel-tracker-cb781");
    expect(firebaserc.projects.prod).toBe("daniel-tracker-cb781");
    expect(firebaserc.projects.staging).toBeTruthy();
    expect(firebaserc.projects.staging).not.toBe(firebaserc.projects.prod);
  });
});

describe("함수 그룹별 자원 — 01 §2 매핑표", () => {
  it("api는 512MiB/60s (사진 base64 파싱) · 나머지 onRequest는 256MiB/30s", () => {
    expect(mod.api.__endpoint.availableMemoryMb).toBe(512);
    expect(mod.api.__endpoint.timeoutSeconds).toBe(60);
    for (const name of ["ingress", "exportView"]) {
      expect(mod[name].__endpoint.availableMemoryMb, name).toBe(256);
      expect(mod[name].__endpoint.timeoutSeconds, name).toBe(30);
    }
  });

  it("크론은 20:00 Asia/Seoul · 재시도 0 (재시도 = 같은 사람에게 푸시 두 번)", () => {
    const t = mod.cronReminders.__endpoint.scheduleTrigger;
    expect(t.schedule).toBe("0 20 * * *");
    expect(t.timeZone).toBe("Asia/Seoul");
    expect(t.retryConfig.retryCount).toBe(0);
    expect(mod.cronReminders.__endpoint.timeoutSeconds).toBe(120);
  });

  it("시크릿 바인딩이 그룹의 필요와 맞는다 (DR-7 — 존재가 확실한 4개만)", () => {
    const keys = (name) => mod[name].__endpoint.secretEnvironmentVariables.map(s => s.key).sort();
    expect(keys("api")).toEqual(["ANTHROPIC_API_KEY", "KV_REST_API_TOKEN"]);
    expect(keys("ingress")).toEqual(["IMPORT_TOKEN", "KV_REST_API_TOKEN"]);
    expect(keys("exportView")).toEqual(["KV_REST_API_TOKEN"]);
    expect(keys("cronReminders")).toEqual(["KV_REST_API_TOKEN", "VAPID_PRIVATE_KEY"]);
  });

  it("인바디 자격증명은 어느 함수에도 바인딩하지 않는다 — 봉인(DR-6)", () => {
    for (const name of ["api", "ingress", "exportView", "cronReminders"]) {
      const keys = mod[name].__endpoint.secretEnvironmentVariables.map(s => s.key);
      expect(keys, name).not.toContain("INBODY_LOGIN_ID");
      expect(keys, name).not.toContain("INBODY_LOGIN_PW");
      expect(keys, name).not.toContain("SHARE_TEST_TOKEN");
    }
  });
});
