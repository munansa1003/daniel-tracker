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
import { readFileSync, readdirSync, statSync } from "node:fs";
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

  it("firebase-admin을 **직접** 의존성에 넣지 않는다 (원칙 2)", () => {
    // 주의: firebase-functions@7은 firebase-admin을 **선택 아닌 peer**로 선언한다
    // (peerDependenciesMeta에 optional 표시가 없다) → npm이 자동 설치하므로 node_modules와
    // lockfile에는 존재한다. 그것까지 막을 수는 없고, 막을 필요도 없다:
    // 태세를 지키는 것은 "설치되지 않았다"가 아니라 **"아무도 import 하지 않는다"**이다.
    // 그 진짜 조건은 아래 테스트가 본다.
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

  it("앱 셸과 SW는 no-cache — **`/`가 반드시 포함**된다", () => {
    // 사용자가 실제로 여는 주소는 `/`(그리고 `/?tab=...`)다. `/index.html`만 적으면
    // 그 규칙은 요청 경로가 `/index.html`일 때만 붙고, `/`는 Hosting 기본 캐시(1시간)로
    // 떨어져 **배포가 최대 1시간 늦게 잡힌다** — 눈에 안 띄는 종류의 지연이다.
    const noCache = firebaseJson.hosting.headers
      .filter(h => h.headers.some(x => x.key === "Cache-Control" && x.value === "no-cache"))
      .map(h => h.source);
    for (const src of ["/", "/index.html", "/sw.js", "/push-sw.js", "/manifest.webmanifest"]) {
      expect(noCache, src).toContain(src);
    }
  });

  it("해시 붙은 assets만 장기 캐시", () => {
    const immutable = firebaseJson.hosting.headers.find(h => h.source === "/assets/**");
    expect(immutable.headers[0].value).toContain("immutable");
  });

  it("header source에 중괄호 확장을 쓰지 않는다 — Hosting 문서가 보장하는 glob이 아니다", () => {
    // `/{a,b,c}` 형태는 에뮬레이터에서는 동작했지만 공식 문서의 glob 부분집합에 없다.
    // 규칙 하나가 조용히 안 붙으면 SW가 캐시돼 배포가 안 잡히는 형태로 나타난다.
    for (const h of firebaseJson.hosting.headers) {
      expect(h.source, h.source).not.toMatch(/[{}]/);
    }
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

describe("보안 태세 — 서버는 Firestore 자격증명을 갖지 않는다 (01 §1 원칙 2)", () => {
  // `firebase-admin`은 firebase-functions@7의 **선택 아닌 peer**라 node_modules에는 설치된다.
  // 설치를 막을 수는 없다. 그러나 배포된 함수에는 런타임 서비스 계정의 ADC가 붙어 있으므로,
  // 누가 한 줄 `import "firebase-admin"`을 넣는 순간 서버가 Firestore를 직접 쓸 수 있게 된다 —
  // 그러면 "day 문서를 쓰는 주체는 앱 하나"라는 이 저장소의 구조가 조용히 무너진다.
  // 그래서 **의존성 목록이 아니라 소스 전체**를 본다. 이것이 태세를 실제로 지키는 단언이다.
  const roots = ["api", "src", "functions.js", "scripts"];

  const walk = (rel) => {
    const abs = resolve(ROOT, rel);
    let st;
    try { st = statSync(abs); } catch { return []; }
    if (st.isFile()) return /\.(js|jsx|mjs)$/.test(abs) ? [abs] : [];
    // 테스트는 배포되지 않으므로 대상이 아니다 — 그리고 이 파일 자체가 그 문자열을 담고 있다.
    return readdirSync(abs).flatMap((e) => (e === "node_modules" || e === "__tests__" ? [] : walk(`${rel}/${e}`)));
  };
  const files = roots.flatMap(walk);

  it("스캔 대상이 실제로 잡힌다 (자기검증)", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith("functions.js"))).toBe(true);
  });

  it("어떤 소스도 firebase-admin을 import·require 하지 않는다", () => {
    const offenders = files.filter((f) => /["']firebase-admin(\/[^"']*)?["']/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(ROOT + "/", ""))).toEqual([]);
  });
});
