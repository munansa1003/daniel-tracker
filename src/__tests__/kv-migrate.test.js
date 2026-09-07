// scripts/kv-migrate.mjs 계약 테스트 — Upstash KV 이관 스크립트(DR-14).
//
// 이 스크립트는 **프로덕션 DB를 통째로 옮긴다**. 한 번 잘못 옮기면 `import:seen`(영구 도장)
// 유실 → 이중 계상, `push:sub` 유실 → 알림 중단, `share:*` 유실 → 공유 링크 즉사로 이어진다.
// 그런데 `scripts/`는 품질 게이트의 정적 검사 밖이다(`.claude/hooks/check.mjs`는 `eslint src api`만
// 돌고 eslint.config.js에도 src/**·api/** 블록만 있다). 그래서 **실제로 실행해서** 계약을 고정한다.
//
// 방법: Upstash REST를 흉내 내는 가짜 서버 2개(원본·대상)를 인메모리 Redis 위에 띄우고,
// 스크립트를 자식 프로세스로 돌린 뒤 ① 사람이 읽는 출력 ② 종료 코드 ③ 대상 DB의 최종 상태
// ④ 원본이 받은 명령 목록(쓰기가 하나라도 있으면 실패)을 검사한다.
//
// 고정하는 6가지: dry-run · apply · verify · TTL · 제외(rl:*) · 멱등.
// (여기에 안전장치·읽기 전용·토큰 마스킹·SCAN 페이징을 더 얹는다 — 전부 값비싼 실수 자리다)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";

const SCRIPT = fileURLToPath(new URL("../../scripts/kv-migrate.mjs", import.meta.url));
const SRC_TOKEN = "src-token-aaaaaaaaaaaaaaaaaaaa";
const DST_TOKEN = "dst-token-bbbbbbbbbbbbbbbbbbbb";

