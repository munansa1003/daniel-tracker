// scripts/kv-migrate.mjs — Upstash KV를 다른 Upstash DB로 옮긴다(원본은 읽기 전용).
//
// 배경: DR-14(docs/migration/03-ci-deploy-design.md §8). 현 KV는 Vercel Marketplace 통합
// (`upstash-kv-chestnut-umbrella`)이라 Vercel 프로젝트를 지우면 통합이 함께 지워지고 DB까지
// 사라질 수 있다. 그래서 Firebase 컷오버 **전에**(02 런북 A단계) 직접 계정의 새 DB로 먼저 옮긴다.
// 유실 시 피해: `push:sub:*`·`push:uids` → 리마인더 **중단**(사용자가 알아채기 어렵다 — 앱은
// 멀쩡해 보인다), `share:*` → 공유 링크 **즉사**, `import:inbox:*` → 아직 못 받아간 수신분 소실,
// `import:seen:*`(영구 도장) → 같은 기록 재수신(앱 2차 방어선이 있어 정상 경로에서 이중 계상까지는
// 가지 않는다 — `src/importMerge.js:67`). 자세한 것은 docs/migration/04-kv-migration.md §1.
//
// 이 스크립트가 지키는 것:
//   · 원본에는 어떤 쓰기 명령도 보내지 않는다(주석이 아니라 명령 화이트리스트로 강제).
//   · 기본은 점검(dry-run)이다. 실제 복사는 --apply를 직접 붙여야 한다.
//   · 토큰은 어떤 경로로도 출력하지 않는다(로그·에러 메시지 포함).
//   · 멱등: 대상에 이미 같은 값이 있으면 건너뛴다. 몇 번을 다시 돌려도 결과가 같다.
//   · 의존성 0 — Node 20+ 내장 fetch만 쓴다(npm install 불요).
//
// 사용법 (토큰은 반드시 셸 env로만 — 인자로 주면 셸 히스토리·프로세스 목록에 남는다):
//   export SRC_URL=https://<옛DB>.upstash.io SRC_TOKEN=...
//   export DST_URL=https://<새DB>.upstash.io DST_TOKEN=...
//   node scripts/kv-migrate.mjs                  # 1) 점검 — 접두사별 키 수·TTL 분포·용량만 본다
//   node scripts/kv-migrate.mjs --apply          # 2) 복사
//   node scripts/kv-migrate.mjs --verify         # 3) 대조 — 건수 + 표본 100개 값 비교
//
// 종료 코드: 0 정상 · 1 사용법·설정 오류 · 2 작업 실패(안전장치 차단·복사 실패·대조 불일치)
//
// 실행 절차 전체(사람이 할 일 포함)는 docs/migration/04-kv-migration.md 참조.

import { Buffer } from "node:buffer";

// ── 상수 ─────────────────────────────────────────────────────────────────────
// 옮기지 않을 접두사 — 둘 다 60초 안에 스스로 사라지는 값이다.
// `import:body-cloud-lock:`은 인바디 동시실행 뮤텍스(`CLOUD_LOCK_TTL_SEC=60`, import-inbox.js:47).
// 이걸 옮기면 새 DB에서 최대 1분간 인바디 pull이 잠긴 채로 시작한다.
const DEFAULT_EXCLUDE = ["rl:", "import:body-cloud-lock:"];
const SCAN_COUNT = 200;               // SCAN 한 번에 훑는 양(힌트 — 페이지 크기가 아니다)
const KEY_BATCH = 64;                 // 한 번에 처리할 키 수
// Upstash 문서상 한 요청의 커맨드 수 상한은 없다. 공식 클라이언트(@upstash/redis)가
// 클라이언트 쪽에서 1000개마다 끊으므로 그보다 보수적으로 잡는다.
const PIPE_MAX_CMDS = 500;
// 요청 본문 상한은 Free/PAYG 10MB. 절반 아래로 잡고 **바이트**로 센다
// (한글은 문자 수와 바이트 수가 3배까지 벌어져 .length로 세면 상한을 넘길 수 있다).
const PIPE_MAX_BYTES = 4000000;
const ELEM_CHUNK = 200;               // HSET/SADD/RPUSH/ZADD 한 커맨드에 넣을 원소 수
const HTTP_TIMEOUT_MS = 30000;
const HTTP_RETRIES = 3;               // 네트워크 오류·429·5xx만 재시도
const SCAN_MAX_ITER = 100000;         // SCAN 무한루프 방어

// 원본 커넥션에 허용하는 명령 — 여기 없는 명령을 원본에 보내려 하면 즉시 던진다.
// "읽기 전용"을 주석이 아니라 코드로 강제하는 자리다.
const READ_ONLY_COMMANDS = new Set([
  "SCAN", "TYPE", "TTL", "PTTL", "GET", "STRLEN", "HGETALL", "HLEN",
  "SMEMBERS", "SCARD", "LRANGE", "LLEN", "ZRANGE", "ZCARD", "DBSIZE", "EXISTS",
]);

// 접두사 그룹 — 이 앱이 실제로 쓰는 키(api/_lib/*.js, api/*.js)를 사람이 읽는 이름으로 묶는다.
// 긴 접두사가 먼저 매치돼야 한다(예: `share:hits:`가 `share:`보다 먼저).
const KEY_GROUPS = [
  ["import:inbox:", "운동 사서함(hash)"],
  ["import:body-inbox:", "체성분 사서함(hash)"],
  ["import:seen:", "운동 중복 도장(영구)"],
  ["import:body-seen:", "체성분 중복 도장(영구)"],
  ["import:body-cloud-authblock:", "인바디 인증 봉인"],
  ["import:body-cloud-fail:", "인바디 연속 실패"],
  ["import:body-cloud-lock:", "인바디 동시실행 락"],
  ["import:body-cloud-at:", "인바디 스로틀 도장"],
  ["import:body-cloud-ok:", "인바디 마지막 성공"],
  ["import:body-log:", "체성분 수신 로그(list)"],
  ["import:log:", "운동 수신 로그(list)"],
  ["push:sub:", "푸시 구독"],
  ["push:state:", "푸시 상태·설정"],
  ["share:hits:", "공유 링크 조회수"],
  ["share:", "공유 링크 본문"],
  ["rl:", "rate limit 카운터"],
];
const EXACT_GROUPS = new Map([["push:uids", "푸시 구독자 목록(set)"]]);