// ── 가짜 Upstash REST 서버 (인메모리 Redis) ─────────────────────────────────
// 스크립트가 실제로 보내는 명령만 구현한다. 타입 불일치·NX·TTL은 실물과 같게 다룬다.
function createFake(token) {
  const data = new Map();          // key -> { type, value, expireAt(ms|null) }
  const seen = [];                 // 이 서버가 받은 모든 명령(읽기 전용 검증용)
  const flags = { scanDuplicates: false, vanishAfterScan: null, byteLen: new Map() };

  const now = () => Date.now();
  const alive = (key) => {
    const e = data.get(key);
    if (!e) return null;
    if (e.expireAt !== null && e.expireAt <= now()) { data.delete(key); return null; }
    return e;
  };
  const typed = (key, type) => {
    const e = alive(key);
    if (!e) return null;
    if (e.type !== type) throw "WRONGTYPE Operation against a key holding the wrong kind of value";
    return e;
  };
  const glob = (pattern, s) => {
    const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${re}$`).test(s);
  };

  function exec(argv) {
    const cmd = String(argv[0]).toUpperCase();
    const a = argv.slice(1).map(String);
    switch (cmd) {
      case "SCAN": {
        const cursor = Number(a[0]) || 0;
        let match = "*";
        let count = 10;
        for (let i = 1; i < a.length; i += 2) {
          const o = a[i].toUpperCase();
          if (o === "MATCH") match = a[i + 1];
          else if (o === "COUNT") count = Number(a[i + 1]);
          else throw `ERR syntax error near ${o}`;
        }
        const keys = [...data.keys()].filter((k) => alive(k)).sort();
        const page = keys.slice(cursor, cursor + count);
        const next = cursor + count >= keys.length ? 0 : cursor + count;
        const out = page.filter((k) => glob(match, k));           // 실물처럼 페이징 뒤에 MATCH
        if (flags.scanDuplicates && out.length) out.push(out[0]); // SCAN은 중복을 줄 수 있다
        // 훑은 직후 만료되는 키를 재현한다(경합 — 시간에 기대지 않고 결정적으로)
        if (flags.vanishAfterScan && out.includes(flags.vanishAfterScan)) {
          data.delete(flags.vanishAfterScan);
        }
        return [String(next), out];
      }
      case "DBSIZE":
        return [...data.keys()].filter((k) => alive(k)).length;
      case "TYPE":
        return alive(a[0])?.type ?? "none";
      case "PTTL": {
        const e = alive(a[0]);
        if (!e) return -2;
        return e.expireAt === null ? -1 : Math.max(1, e.expireAt - now());
      }
      case "PEXPIRE": {
        const e = alive(a[0]);
        if (!e) return 0;
        e.expireAt = now() + Number(a[1]);
        return 1;
      }
      case "PERSIST": {
        const e = alive(a[0]);
        if (!e || e.expireAt === null) return 0;
        e.expireAt = null;
        return 1;
      }
      case "DEL": {
        let n = 0;
        for (const k of a) if (alive(k)) { data.delete(k); n++; }
        return n;
      }
      case "GET": {
        const e = typed(a[0], "string");
        return e ? e.value : null;
      }
      case "STRLEN": {
        const e = typed(a[0], "string");
        if (!e) return 0;
        // 비UTF-8 값 재현: 실제 저장 바이트 수는 이만큼인데 REST가 U+FFFD로 바꿔 돌려주는 상황
        if (flags.byteLen.has(a[0])) return flags.byteLen.get(a[0]);
        return Buffer.byteLength(e.value, "utf8");
      }
      case "SET": {
        const [k, v, ...rest] = a;
        let px = null;
        let nx = false;
        for (let i = 0; i < rest.length; i++) {
          const f = rest[i].toUpperCase();
          if (f === "PX") px = Number(rest[++i]);
          else if (f === "EX") px = Number(rest[++i]) * 1000;
          else if (f === "NX") nx = true;
          else throw `ERR syntax error near ${f}`;
        }
        if (nx && alive(k)) return null;
        data.set(k, { type: "string", value: v, expireAt: px === null ? null : now() + px });
        return "OK";
      }
      case "HSET": {
        const [k, ...fv] = a;
        if (fv.length === 0 || fv.length % 2 !== 0) throw "ERR wrong number of arguments for 'hset' command";
        let e = typed(k, "hash");
        if (!e) { e = { type: "hash", value: new Map(), expireAt: null }; data.set(k, e); }
        let added = 0;
        for (let i = 0; i < fv.length; i += 2) {
          if (!e.value.has(fv[i])) added++;
          e.value.set(fv[i], fv[i + 1]);
        }
        return added;
      }
      case "HGETALL": {
        const e = typed(a[0], "hash");
        if (!e) return [];
        const flat = [];
        for (const [f, v] of e.value) flat.push(f, v);        // Upstash REST와 같은 평탄 배열
        return flat;
      }
      case "HLEN": {
        const e = typed(a[0], "hash");
        return e ? e.value.size : 0;
      }
      case "SADD": {
        const [k, ...members] = a;
        if (members.length === 0) throw "ERR wrong number of arguments for 'sadd' command";
        let e = typed(k, "set");
        if (!e) { e = { type: "set", value: new Set(), expireAt: null }; data.set(k, e); }
        let added = 0;
        for (const m of members) if (!e.value.has(m)) { e.value.add(m); added++; }
        return added;
      }
      case "SMEMBERS": {
        const e = typed(a[0], "set");
        return e ? [...e.value].reverse() : [];               // 집합은 순서를 약속하지 않는다
      }
      case "SCARD": {
        const e = typed(a[0], "set");
        return e ? e.value.size : 0;
      }
      case "RPUSH": case "LPUSH": {
        const [k, ...vals] = a;
        if (vals.length === 0) throw `ERR wrong number of arguments for '${cmd.toLowerCase()}' command`;
        let e = typed(k, "list");
        if (!e) { e = { type: "list", value: [], expireAt: null }; data.set(k, e); }
        if (cmd === "RPUSH") e.value.push(...vals);
        else for (const v of vals) e.value.unshift(v);
        return e.value.length;
      }
      case "LRANGE": {
        const e = typed(a[0], "list");
        if (!e) return [];
        const stop = Number(a[2]);
        return e.value.slice(Number(a[1]), stop === -1 ? undefined : stop + 1);
      }
      case "LLEN": {
        const e = typed(a[0], "list");
        return e ? e.value.length : 0;
      }
      case "ZADD": {
        const [k, ...sm] = a;
        if (sm.length === 0 || sm.length % 2 !== 0) throw "ERR wrong number of arguments for 'zadd' command";
        let e = typed(k, "zset");
        if (!e) { e = { type: "zset", value: new Map(), expireAt: null }; data.set(k, e); }
        let added = 0;
        for (let i = 0; i < sm.length; i += 2) {
          if (!e.value.has(sm[i + 1])) added++;
          e.value.set(sm[i + 1], Number(sm[i]));
        }
        return added;
      }
      case "ZRANGE": {
        const e = typed(a[0], "zset");
        if (!e) return [];
        const withScores = a.some((x) => String(x).toUpperCase() === "WITHSCORES");
        const sorted = [...e.value.entries()].sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1));
        // 실물 Redis는 점수를 문자열로 돌려준다 — 스크립트가 Number()로 되돌리는지 확인하는 자리
        return withScores ? sorted.flatMap(([m, s]) => [m, String(s)]) : sorted.map(([m]) => m);
      }
      case "ZCARD": {
        const e = typed(a[0], "zset");
        return e ? e.value.size : 0;
      }
      default:
        throw `ERR unknown command '${cmd}'`;
    }
  }

  function dispatch(argv) {
    seen.push(argv.map(String));
    try { return { result: exec(argv) }; }
    catch (e) { return { error: typeof e === "string" ? e : String(e && e.message) }; }
  }

  const server = createServer((req, res) => {
    req.setEncoding("utf8");
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Unauthorized" });
      let parsed;
      try { parsed = JSON.parse(body); } catch { return send(400, { error: "ERR invalid JSON" }); }
      if (req.url.startsWith("/pipeline")) {
        if (!Array.isArray(parsed) || parsed.some((c) => !Array.isArray(c))) {
          return send(400, { error: "ERR pipeline expects an array of commands" });
        }
        return send(200, parsed.map(dispatch));
      }
      if (!Array.isArray(parsed)) return send(400, { error: "ERR expected a command array" });
      const r = dispatch(parsed);
      return send(r.error ? 400 : 200, r);
    });
  });

  return {
    server, data, seen, flags,
    url: () => `http://127.0.0.1:${server.address().port}`,
    reset() { data.clear(); seen.length = 0; flags.scanDuplicates = false; flags.vanishAfterScan = null; flags.byteLen.clear(); },
    // 씨앗 심기 — TTL은 남은 밀리초로 준다(null = 영구)
    seed(key, type, value, ttlMs = null) {
      const stored = type === "hash" ? new Map(Object.entries(value))
        : type === "set" ? new Set(value)
          : type === "zset" ? new Map(Object.entries(value))
            : value;
      data.set(key, { type, value: stored, expireAt: ttlMs === null ? null : Date.now() + ttlMs });
    },
    snapshot() {
      const out = {};
      for (const [k, e] of data) {
        if (e.expireAt !== null && e.expireAt <= Date.now()) continue;
        out[k] = {
          type: e.type,
          ttlMs: e.expireAt === null ? -1 : e.expireAt - Date.now(),
          value: e.type === "hash" ? Object.fromEntries(e.value)
            : e.type === "set" ? [...e.value].sort()
              : e.type === "zset" ? Object.fromEntries(e.value)
                : e.value,
        };
      }
      return out;
    },
    writes() {
      const READS = new Set(["SCAN", "TYPE", "TTL", "PTTL", "GET", "STRLEN", "HGETALL", "HLEN",
        "SMEMBERS", "SCARD", "LRANGE", "LLEN", "ZRANGE", "ZCARD", "DBSIZE", "EXISTS"]);
      return seen.filter((c) => !READS.has(String(c[0]).toUpperCase()));
    },
  };
}

const listen = (fake) => new Promise((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
const close = (fake) => new Promise((resolve) => fake.server.close(resolve));

let src;
let dst;

// 자식 프로세스로 스크립트를 실행한다 — argv 파싱·종료 코드·출력까지 실물 그대로 검사한다.
// **반드시 비동기**여야 한다: spawnSync는 vitest의 이벤트 루프를 막아 버려서, 같은 프로세스에
// 떠 있는 가짜 서버가 자식의 요청에 영원히 답하지 못한다(교착).
function run(args = [], { withDst = true, env = {} } = {}) {
  const childEnv = { ...process.env, ...env };
  // 프록시 설정이 있으면 127.0.0.1 호출이 새어나갈 수 있다 — 자식에서는 걷어낸다
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
    delete childEnv[k];
  }
  childEnv.NO_PROXY = "127.0.0.1,localhost";
  if (!("SRC_URL" in env)) childEnv.SRC_URL = src.url();
  if (!("SRC_TOKEN" in env)) childEnv.SRC_TOKEN = SRC_TOKEN;
  if (withDst) {
    if (!("DST_URL" in env)) childEnv.DST_URL = dst.url();
    if (!("DST_TOKEN" in env)) childEnv.DST_TOKEN = DST_TOKEN;
  } else {
    delete childEnv.DST_URL;
    delete childEnv.DST_TOKEN;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: childEnv, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err, all: out + err }));
  });
}