// 복사 순서는 **안전 순서**다. 중간에 끊겨도 "복구 가능한 쪽"으로 남게 키를 줄 세운다.
//   · 사서함(hash)을 먼저, 중복 도장(`import:seen`)을 나중에 —
//     도장만 넘어가고 사서함이 빠지면 그 수신분은 **영영 못 받는다**(도장이 재수신을 막는다).
//     반대로 사서함만 넘어가고 도장이 빠지면 최악이 "중복 한 번"이고, 그건 되돌릴 수 있다.
//     (앱도 같은 이유로 쓸 때 HSET → SET NX 순서다: health-import.js:130-131)
//   · `push:sub:*`를 먼저, `push:uids`(대상 목록)를 나중에 —
//     목록에 uid가 있는데 구독이 없으면 크론이 그 uid를 **영구 삭제**한다(cron-reminders.js:76).
const COPY_LAST = [/^import:seen:/, /^import:body-seen:/, /^push:uids$/];
const copyRank = (key) => (COPY_LAST.some((re) => re.test(key)) ? 1 : 0);

class UsageError extends Error {}

// 값을 받지 않는 플래그. `--allow-nonempty=no`처럼 값을 붙이면 값이 무시되고 플래그만 켜져서
// **안전장치를 끄려다 켜는** 정반대 결과가 된다 — 그래서 아예 거부한다.
const BOOL_FLAGS = new Set(["--apply", "--verify", "--allow-nonempty", "--allow-empty", "--help", "-h"]);

// ── 인자 ─────────────────────────────────────────────────────────────────────
function usage() {
  return [
    "사용법: node scripts/kv-migrate.mjs [옵션]",
    "",
    "  env: SRC_URL SRC_TOKEN (필수) · DST_URL DST_TOKEN",
    "       (--apply/--verify에는 대상 env도 필수. 점검만 할 때는 없어도 되고,",
    "        있으면 대상 DB 상태까지 함께 보고한다)",
    "",
    "  --apply                 실제로 복사한다(기본은 점검만)",
    "  --verify                건수와 표본 값을 대조한다",
    "  --allow-nonempty        대상 DB가 비어 있지 않아도 --apply를 허용(재실행 시 필요)",
    "  --allow-empty           원본에서 옮길 키가 0개여도 성공으로 끝낸다(기본은 중단)",
    "  --sample=N              대조 표본 키 수 (기본 100)",
    "  --match=GLOB            원본에서 훑을 키 패턴 (기본 *)",
    "  --exclude=A:,B:         제외할 접두사 목록 — 기본값을 덮어쓴다",
    `                          (기본 ${DEFAULT_EXCLUDE.join(" ")})`,
    "  --ttl-tolerance=SEC     TTL 차이 허용치 (기본 300초)",
    "  --scan-count=N          SCAN COUNT 힌트 (기본 200)",
  ].join("\n");
}

function intArg(name, value, min) {
  // Number("")는 0이다 — 빈 값이 min=0을 통과해 조용히 허용오차를 0으로 만드는 길을 막는다.
  if (value.trim() === "") throw new UsageError(`${name}에는 ${min} 이상의 정수가 필요합니다`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`${name}에는 ${min} 이상의 정수가 필요합니다`);
  return n;
}

function parseArgs(argv) {
  const opt = {
    apply: false, verify: false, allowNonempty: false,
    allowEmpty: false,
    sample: 100, match: "*", exclude: [...DEFAULT_EXCLUDE],
    ttlTolSec: 300, scanCount: SCAN_COUNT,
  };
  for (const a of argv) {
    const eq = a.indexOf("=");
    const name = eq === -1 ? a : a.slice(0, eq);
    const value = eq === -1 ? "" : a.slice(eq + 1);
    if (eq !== -1 && BOOL_FLAGS.has(name)) {
      throw new UsageError(`${name}에는 값을 붙일 수 없습니다(붙이면 값이 무시되고 플래그만 켜집니다)`);
    }
    switch (name) {
      case "--apply": opt.apply = true; break;
      case "--verify": opt.verify = true; break;
      case "--allow-nonempty": opt.allowNonempty = true; break;
      case "--allow-empty": opt.allowEmpty = true; break;
      case "--sample": opt.sample = intArg(name, value, 1); break;
      case "--ttl-tolerance": opt.ttlTolSec = intArg(name, value, 0); break;
      case "--scan-count": opt.scanCount = intArg(name, value, 1); break;
      case "--match":
        if (!value) throw new UsageError(`${name}에 값이 없습니다`);
        opt.match = value; break;
      case "--exclude": {
        // 빈 값(`--exclude=` 또는 `--exclude`)은 제외 목록을 통째로 비운다 —
        // 그러면 rl:*과 60초 락까지 새 DB로 따라간다. 실수와 구분할 수 없으므로 거부한다.
        const list = value.split(",").map((x) => x.trim()).filter(Boolean);
        if (list.length === 0) throw new UsageError("--exclude 에는 접두사를 하나 이상 적어야 합니다(예: --exclude=rl:,import:body-cloud-lock:)");
        opt.exclude = list;
        break;
      }
      case "--help": case "-h": throw new UsageError("");
      default: throw new UsageError(`모르는 옵션: ${a}`);
    }
  }
  return opt;
}

// ── REST 커넥션 ──────────────────────────────────────────────────────────────
// Upstash REST: 단일 커맨드는 본문에 ["SET","k","v"] 배열을, 파이프라인은 그 배열들의 배열을
// `<url>/pipeline`에 보낸다. 응답은 {result} 또는 {error}(파이프라인은 그 객체들의 배열).
function makeConn(role, url, token, readOnly) {
  return { role, url: String(url).replace(/\/+$/, ""), token, readOnly };
}