// 실제 앱이 쓰는 키 모양 그대로(api/_lib/*.js · api/*.js) 씨앗을 심는다.
const DAY = 24 * 3600 * 1000;
function seedSource() {
  src.seed("import:seen:daniel:hae-2026-08-01-run", "string", "2026-08-01T09:00:00.000Z");
  src.seed("import:body-seen:daniel:inbody-2026-08-02", "string", "2026-08-02T07:10:00.000Z");
  src.seed("import:inbox:daniel", "hash", {
    "hae-2026-08-01-run": JSON.stringify({ kind: "exercise", kcal: 320, 이름: "달리기" }),
    "hae-2026-08-02-walk": JSON.stringify({ kind: "exercise", kcal: 120 }),
  });
  src.seed("import:body-inbox:daniel", "hash", {
    "inbody-2026-08-02": JSON.stringify({ weight: 77.4, bodyFat: 15.2 }),
  });
  // 리스트는 순서가 곧 값이다(최신이 0번) — LPUSH로 뒤집히면 수신 로그가 거꾸로 보인다
  src.seed("import:log:daniel", "list", ["최신", "중간", "가장오래됨"]);
  src.seed("import:body-log:daniel", "list", ["b-최신", "b-오래됨"]);
  src.seed("push:uids", "set", ["daniel", "guest"]);
  src.seed("push:sub:daniel", "string", JSON.stringify({ endpoint: "https://push.example/abc", keys: { p256dh: "x", auth: "y" } }));
  src.seed("push:state:daniel", "string", JSON.stringify({ reminders: true, lastSentAt: "2026-09-06" }));
  src.seed("share:tok-abc123", "string", JSON.stringify({ uid: "daniel", days: 7 }), 7 * DAY);
  src.seed("share:hits:tok-abc123", "string", "5", 7 * DAY);
  src.seed("share:tok-1h", "string", JSON.stringify({ uid: "daniel", days: 1 }), 3600 * 1000);
  // 60초 뮤텍스 — 기본 제외 대상(옮기면 새 DB가 최대 1분간 잠긴 채로 시작한다)
  src.seed("import:body-cloud-lock:daniel", "string", "2026-09-07T02:00:00.000Z", 60000);
  src.seed("zset:sample", "zset", { alpha: 1, beta: 2.5 });          // 코드는 안 쓰지만 방어
  src.seed("rl:analyze-food:203.0.113.9", "string", "7", 60000);     // 제외 대상
  src.seed("rl:import-inbox:198.51.100.4", "string", "3", 60000);    // 제외 대상
}

const COPYABLE_KEYS = 13;   // rl:* 2개 제외

beforeAll(async () => {
  src = createFake(SRC_TOKEN);
  dst = createFake(DST_TOKEN);
  await Promise.all([listen(src), listen(dst)]);
});

afterAll(async () => { await Promise.all([close(src), close(dst)]); });

beforeEach(() => {
  src.reset();
  dst.reset();
  seedSource();
});

describe("kv-migrate — 점검(dry-run)", () => {
  it("아무것도 쓰지 않고 접두사별 키 수·TTL 분포·용량을 보고한다", async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("점검(dry-run)");
    expect(r.out).toMatch(/키 13개 \(제외 접두사 rl: import:body-cloud-lock: → 3개 제외\)/);
    expect(r.out).toContain("import:seen:* — 운동 중복 도장(영구)");
    expect(r.out).toContain("share:hits:* — 공유 링크 조회수");   // share:* 보다 먼저 매치돼야 한다
    expect(r.out).toMatch(/TTL 분포:.*영구 \d+/);
    expect(r.out).toMatch(/7일 이하 2/);
    expect(r.out).toMatch(/용량\(근사\): 문자열 값 합계 .* · 컬렉션 원소 \d+개/);
    expect(r.out).toContain("비어 있습니다");
    // 원본·대상 어디에도 쓰기가 없어야 한다
    expect(src.writes()).toEqual([]);
    expect(dst.writes()).toEqual([]);
    expect(Object.keys(dst.snapshot())).toEqual([]);
  });

  it("대상 env가 없어도 점검은 돈다(새 DB를 만들기 전에 먼저 재보는 용도)", async () => {
    const r = await run([], { withDst: false });
    expect(r.code).toBe(0);
    expect(r.out).toContain("DST_URL/DST_TOKEN 미설정");
  });

  it("SCAN이 여러 페이지로 오고 같은 키를 두 번 줘도 건수가 부풀지 않는다", async () => {
    src.flags.scanDuplicates = true;
    const r = await run(["--scan-count=3"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/키 13개/);
  });
});