function connLabel(conn) {
  // 토큰은 절대 찍지 않는다. 호스트만 보여 "어느 DB인지"를 사람이 확인할 수 있게 한다.
  try { return `${conn.role}(${new URL(conn.url).host})`; } catch { return conn.role; }
}

function assertAllowed(conn, commands) {
  if (!conn.readOnly) return;
  for (const cmd of commands) {
    const name = String(cmd[0]).toUpperCase();
    if (!READ_ONLY_COMMANDS.has(name)) {
      throw new Error(`원본은 읽기 전용입니다 — ${name} 명령을 보내려 했습니다(버그)`);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(conn, path, body) {
  let lastErr;
  for (let attempt = 0; attempt <= HTTP_RETRIES; attempt++) {
    if (attempt > 0) await sleep(300 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(`${conn.url}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (e) {
      lastErr = new Error(`${connLabel(conn)} 연결 실패: ${e.message}`);
      continue;                                    // 네트워크 오류는 재시도
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`${connLabel(conn)} HTTP ${res.status}`);
      continue;                                    // 일시적 오류만 재시도
    }
    if (!res.ok) {
      // 401/403/400은 재시도해도 소용없다. 서버가 준 오류 문구를 함께 보여 준다 —
      // 특히 400은 자격증명이 아니라 명령 자체의 문제일 때가 많다(Upstash의 **읽기 전용 토큰**은
      // SCAN을 거부한다: "Some powerful read commands (e.g. SCAN, KEYS) are also restricted").
      // 혹시라도 문구에 토큰이 섞여 있으면 가리고 내보낸다.
      let detail = "";
      try {
        const body = await res.json();
        if (body && typeof body.error === "string") detail = body.error;
      } catch { /* 본문이 JSON이 아니면 상태 코드만 알린다 */ }
      if (detail && conn.token) detail = detail.split(conn.token).join("****");
      const hint = res.status === 401 || res.status === 403 ? " — URL과 토큰을 확인하세요" : "";
      throw new Error(`${connLabel(conn)} HTTP ${res.status}${detail ? ` ${detail}` : ""}${hint}`);
    }
    try { return await res.json(); }
    catch (e) { lastErr = new Error(`${connLabel(conn)} 응답 파싱 실패: ${e.message}`); }
  }
  throw lastErr;
}

// 파이프라인 1회 — 실패한 원소는 {error}로 오므로 호출자가 키 단위로 귀속시킬 수 있게 그대로 넘긴다.
async function pipeRaw(conn, commands) {
  if (commands.length === 0) return [];
  assertAllowed(conn, commands);
  const json = await httpJson(conn, "/pipeline", JSON.stringify(commands));
  if (!Array.isArray(json)) {
    if (json && json.error) throw new Error(`${connLabel(conn)} 파이프라인 오류: ${json.error}`);
    throw new Error(`${connLabel(conn)} 파이프라인 응답이 배열이 아닙니다`);
  }
  if (json.length !== commands.length) {
    throw new Error(`${connLabel(conn)} 파이프라인 응답 개수 불일치(${json.length} ≠ ${commands.length})`);
  }
  return json;
}

// 커맨드를 개수·바이트로 나눠 여러 요청으로 보낸다.
// 한 커맨드가 혼자 상한을 넘으면(공유 링크 본문 600KB 등) 그 커맨드만 단독으로 보낸다.
async function pipe(conn, commands) {
  const out = [];
  let batch = [];
  let bytes = 2;
  const flush = async () => {
    if (batch.length) out.push(...await pipeRaw(conn, batch));
    batch = []; bytes = 2;
  };
  for (const cmd of commands) {
    const size = Buffer.byteLength(JSON.stringify(cmd), "utf8") + 1;
    if (batch.length && (batch.length >= PIPE_MAX_CMDS || bytes + size > PIPE_MAX_BYTES)) await flush();
    batch.push(cmd); bytes += size;
  }
  await flush();
  return out;
}

// 쓰기 전용 — **키 하나의 명령 묶음을 쪼개지 않고** 보낸다.
// 왜: 컬렉션 복원은 `DEL` → `RPUSH`… → `PEXPIRE` 한 묶음이다. 이게 두 요청으로 갈라진 상태에서
// 뒤 요청이 재시도되면(네트워크 오류·429·응답 유실) `DEL`은 앞 요청에서 이미 끝났으므로
// **RPUSH가 두 번 들어가 리스트가 불어난다**. 묶음을 통째로 보내면 재시도해도 `DEL`부터 다시
// 도니 결과가 같다(SET·HSET·SADD·ZADD는 원래 멱등이라 문제가 없고, 문제는 RPUSH뿐이다).
// 묶음 하나가 혼자 상한을 넘을 때만(원소 수만 개짜리 리스트) 어쩔 수 없이 쪼갠다 —
// 그 경우 재시도가 겹치면 --verify의 값 대조에서 원소 수가 어긋나 잡힌다.
// 반환: groups와 같은 길이의 배열, 각 원소는 그 묶음의 결과 배열.
async function pipeGroups(conn, groups) {
  const results = groups.map(() => null);
  let batch = [];
  let count = 0;
  let bytes = 2;
  const flush = async () => {
    if (!batch.length) return;
    const res = await pipeRaw(conn, batch.flatMap((b) => b.cmds));
    let i = 0;
    for (const b of batch) { results[b.gi] = res.slice(i, i + b.cmds.length); i += b.cmds.length; }
    batch = []; count = 0; bytes = 2;
  };
  for (let gi = 0; gi < groups.length; gi++) {
    const cmds = groups[gi];
    const size = cmds.reduce((n, c) => n + Buffer.byteLength(JSON.stringify(c), "utf8") + 1, 0);
    const alone = cmds.length > PIPE_MAX_CMDS || size + 2 > PIPE_MAX_BYTES;
    if (batch.length && (alone || count + cmds.length > PIPE_MAX_CMDS || bytes + size > PIPE_MAX_BYTES)) {
      await flush();
    }
    if (alone) {                                  // 혼자서도 상한을 넘는다 → 쪼개 보낸다
      results[gi] = await pipe(conn, cmds);
      continue;
    }
    batch.push({ gi, cmds }); count += cmds.length; bytes += size;
  }
  await flush();
  return results;
}

// 단일 커맨드 — 결과값만 돌려주고 오류는 던진다.
async function one(conn, command) {
  assertAllowed(conn, [command]);
  const json = await httpJson(conn, "", JSON.stringify(command));
  if (json && json.error) throw new Error(`${connLabel(conn)} ${command[0]} 실패: ${json.error}`);
  return json ? json.result : undefined;
}

function resultOf(conn, element, what) {
  if (element && element.error) throw new Error(`${connLabel(conn)} ${what} 실패: ${element.error}`);
  return element ? element.result : undefined;
}

// ── 키 훑기 ──────────────────────────────────────────────────────────────────
async function scanKeys(conn, opt) {
  const keys = new Set();
  let excluded = 0;
  let cursor = "0";
  let iter = 0;
  do {
    const res = await one(conn, ["SCAN", cursor, "MATCH", opt.match, "COUNT", String(opt.scanCount)]);
    if (!Array.isArray(res) || res.length < 2) {
      throw new Error(`${connLabel(conn)} SCAN 응답 형식이 예상과 다릅니다`);
    }
    cursor = String(res[0]);                       // REST는 커서를 문자열로 돌려준다
    for (const k of res[1] || []) {
      const key = String(k);
      if (opt.exclude.some((p) => key.startsWith(p))) { excluded++; continue; }
      keys.add(key);                               // SCAN은 같은 키를 두 번 줄 수 있다 → Set
    }
    if (++iter > SCAN_MAX_ITER) throw new Error("SCAN이 끝나지 않습니다(커서 이상)");
  } while (cursor !== "0");
  const ordered = [...keys].sort((a, b) => copyRank(a) - copyRank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return { keys: ordered, excluded };
}

// ── 값 읽기·쓰기 ─────────────────────────────────────────────────────────────
const READ_CMD = {
  string: (k) => ["GET", k],
  hash: (k) => ["HGETALL", k],
  set: (k) => ["SMEMBERS", k],
  list: (k) => ["LRANGE", k, "0", "-1"],
  zset: (k) => ["ZRANGE", k, "0", "-1", "WITHSCORES"],
};

const SIZE_CMD = {
  string: (k) => ["STRLEN", k],
  hash: (k) => ["HLEN", k],
  set: (k) => ["SCARD", k],
  list: (k) => ["LLEN", k],
  zset: (k) => ["ZCARD", k],
};

// 응답을 비교 가능한 형태로 정규화한다.
// Upstash REST는 HGETALL을 평탄 배열로 주지만, 객체로 오는 구현도 방어한다.
function normalize(type, raw) {
  if (raw === null || raw === undefined) return null;
  switch (type) {
    case "string":
      return String(raw);
    case "hash": {
      const map = new Map();
      if (Array.isArray(raw)) {
        for (let i = 0; i + 1 < raw.length; i += 2) map.set(String(raw[i]), String(raw[i + 1]));
      } else if (typeof raw === "object") {
        for (const [f, v] of Object.entries(raw)) map.set(String(f), String(v));
      }
      return map;
    }
    case "set":
      return (raw || []).map(String).sort();
    case "list":
      return (raw || []).map(String);              // 순서가 곧 값이다 — 정렬하지 않는다
    case "zset": {
      const map = new Map();
      if (Array.isArray(raw)) {
        for (let i = 0; i + 1 < raw.length; i += 2) map.set(String(raw[i]), Number(raw[i + 1]));
      } else if (typeof raw === "object") {
        for (const [m, s] of Object.entries(raw)) map.set(String(m), Number(s));
      }
      return map;
    }
    default:
      return null;
  }
}

function canon(type, value) {
  if (value === null || value === undefined) return "(없음)";
  switch (type) {
    case "string": return `s:${value}`;
    case "hash": return `h:${JSON.stringify([...value.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)))}`;
    case "set": return `S:${JSON.stringify(value)}`;
    case "list": return `l:${JSON.stringify(value)}`;
    case "zset": return `z:${JSON.stringify([...value.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)))}`;
    default: return `?:${JSON.stringify(value)}`;
  }
}

// 컬렉션이 비어 있다 = 그 키는 이미 사라졌다(Redis는 빈 컬렉션을 보관하지 않는다).
// TYPE과 값 읽기 사이에 만료·삭제된 키가 여기로 온다. 빈 문자열("")은 정상 값이므로 제외.
function isEmptyValue(type, value) {
  if (value === null || value === undefined) return true;
  if (type === "string") return false;
  if (type === "hash" || type === "zset") return value.size === 0;
  return value.length === 0;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 대상에 그대로 복원하는 명령들. 컬렉션은 DEL 후 재생성한다 —
// 남아 있던 필드·원소와 섞이면 조용히 틀린 값이 되기 때문이다(파이프라인은 순서를 지킨다).
function writeCommands(key, type, value, pttlMs) {
  const cmds = [];
  if (type === "string") {
    cmds.push(pttlMs > 0 ? ["SET", key, value, "PX", String(pttlMs)] : ["SET", key, value]);
    return cmds;
  }
  cmds.push(["DEL", key]);
  if (type === "hash") {
    for (const part of chunk([...value.entries()], ELEM_CHUNK)) {
      cmds.push(["HSET", key, ...part.flatMap(([f, v]) => [f, v])]);
    }
  } else if (type === "set") {
    for (const part of chunk(value, ELEM_CHUNK)) cmds.push(["SADD", key, ...part]);
  } else if (type === "list") {
    // LRANGE 0 -1 순서 그대로 RPUSH — LPUSH를 쓰면 뒤집힌다(최신 수신 로그가 맨 아래로 간다)
    for (const part of chunk(value, ELEM_CHUNK)) cmds.push(["RPUSH", key, ...part]);
  } else if (type === "zset") {
    for (const part of chunk([...value.entries()], ELEM_CHUNK)) {
      cmds.push(["ZADD", key, ...part.flatMap(([m, s]) => [String(s), m])]);
    }
  }
  if (pttlMs > 0) cmds.push(["PEXPIRE", key, String(pttlMs)]);
  return cmds;
}

// 키 묶음의 타입·TTL을 한 번에 읽는다.
async function readMeta(conn, keys) {
  const res = await pipe(conn, keys.flatMap((k) => [["TYPE", k], ["PTTL", k]]));
  const meta = new Map();
  keys.forEach((k, i) => {
    const type = String(resultOf(conn, res[2 * i], `TYPE ${k}`) ?? "none");
    const pttl = Number(resultOf(conn, res[2 * i + 1], `PTTL ${k}`) ?? -2);
    meta.set(k, { type, pttl });
  });
  return meta;
}

// 타입을 아는 키들의 값을 한 번에 읽는다.
async function readValues(conn, entries) {
  const readable = entries.filter(([, m]) => READ_CMD[m.type]);
  const res = await pipe(conn, readable.map(([k, m]) => READ_CMD[m.type](k)));
  const values = new Map();
  readable.forEach(([k, m], i) => {
    values.set(k, normalize(m.type, resultOf(conn, res[i], `${m.type} 읽기 ${k}`)));
  });
  return values;
}

// ── 보고 ─────────────────────────────────────────────────────────────────────
function groupOf(key) {
  const exact = EXACT_GROUPS.get(key);
  if (exact) return `${key} — ${exact}`;
  for (const [prefix, label] of KEY_GROUPS) if (key.startsWith(prefix)) return `${prefix}* — ${label}`;
  return key.includes(":") ? `${key.split(":")[0]}:* — (분류 없음)` : "(접두사 없음)";
}

function ttlBucket(pttl) {
  if (pttl === -1) return "영구";
  if (pttl < 0) return "만료·부재";
  const sec = pttl / 1000;
  if (sec <= 3600) return "1시간 이하";
  if (sec <= 86400) return "1일 이하";
  if (sec <= 7 * 86400) return "7일 이하";
  return "7일 초과";
}

// 한글은 폭 2로 세어 표를 맞춘다(터미널 등폭 기준).
function width(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    w += (cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf)
      || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60)
      || (cp >= 0xffe0 && cp <= 0xffe6))) ? 2 : 1;
  }
  return w;
}
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - width(s)));

function bytesHuman(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

// 원본(또는 대상)을 훑어 접두사별 키 수·TTL 분포·용량을 모은다.
async function collectInventory(conn, opt, withSizes) {
  const { keys, excluded } = await scanKeys(conn, opt);
  const groups = new Map();      // 그룹 → { count, types:Set, permanent, volatile }
  const ttl = new Map();         // 버킷 → 개수
  const types = new Map();       // 키 → { type, pttl }
  let stringBytes = 0;
  let elements = 0;
  let unsupported = [];

  for (const batch of chunk(keys, KEY_BATCH)) {
    const meta = await readMeta(conn, batch);
    for (const [k, m] of meta) {
      types.set(k, m);
      if (m.type === "none") continue;             // 훑는 사이에 만료된 키
      if (!READ_CMD[m.type]) unsupported.push(`${k} (${m.type})`);
      const g = groupOf(k);
      const acc = groups.get(g) || { count: 0, types: new Set(), permanent: 0, volatile: 0 };
      acc.count++;
      acc.types.add(m.type);
      if (m.pttl === -1) acc.permanent++; else if (m.pttl > 0) acc.volatile++;
      groups.set(g, acc);
      ttl.set(ttlBucket(m.pttl), (ttl.get(ttlBucket(m.pttl)) || 0) + 1);
    }
    if (withSizes) {
      const sizable = [...meta.entries()].filter(([, m]) => SIZE_CMD[m.type]);
      const res = await pipe(conn, sizable.map(([k, m]) => SIZE_CMD[m.type](k)));
      sizable.forEach(([k, m], i) => {
        const n = Number(resultOf(conn, res[i], `크기 ${k}`) ?? 0) || 0;
        if (m.type === "string") stringBytes += n; else elements += n;
      });
    }
  }
  return { keys, excluded, groups, ttl, types, stringBytes, elements, unsupported };
}

function printInventory(conn, inv, opt) {
  console.log(`\n■ ${connLabel(conn)}`);
  console.log(`  키 ${inv.keys.length}개 (제외 접두사 ${opt.exclude.join(" ") || "없음"} → ${inv.excluded}개 제외)`);
  if (inv.groups.size) {
    console.log("  접두사별:");
    const rows = [...inv.groups.entries()].sort((a, b) => b[1].count - a[1].count);
    const w = Math.max(...rows.map(([g]) => width(g)));
    for (const [g, acc] of rows) {
      const kinds = [...acc.types].join(",");
      console.log(`    ${pad(g, w)}  ${String(acc.count).padStart(6)}개  ${pad(kinds, 8)}`
        + `영구 ${acc.permanent} · TTL ${acc.volatile}`);
    }
  }
  const buckets = ["영구", "1시간 이하", "1일 이하", "7일 이하", "7일 초과", "만료·부재"];
  const ttlLine = buckets.filter((b) => inv.ttl.get(b)).map((b) => `${b} ${inv.ttl.get(b)}`).join(" · ");
  console.log(`  TTL 분포: ${ttlLine || "없음"}`);
  console.log(`  용량(근사): 문자열 값 합계 ${bytesHuman(inv.stringBytes)} · 컬렉션 원소 ${inv.elements}개`);
  if (inv.unsupported.length) {
    console.log(`  ⚠ 이 스크립트가 복사하지 못하는 타입 ${inv.unsupported.length}개: ${inv.unsupported.slice(0, 5).join(", ")}`);
  }
}

// ── 점검(dry-run) ────────────────────────────────────────────────────────────
async function dryRun(src, dst, opt) {
  console.log("== 점검(dry-run) — 아무것도 쓰지 않습니다 ==");
  const inv = await collectInventory(src, opt, true);
  printInventory(src, inv, opt);

  if (dst) {
    const dbsize = Number(await one(dst, ["DBSIZE"]) ?? 0);
    console.log(`\n■ ${connLabel(dst)} — 현재 키 ${dbsize}개`);
    if (dbsize === 0) console.log("  비어 있습니다 → --apply 가능");
    else console.log("  비어 있지 않습니다 → --apply 하려면 --allow-nonempty 가 필요합니다");
  } else {
    console.log("\n■ 대상 — DST_URL/DST_TOKEN 미설정(점검만 하므로 넘어갑니다)");
  }
  if (inv.unsupported.length) {
    console.error(`\n중단: 이 스크립트가 복사하지 못하는 타입이 ${inv.unsupported.length}개 있습니다.`);
    console.error("그대로 --apply 하면 그 키들만 빠진 채 나머지가 옮겨집니다. 먼저 해당 키를 확인하세요.");
    return 2;
  }
  console.log(`\n복사 예정 키: ${inv.keys.length}개. 실제 복사는 --apply 를 붙여 다시 실행하세요.`);
  return 0;
}

// ── 복사(--apply) ────────────────────────────────────────────────────────────
function ttlMatches(a, b, tolSec) {
  if (a === -1 && b === -1) return true;
  if (a > 0 && b > 0) return Math.abs(a - b) <= tolSec * 1000;
  return false;
}

async function applyCopy(src, dst, opt) {
  console.log("== 복사(--apply) ==");
  const dbsize = Number(await one(dst, ["DBSIZE"]) ?? 0);
  if (dbsize > 0 && !opt.allowNonempty) {
    console.error(`중단: 대상 ${connLabel(dst)}에 이미 키가 ${dbsize}개 있습니다.`);
    console.error("빈 DB로 옮기는 것이 원칙입니다. 재실행이라 의도한 것이라면 --allow-nonempty 를 붙이세요.");
    return 2;
  }
  const { keys, excluded } = await scanKeys(src, opt);
  console.log(`${connLabel(src)} → ${connLabel(dst)}`);
  console.log(`대상 키 ${keys.length}개 (제외 ${excluded}개, 접두사 ${opt.exclude.join(" ")})`);

  // 옮길 것이 0개인데 "복사 완료"로 끝나면, 주소·토큰·--match 오타가 성공으로 보인다.
  if (keys.length === 0 && !opt.allowEmpty) {
    console.error("중단: 원본에서 옮길 키가 0개입니다 — SRC_URL·--match·--exclude 를 확인하세요.");
    console.error("정말 비어 있는 것이 맞다면 --allow-empty 를 붙이세요.");
    return 2;
  }

  // 대상이 비어 있지 않은데 덮어쓰려 한다 — 컷오버 이후의 재실행이면 새 DB의 최신 값을 옛 값으로
  // 되돌릴 수 있다. 대상에만 있는 키를 세어 먼저 알린다(04 §4).
  if (dbsize > 0) {
    const { keys: dstKeys } = await scanKeys(dst, opt);
    const srcSet = new Set(keys);
    const dstOnly = dstKeys.filter((k) => !srcSet.has(k));
    if (dstOnly.length) {
      console.warn(`⚠ 대상에만 있는 키 ${dstOnly.length}개 (예: ${dstOnly.slice(0, 3).join(", ")})`);
      console.warn("  컷오버 이후라면 이 재실행이 새 DB의 최신 값을 덮어쓸 수 있습니다 — 04 §4를 먼저 읽으세요.");
    }
  }

  const stat = { copied: 0, skipped: 0, vanished: 0, unsupported: [], failed: [], deferred: [] };
  let done = 0;

  const copyKeys = async (list) => {
    for (const batch of chunk(list, KEY_BATCH)) {
      const srcMeta = await readMeta(src, batch);
      const live = [];
      for (const [k, m] of srcMeta) {
        if (m.type === "none" || m.pttl === -2) { stat.vanished++; continue; }
        if (!READ_CMD[m.type]) { stat.unsupported.push(`${k} (${m.type})`); continue; }
        live.push([k, m]);
      }
      done += batch.length;
      if (live.length === 0) continue;

      const srcVals = await readValues(src, live);

      // 비UTF-8 값 감시 — Upstash REST는 잘못된 UTF-8 바이트를 U+FFFD(�)로 **조용히** 바꿔 돌려준다
      // (공식 문서: "If the response contains an invalid utf-8 character, it will be replaced with a �").
      // 그대로 옮기면 에러 하나 없이 값만 상한다. 원본의 STRLEN(바이트 수)과 받아온 문자열의
      // 바이트 수를 맞춰 본다. 조용히 상하느니 시끄럽게 멈춘다.
      // (이 앱은 JSON 문자열만 저장하므로 정상 상황에서는 걸릴 일이 없다 — 04 §8 D-13)
      const strKeys = live.filter(([, m]) => m.type === "string").map(([k]) => k);
      const lens = await pipe(src, strKeys.map((k) => ["STRLEN", k]));
      const skip = new Set();                    // 이번 배치에서 쓰지 않고 넘길 키
      const suspect = [];
      strKeys.forEach((k, i) => {
        const expect = Number(resultOf(src, lens[i], `STRLEN ${k}`) ?? -1);
        const got = srcVals.get(k);
        if (typeof got !== "string" || expect < 0) return;
        if (Buffer.byteLength(got, "utf8") !== expect) suspect.push(k);
      });
      // GET과 STRLEN은 서로 다른 왕복이다 — 그 사이에 값이 바뀌거나 키가 사라져도 어긋난다.
      // 한 번 어긋났다고 단정하지 않고, 의심 키만 GET+STRLEN을 **한 파이프라인**으로 다시 읽어
      // 두 번 연속 어긋날 때만 비UTF-8로 판정한다(정상 값을 거부하는 오진을 막는다).
      if (suspect.length) {
        const re = await pipe(src, suspect.flatMap((k) => [["GET", k], ["STRLEN", k]]));
        suspect.forEach((k, i) => {
          const v = resultOf(src, re[2 * i], `GET ${k}`);
          const n = Number(resultOf(src, re[2 * i + 1], `STRLEN ${k}`) ?? -1);
          if (v === null || v === undefined) { skip.add(k); stat.vanished++; return; }
          const str = String(v);
          const actual = Buffer.byteLength(str, "utf8");
          if (actual === n) { srcVals.set(k, str); return; }   // 경합이었다 — 다시 읽은 값으로 진행
          skip.add(k);
          stat.failed.push(`${k}: 비UTF-8 값(원본 ${n}바이트 → 읽은 값 ${actual}바이트) — REST로는 원형 그대로 옮길 수 없습니다`);
        });
      }

      const dstMeta = await readMeta(dst, live.map(([k]) => k));
      // 대상에 같은 타입으로 이미 있는 키만 값을 읽어 비교한다(멱등).
      const dstSame = live.filter(([k, m]) => dstMeta.get(k)?.type === m.type);
      const dstVals = await readValues(dst, dstSame.map(([k, m]) => [k, m]));

      const plan = [];
      for (const [k, m] of live) {
        if (skip.has(k)) continue;               // 위에서 이미 실패·사라짐으로 셌다
        const value = srcVals.get(k);
        if (isEmptyValue(m.type, value)) { stat.vanished++; continue; }
        const dm = dstMeta.get(k);
        const same = dm && dm.type === m.type
          && canon(m.type, dstVals.get(k)) === canon(m.type, value)
          && ttlMatches(m.pttl, dm.pttl, opt.ttlTolSec);
        if (same) { stat.skipped++; continue; }
        plan.push({ key: k, cmds: writeCommands(k, m.type, value, m.pttl) });
      }

      if (plan.length) {
        const res = await pipeGroups(dst, plan.map((p) => p.cmds));
        res.forEach((groupRes, i) => {
          const bad = (groupRes || []).find((el) => el && el.error);
          if (bad) stat.failed.push(`${plan[i].key}: ${bad.error}`);
          else stat.copied++;
        });
      }
      if (keys.length > KEY_BATCH) console.log(`  ... ${Math.min(done, keys.length)}/${keys.length}`);
    }
  };

  // 순서가 곧 안전이다(§1 "복사 순서는 안전 순서다"). 사서함·구독을 **다 옮긴 뒤에** 도장·목록을
  // 보낸다. 앞이 하나라도 실패하면 뒤는 **아예 보내지 않는다** — 그러지 않으면 "사서함 없이 도장만"
  // (그 수신분을 영영 못 받는다) 또는 "구독 없이 push:uids만"(첫 크론이 uid를 영구 삭제) 상태가
  // 만들어진다. 순서만으로는 못 막는다: 실패한 키를 건너뛰고 뒤엣것을 쓰면 같은 결과가 되기 때문이다.
  const rank0 = keys.filter((k) => copyRank(k) === 0);
  const rank1 = keys.filter((k) => copyRank(k) === 1);
  await copyKeys(rank0);
  if (stat.failed.length || stat.unsupported.length) {
    stat.deferred = rank1;
    done += rank1.length;
  } else {
    await copyKeys(rank1);
  }

  console.log(`\n복사 ${stat.copied}개 · 건너뜀(이미 같음) ${stat.skipped}개 · 사라짐 ${stat.vanished}개`
    + ` · 실패 ${stat.failed.length}개 · 미지원 타입 ${stat.unsupported.length}개`);
  for (const f of stat.failed.slice(0, 10)) console.error(`  실패: ${f}`);
  for (const u of stat.unsupported.slice(0, 10)) console.error(`  미지원: ${u}`);
  if (stat.deferred.length) {
    console.error(`  보류 ${stat.deferred.length}개: 앞 단계가 실패해 도장·구독자 목록은 보내지 않았습니다`);
    console.error("  (도장만 먼저 넘어가면 그 수신분을 영영 못 받습니다 — 04 §1 '복사 순서는 안전 순서다')");
  }
  if (stat.failed.length || stat.unsupported.length) {
    console.error("일부 키를 옮기지 못했습니다. 원인을 고친 뒤 --apply --allow-nonempty 로 다시 실행하세요(멱등).");
    return 2;
  }
  console.log("복사 완료. 이어서 --verify 로 대조하세요.");
  return 0;
}

// ── 대조(--verify) ───────────────────────────────────────────────────────────
// 표본은 정렬된 키 목록에서 균등 간격으로 뽑는다 — 무작위가 아니라 재실행해도 같은 표본이다.
function sampleKeys(keys, n) {
  if (keys.length <= n) return [...keys];
  const step = keys.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(keys[Math.floor(i * step)]);
  return [...new Set(out)];
}

async function verifyCopy(src, dst, opt) {
  console.log("== 대조(--verify) ==");
  const s = await collectInventory(src, opt, false);
  const d = await collectInventory(dst, opt, false);
  const dstSet = new Set(d.keys);
  const srcSet = new Set(s.keys);
  // 원본을 먼저 훑으므로, SCAN과 TYPE 사이에 만료된 키는 타입이 "none"으로 온다.
  // 그런 키를 "대상에 없음"으로 세면 정상 이관인데 대조가 실패한다(복사 쪽은 "사라짐"으로 센다).
  const missing = s.keys.filter((k) => !dstSet.has(k) && (s.types.get(k)?.type ?? "none") !== "none");
  const vanished = s.keys.filter((k) => !dstSet.has(k) && (s.types.get(k)?.type ?? "none") === "none");
  const extra = d.keys.filter((k) => !srcSet.has(k));

  console.log(`\n건수: 원본 ${s.keys.length}개 · 대상 ${d.keys.length}개`
    + ` · 대상에 없음 ${missing.length}개 · 원본에 없음 ${extra.length}개`
    + (vanished.length ? ` · 훑은 뒤 만료 ${vanished.length}개` : ""));

  // 아무것도 대조하지 않고 "통과"로 끝나면, 주소·--match 오타가 성공으로 보인다.
  if (s.keys.length === 0 && !opt.allowEmpty) {
    console.error("중단: 원본에서 대조할 키가 0개입니다 — SRC_URL·--match·--exclude 를 확인하세요.");
    console.error("정말 비어 있는 것이 맞다면 --allow-empty 를 붙이세요.");
    return 2;
  }

  const allGroups = [...new Set([...s.groups.keys(), ...d.groups.keys()])].sort();
  if (allGroups.length) {
    const w = Math.max(...allGroups.map(width));
    console.log("  접두사별 원본 → 대상:");
    for (const g of allGroups) {
      const a = s.groups.get(g)?.count || 0;
      const b = d.groups.get(g)?.count || 0;
      // 대상이 더 많은 것은 실패가 아니다(--allow-nonempty로 옮겨 붙인 경우) — 그런데도
      // "불일치"라고 찍으면 아래의 "대조 통과"와 정면으로 어긋나 사람을 헷갈리게 한다.
      const verdict = a === b ? "일치" : b > a ? `대상에 ${b - a}개 더 있음` : "불일치";
      console.log(`    ${pad(g, w)}  ${String(a).padStart(6)} → ${String(b).padStart(6)}  ${verdict}`);
    }
  }
  for (const k of missing.slice(0, 10)) console.error(`  대상에 없음: ${k}`);
  if (extra.length) console.log(`  (참고) 원본에 없는 대상 키 ${extra.length}개 — 대상에 원래 있던 키일 수 있습니다`);

  // 표본 값 대조
  const sample = sampleKeys(s.keys.filter((k) => dstSet.has(k)), opt.sample);
  const mismatches = [];
  let checked = 0;
  for (const batch of chunk(sample, KEY_BATCH)) {
    const sMeta = await readMeta(src, batch);
    const dMeta = await readMeta(dst, batch);
    const sLive = [...sMeta.entries()].filter(([, m]) => READ_CMD[m.type]);
    const sVals = await readValues(src, sLive);
    const dVals = await readValues(dst, sLive.map(([k]) => [k, dMeta.get(k) || { type: "none" }])
      .filter(([, m]) => READ_CMD[m.type]));

    // 문자열 키는 바이트 길이까지 본다 — 값이 같아 보여도 인코딩이 상하면 길이가 갈린다.
    const strKeys = sLive.filter(([, m]) => m.type === "string").map(([k]) => k);
    const sLen = await pipe(src, strKeys.map((k) => ["STRLEN", k]));
    const dLen = await pipe(dst, strKeys.map((k) => ["STRLEN", k]));
    const lenBy = new Map();
    strKeys.forEach((k, i) => lenBy.set(k, [
      Number(resultOf(src, sLen[i], `STRLEN ${k}`) ?? -1),
      Number(resultOf(dst, dLen[i], `STRLEN ${k}`) ?? -1),
    ]));

    for (const [k, m] of sLive) {
      checked++;
      const dm = dMeta.get(k) || { type: "none", pttl: -2 };
      if (dm.type !== m.type) { mismatches.push(`${k}: 타입 ${m.type} → ${dm.type}`); continue; }
      if (canon(m.type, sVals.get(k)) !== canon(m.type, dVals.get(k))) { mismatches.push(`${k}: 값 불일치`); continue; }
      if (!ttlMatches(m.pttl, dm.pttl, opt.ttlTolSec)) {
        mismatches.push(`${k}: TTL 불일치(원본 ${m.pttl}ms → 대상 ${dm.pttl}ms)`); continue;
      }
      const len = lenBy.get(k);
      if (len && len[0] !== len[1]) { mismatches.push(`${k}: 바이트 길이 ${len[0]} → ${len[1]}`); }
    }
  }
  console.log(`\n표본 ${checked}개 값 대조: 불일치 ${mismatches.length}개`);
  for (const m of mismatches.slice(0, 20)) console.error(`  ${m}`);

  if (missing.length || mismatches.length) {
    console.error("\n대조 실패 — 위 항목을 확인하고 --apply --allow-nonempty 로 다시 복사하세요.");
    return 2;
  }
  console.log("대조 통과 — 건수와 표본 값이 모두 일치합니다.");
  return 0;
}

// ── 진입점 ───────────────────────────────────────────────────────────────────
async function main() {
  let opt;
  try {
    opt = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      if (e.message) console.error(e.message);
      console.error(usage());
      return 1;
    }
    throw e;
  }

  const env = process.env;
  const needDst = opt.apply || opt.verify;
  if (!env.SRC_URL || !env.SRC_TOKEN) {
    console.error("SRC_URL·SRC_TOKEN 이 없습니다(원본 Upstash REST 주소와 토큰).");
    console.error(usage());
    return 1;
  }
  if (needDst && (!env.DST_URL || !env.DST_TOKEN)) {
    console.error("DST_URL·DST_TOKEN 이 없습니다(--apply/--verify 에는 대상이 필요합니다).");
    console.error(usage());
    return 1;
  }

  const src = makeConn("원본", env.SRC_URL, env.SRC_TOKEN, true);
  const dst = env.DST_URL && env.DST_TOKEN ? makeConn("대상", env.DST_URL, env.DST_TOKEN, false) : null;
  if (dst && src.url === dst.url) {
    console.error("중단: 원본과 대상이 같은 주소입니다. 새 DB의 URL을 쓰고 있는지 확인하세요.");
    return 1;
  }

  let code = 0;
  if (opt.apply) code = await applyCopy(src, dst, opt);
  if (code === 0 && opt.verify) code = await verifyCopy(src, dst, opt);
  if (!opt.apply && !opt.verify) code = await dryRun(src, dst, opt);
  return code;
}

main().then((code) => { process.exitCode = code; }, (e) => {
  console.error(`오류: ${e.message}`);
  process.exitCode = 2;
});