describe("kv-migrate — 복사(--apply)", () => {
  it("모든 타입을 값·순서·TTL까지 그대로 옮긴다", async () => {
    const r = await run(["--apply"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/복사 13개 · 건너뜀\(이미 같음\) 0개/);

    const after = dst.snapshot();
    expect(Object.keys(after).sort()).toEqual([
      "import:body-inbox:daniel",
      "import:body-log:daniel",
      "import:body-seen:daniel:inbody-2026-08-02",
      "import:inbox:daniel",
      "import:log:daniel",
      "import:seen:daniel:hae-2026-08-01-run",
      "push:state:daniel",
      "push:sub:daniel",
      "push:uids",
      "share:hits:tok-abc123",
      "share:tok-1h",
      "share:tok-abc123",
      "zset:sample",
    ].sort());

    // 문자열 — 한글 값까지 그대로
    expect(after["import:inbox:daniel"].value["hae-2026-08-01-run"]).toContain("달리기");
    // 리스트 — 순서 보존(LPUSH로 복원하면 여기서 뒤집힌다)
    expect(after["import:log:daniel"].value).toEqual(["최신", "중간", "가장오래됨"]);
    expect(after["import:body-log:daniel"].value).toEqual(["b-최신", "b-오래됨"]);
    // 집합 — 원본이 순서를 뒤집어 줘도 내용이 같다
    expect(after["push:uids"].value).toEqual(["daniel", "guest"]);
    // 정렬집합 — 점수가 문자열로 와도 숫자로 복원된다
    expect(after["zset:sample"].value).toEqual({ alpha: 1, beta: 2.5 });
    expect(after["zset:sample"].type).toBe("zset");
  });

  it("원본에는 쓰기 명령을 단 하나도 보내지 않는다", async () => {
    await run(["--apply"]);
    expect(src.writes()).toEqual([]);
  });

  it("대상이 비어 있지 않으면 --allow-nonempty 없이는 거부한다", async () => {
    dst.seed("남아있던:키", "string", "x");
    const r = await run(["--apply"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--allow-nonempty");
    expect(Object.keys(dst.snapshot())).toEqual(["남아있던:키"]);   // 한 글자도 쓰지 않았다
  });

  it("토큰은 어떤 출력에도 나오지 않는다", async () => {
    const r = await run(["--apply"]);
    expect(r.all).not.toContain(SRC_TOKEN);
    expect(r.all).not.toContain(DST_TOKEN);
    expect(r.all).toContain("127.0.0.1");   // 호스트는 보여 준다(어느 DB인지 사람이 확인)
  });

  it("토큰이 틀리면 조용히 0건 복사가 아니라 실패한다", async () => {
    const r = await run(["--apply"], { env: { DST_TOKEN: "wrong-token" } });
    expect(r.code).toBe(2);
    expect(r.err).toContain("HTTP 401");
  });

  it("원본과 대상이 같은 주소면 시작조차 하지 않는다", async () => {
    const r = await run(["--apply"], { env: { DST_URL: src.url() } });
    expect(r.code).toBe(1);
    expect(r.err).toContain("같은 주소");
    expect(src.writes()).toEqual([]);
  });
});

describe("kv-migrate — 복사 순서(중간에 끊겼을 때 남는 상태)", () => {
  // 순서가 왜 값비싼지: 도장(import:seen)이 먼저 넘어가고 사서함이 안 넘어가면 그 수신분은
  // 영영 못 받는다(도장이 재수신을 막는다). push:uids가 먼저 넘어가고 구독이 없으면
  // 첫 크론이 그 uid를 목록에서 영구 삭제한다(cron-reminders.js:76).
  const firstIndexOf = (pred) => dst.seen.findIndex(pred);

  it("사서함(hash)을 도장(seen)보다 먼저 쓴다", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    const inbox = firstIndexOf((c) => c[0] === "HSET" && c[1] === "import:inbox:daniel");
    const seen = firstIndexOf((c) => c[0] === "SET" && c[1].startsWith("import:seen:"));
    expect(inbox).toBeGreaterThanOrEqual(0);
    expect(seen).toBeGreaterThanOrEqual(0);
    expect(inbox).toBeLessThan(seen);

    const bodyInbox = firstIndexOf((c) => c[0] === "HSET" && c[1] === "import:body-inbox:daniel");
    const bodySeen = firstIndexOf((c) => c[0] === "SET" && c[1].startsWith("import:body-seen:"));
    expect(bodyInbox).toBeLessThan(bodySeen);
  });

  it("push:sub 을 push:uids 보다 먼저 쓴다", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    const sub = firstIndexOf((c) => c[0] === "SET" && c[1] === "push:sub:daniel");
    const uids = firstIndexOf((c) => c[0] === "SADD" && c[1] === "push:uids");
    expect(sub).toBeGreaterThanOrEqual(0);
    expect(uids).toBeGreaterThanOrEqual(0);
    expect(sub).toBeLessThan(uids);
  });
});

describe("kv-migrate — 비UTF-8 값", () => {
  // Upstash REST는 유효하지 않은 UTF-8 바이트를 U+FFFD(?)로 **조용히** 바꿔서 돌려준다.
  // 그대로 옮기면 에러 없이 값만 상한다 — 이관에서 가장 무서운 실패 방식이라 반드시 멈춰야 한다.
  it("원본 바이트 수와 읽어온 값의 바이트 수가 다르면 복사하지 않고 실패로 보고한다", async () => {
    src.flags.byteLen.set("push:sub:daniel", 99999);   // 실제 저장 바이트는 이만큼이었다고 가정
    const r = await run(["--apply"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("push:sub:daniel: 비UTF-8 값");
    expect(r.out).toMatch(/실패 1개/);
    // 상한 값은 대상에 쓰지 않는다 — 나머지는 정상 복사된다
    expect(Object.keys(dst.snapshot())).not.toContain("push:sub:daniel");
    expect(Object.keys(dst.snapshot())).toContain("import:inbox:daniel");
  });
});

describe("kv-migrate — TTL", () => {
  it("TTL은 남은 시간으로 유지하고, 영구 키는 영구로 남긴다", async () => {
    const r = await run(["--apply"]);
    expect(r.code).toBe(0);
    const after = dst.snapshot();
    // 7일짜리 공유 링크 — 오차 5초 안
    expect(after["share:tok-abc123"].ttlMs).toBeGreaterThan(7 * DAY - 5000);
    expect(after["share:tok-abc123"].ttlMs).toBeLessThanOrEqual(7 * DAY);
    expect(after["share:hits:tok-abc123"].ttlMs).toBeGreaterThan(7 * DAY - 5000);
    // 1시간짜리 공유 링크
    expect(after["share:tok-1h"].ttlMs).toBeGreaterThan(3600 * 1000 - 5000);
    expect(after["share:tok-1h"].ttlMs).toBeLessThanOrEqual(3600 * 1000);
    // 영구 도장은 영구로
    expect(after["import:seen:daniel:hae-2026-08-01-run"].ttlMs).toBe(-1);
    expect(after["push:sub:daniel"].ttlMs).toBe(-1);
    expect(after["import:inbox:daniel"].ttlMs).toBe(-1);
  });

  it("TTL이 붙은 컬렉션도 TTL과 함께 복원된다", async () => {
    src.seed("import:inbox:temp", "hash", { a: "1" }, 3600 * 1000);
    const r = await run(["--apply"]);
    expect(r.code).toBe(0);
    const e = dst.snapshot()["import:inbox:temp"];
    expect(e.type).toBe("hash");
    expect(e.ttlMs).toBeGreaterThan(3600 * 1000 - 5000);
  });

  it("훑은 뒤에 만료돼 사라진 키는 실패가 아니라 '사라짐'으로 센다", async () => {
    src.seed("share:곧사라짐", "string", "x", 60000);
    src.flags.vanishAfterScan = "share:곧사라짐";   // SCAN 응답에는 있고, 그 다음 순간 만료
    const r = await run(["--apply"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/복사 13개 · 건너뜀\(이미 같음\) 0개 · 사라짐 1개/);
    expect(Object.keys(dst.snapshot())).not.toContain("share:곧사라짐");
  });
});

describe("kv-migrate — 제외", () => {
  it("rl:* 과 60초 인바디 락은 기본으로 옮기지 않는다", async () => {
    await run(["--apply"]);
    const keys = Object.keys(dst.snapshot());
    expect(keys.filter((k) => k.startsWith("rl:"))).toEqual([]);
    expect(keys).not.toContain("import:body-cloud-lock:daniel");   // 새 DB가 잠긴 채 시작하지 않게
    expect(keys.length).toBe(COPYABLE_KEYS);
  });

  it("--exclude 로 기본값을 갈아끼울 수 있고, 그러면 rl:* 도 따라온다", async () => {
    const r = await run(["--apply", "--exclude=share:"]);
    expect(r.code).toBe(0);
    const keys = Object.keys(dst.snapshot());
    expect(keys.filter((k) => k.startsWith("rl:")).length).toBe(2);
    expect(keys).toContain("import:body-cloud-lock:daniel");       // 기본값을 갈아끼웠으므로 따라온다
    expect(keys.filter((k) => k.startsWith("share:"))).toEqual([]);
  });
});

describe("kv-migrate — 멱등", () => {
  it("두 번 돌려도 결과가 같고, 두 번째는 전부 건너뛴다", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    const first = dst.snapshot();
    const writesAfterFirst = dst.writes().length;

    const second = await run(["--apply", "--allow-nonempty"]);
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/복사 0개 · 건너뜀\(이미 같음\) 13개/);
    // 두 번째 실행은 대상에 쓰기를 하나도 보태지 않는다
    expect(dst.writes().length).toBe(writesAfterFirst);

    const after = dst.snapshot();
    expect(Object.keys(after).sort()).toEqual(Object.keys(first).sort());
    expect(after["import:log:daniel"].value).toEqual(first["import:log:daniel"].value);
  });

  it("원본이 바뀐 값만 다시 옮긴다(중단 뒤 재실행 경로)", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    src.seed("push:state:daniel", "string", JSON.stringify({ reminders: false }));
    src.seed("import:log:daniel", "list", ["새로운", "최신", "중간", "가장오래됨"]);
    const r = await run(["--apply", "--allow-nonempty"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/복사 2개 · 건너뜀\(이미 같음\) 11개/);
    const after = dst.snapshot();
    expect(JSON.parse(after["push:state:daniel"].value).reminders).toBe(false);
    expect(after["import:log:daniel"].value).toEqual(["새로운", "최신", "중간", "가장오래됨"]);
  });
});

describe("kv-migrate — 대조(--verify)", () => {
  it("복사 직후 건수와 표본 값이 모두 일치한다", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    const r = await run(["--verify"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("대조 통과");
    expect(r.out).toMatch(/건수: 원본 13개 · 대상 13개 · 대상에 없음 0개/);
    expect(r.out).toMatch(/표본 13개 값 대조: 불일치 0개/);
    expect(src.writes()).toEqual([]);
  });

  it("--apply --verify 를 한 번에 붙여도 된다", async () => {
    const r = await run(["--apply", "--verify"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("복사 완료");
    expect(r.out).toContain("대조 통과");
  });

  it("대상 값이 하나라도 틀리면 잡아내고 종료 코드 2로 끝난다", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    dst.seed("push:sub:daniel", "string", JSON.stringify({ endpoint: "https://push.example/변조됨" }));
    const r = await run(["--verify"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("push:sub:daniel: 값 불일치");
    expect(r.err).toContain("대조 실패");
  });

  it("키가 통째로 빠지면 잡아낸다", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    dst.data.delete("import:seen:daniel:hae-2026-08-01-run");
    const r = await run(["--verify"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("대상에 없음: import:seen:daniel:hae-2026-08-01-run");
    expect(r.out).toMatch(/import:seen:\* — 운동 중복 도장\(영구\)\s+1 → \s*0\s+불일치/);
  });

  it("리스트 순서가 뒤집혀 있으면 값 불일치로 잡는다", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    dst.seed("import:log:daniel", "list", ["가장오래됨", "중간", "최신"]);
    const r = await run(["--verify"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("import:log:daniel: 값 불일치");
  });

  it("표본 수를 줄이면 그만큼만 본다", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    const r = await run(["--verify", "--sample=3"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/표본 3개 값 대조/);
  });
});

describe("kv-migrate — 사용법 오류", () => {
  it("SRC env가 없으면 사용법을 보여 주고 1로 끝난다", async () => {
    const r = await run([], { env: { SRC_URL: "", SRC_TOKEN: "" } });
    expect(r.code).toBe(1);
    expect(r.err).toContain("SRC_URL");
    expect(r.err).toContain("사용법:");
  });

  it("--apply 인데 DST env가 없으면 1로 끝난다", async () => {
    const r = await run(["--apply"], { withDst: false });
    expect(r.code).toBe(1);
    expect(r.err).toContain("DST_URL");
  });

  it("모르는 옵션은 조용히 무시하지 않는다", async () => {
    const r = await run(["--force"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("모르는 옵션: --force");
  });
});
