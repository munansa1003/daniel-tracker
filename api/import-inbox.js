// api/import-inbox.js — 워치 수입 사서함의 앱 쪽 창구 (Vercel Serverless Function).
//
// 검문소(health-import.js)가 KV 사서함에 넣어 둔 합격 운동을, 앱(브라우저)이
// 시작 동기화 때 가져가(pull) 수동 입력과 같은 경로로 day 문서에 병합한 뒤
// 반영 완료를 알린다(ack → 사서함에서 제거). 접수 도장(import:seen:*)은 건드리지
// 않으므로 ack 이후에도 같은 운동의 재전송은 검문소에서 계속 ignored 된다(insert-only).
//
// 인증: push-sync.js와 동일 — 요청마다 Firebase ID 토큰을 동봉, 서버가 uid 사칭 차단.
import { checkOrigin, rateLimit } from "./_lib/security.js";
import { kv, kvConfigured } from "./_lib/kv.js";
import { verifyUid } from "./_lib/verify-uid.js";
import { parseTzOffset, HAE_TZ_OFFSET_MIN_DEFAULT } from "./_lib/import-rules.js";
import { planBodyImport } from "./_lib/body-import-rules.js";
import { storeBodyEntries, pushBodyLog, pushBodyLogError } from "./_lib/body-inbox-store.js";
import { pullRecentMetrics } from "./_lib/inbody-cloud.js";
import { createHash } from "node:crypto";

// ── 인바디 클라우드 직수신 (A안) ─────────────────────────────────
// 앱이 사서함을 pull하는 순간 서버가 인바디 클라우드에서 최신 측정을 당겨, HAE 단축어와
// "완전히 같은" 검문(planBodyImport)·사서함(storeBodyEntries) 경로에 합류시킨다.
// 크론이 없는 이유: 초안 착지에는 어차피 앱 열기가 필요하므로, 앱이 열리는 순간이 곧
// 최적의 pull 시점이다. env(INBODY_LOGIN_ID·INBODY_LOGIN_PW) 미설정이면 조용히 건너뜀
// — 이 두 변수가 클라우드 경로의 독립 롤백 스위치다(HAE·운동 경로 무영향).
// 스로틀 30분: 인바디 서버에는 실제 앱 수준의 호출 빈도만 발생시킨다.
const CLOUD_PULL_INTERVAL_MS = 30 * 60 * 1000;
// 연속 실패 상한 — 이 횟수를 넘기면 "지금 확인"(force)도 쿨다운을 지킨다.
// 근거: 인바디는 로그인 실패가 반복되면 계정을 잠근다(공식 FAQ의 3-strike). 실패 중에
// 사용자가 버튼을 연타하면 우리 서버가 계정을 잠가버릴 수 있으므로, 실패가 쌓이면
// 자동·수동 모두 30분 창을 지키게 해 계정을 보호한다. 성공하면 카운터는 0으로 리셋.
const CLOUD_FAIL_CEILING = 3;

// 인증 실패(비밀번호 불일치·ID 차단)는 "재시도하면 언젠가 되는" 오류가 아니다 — 같은
// 크리덴셜로 다시 두드릴수록 인바디의 실패 카운터만 깎아 계정을 잠근다(실측: PW_FAIL_4 →
// _3 → _2 카운트다운). 그래서 인증 실패가 나오면 그 크리덴셜을 24시간 봉인하고, 자동은
// 물론 "지금 확인"(force)도 막는다. 봉인은 크리덴셜 지문에 묶여 있어 env에서 비밀번호를
// 고치는 즉시 자동 해제된다(지문이 달라지면 다른 봉인으로 취급) — 24시간을 기다릴 필요 없음.
const AUTH_BLOCK_MS = 24 * 60 * 60 * 1000;
const AUTH_ERROR_RE = /PW_FAIL|ID_BLOCK|로그인 실패/i;
const credFingerprint = (id, pw) => createHash("sha256").update(`${id}\n${pw}`).digest("hex").slice(0, 16);

// 동시 실행 잠금 (2026-08 감사 R-01). 스로틀 도장은 `GET → 비교 → SET`이라 그 사이가
// 열려 있어, 동시 요청 2건이 둘 다 통과해 인바디에 로그인을 두 번 시도했다. 비밀번호가
// 틀린 상태였다면 봉인이 걸리기 전에 3-strike 중 2개를 한 번에 태운다(실측 재현).
// 그래서 시각 비교와 별개로 "지금 인바디를 호출 중인가"를 원자적 선점(SET NX)으로 가른다.
// force도 이 잠금은 지킨다 — 창을 건너뛰는 것과 동시에 두 번 두드리는 것은 다른 문제다.
// 실행이 끝나면 반드시 해제하므로 순차 재시도(연타)는 기존과 동일하게 동작한다.
const CLOUD_LOCK_TTL_SEC = 60;  // 함수가 죽어도 이 시간 뒤 자동 해제(교착 방지)
// 총 시간 예산 (R-09). pullRecentMetrics는 resolveHost→login→fetchScans 3단 순차라
// 요청별 타임아웃만으로는 합이 함수 maxDuration(30초)을 넘을 수 있고, 그러면 504로
// **운동 사서함 pull까지 함께 죽는다**. 클라우드는 예산을 넘기면 이번 회차를 포기한다.
const CLOUD_BUDGET_MS = 12000;
function withBudget(p, ms) {
  let timer;
  const alarm = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("인바디 시간 예산 초과")), ms); });
  // finally에서 반드시 타이머를 해제한다 — 안 하면 pull이 빨리 끝나도 타이머가 이벤트 루프를
  // 붙잡아 서버리스 함수가 예산(12초)만큼 더 살아 있는다.
  return Promise.race([p, alarm]).finally(() => clearTimeout(timer));
}

// 반환값은 이번 pull에서 클라우드가 "무엇을 했는지"를 알리는 상태 문자열이다.
// 조용한 return은 UX 사고였다 — 사용자가 "지금 확인"을 눌러도 아무 표시가 없으면
// 버튼이 고장 난 것과 구분할 수 없다(실사용 신고). 건너뛴 이유까지 화면에 보여준다.
//   off: 크리덴셜 미설정 · authBlocked: 비밀번호 오류로 봉인 · throttled: 최근 확인함
//   ok: 이번에 실행함 · failed: 실행했으나 오류(로그에 사유)
async function cloudPullIfDue(uid, force = false) {
  // trim: Vercel 환경변수에 붙여넣기 공백·개행이 섞이는 사고 방어(토큰 오염 사례의 교훈)
  const ID = (process.env.INBODY_LOGIN_ID || "").trim();
  const PW = (process.env.INBODY_LOGIN_PW || "").trim();
  const CUTOVER = process.env.IMPORT_BODY_CUTOVER_DATE;
  // 크리덴셜은 기록 주인 것 — 주인 uid의 pull에서만 동작(다른 계정이 트리거 불가)
  if (!ID || !PW || !CUTOVER || uid !== process.env.IMPORT_UID) return "off";

  // force = 설정 카드의 "지금 확인"(명시적 사용자 의도) — 스로틀을 건너뛰고 즉시 당긴다.
  // 자동 pull(앱 시작 동기화)만 30분 간격을 지켜 인바디 서버에 앱 수준 빈도를 유지.
  // 단 연속 실패가 상한을 넘으면 force도 창을 지킨다 — 계정 잠금 방어(위 상수 주석).
  const throttleKey = `import:body-cloud-at:${uid}`;
  const failKey = `import:body-cloud-fail:${uid}`;
  const authBlockKey = `import:body-cloud-authblock:${uid}`;
  const lockKey = `import:body-cloud-lock:${uid}`;
  const fp = credFingerprint(ID, PW);

  // 인증 봉인 확인 — 같은 크리덴셜이 24시간 안에 인증 실패했으면 아예 시도하지 않는다.
  // env를 고쳐 지문이 바뀌면 이 조건이 자연히 풀린다(즉시 재시도 가능).
  const authBlock = await kv("GET", authBlockKey);
  if (authBlock) {
    const [blockedFp, blockedAt] = String(authBlock).split("|");
    if (blockedFp === fp && Date.now() - Date.parse(blockedAt) < AUTH_BLOCK_MS) return "authBlocked";
  }

  // 동시 실행 선점 — 원자적(SET NX). 실패하면 다른 요청이 이미 인바디를 호출 중이다.
  // 시각 창(스로틀)보다 먼저 잡아야 GET~SET 사이의 경합 창이 사라진다.
  const gotLock = await kv("SET", lockKey, new Date().toISOString(), "NX", "EX", String(CLOUD_LOCK_TTL_SEC));
  if (gotLock === null) return "throttled";

  try {
    const fails = parseInt((await kv("GET", failKey)) || "0", 10) || 0;
    if (!force || fails >= CLOUD_FAIL_CEILING) {
      const last = await kv("GET", throttleKey);
      if (last && Date.now() - Date.parse(last) < CLOUD_PULL_INTERVAL_MS) return "throttled";
    }
    await kv("SET", throttleKey, new Date().toISOString()); // 30분 창 소모(실패해도 유지 — 아래 주석)

    try {
      const tz = parseTzOffset(process.env.IMPORT_TZ_OFFSET) ?? HAE_TZ_OFFSET_MIN_DEFAULT;
      const { payload } = await withBudget(pullRecentMetrics({
        loginId: ID, loginPw: PW,
        countryCode: process.env.INBODY_COUNTRY || "KR",
        count: 5, tzOffsetMin: tz,
      }), CLOUD_BUDGET_MS);
      const { entries, summary } = planBodyImport(payload, { cutoverDate: CUTOVER, tzOffsetMin: tz });
      const { accepted, ignored } = await storeBodyEntries(uid, entries);
      await pushBodyLog(uid, "cloud", { accepted, ignored, summary });
      // 성공 — 실패 카운터·인증 봉인 모두 해제
      try { await kv("SET", failKey, "0"); await kv("DEL", authBlockKey); } catch { /* 무시 */ }
      console.log(`[import-inbox] cloud pull accepted=${accepted} ignored=${ignored} rejected=${summary.rejected} excluded=${summary.excluded}`);
      return "ok";
    } catch (e) {
      // 실패도 카드에 보인다 — "지금 확인"이 성공이든 실패든 반드시 로그 한 줄을 남긴다(관측성).
      // 인증 실패면 크리덴셜 "형태"(길이·앞 3자)를 덧붙인다 — 서버에 저장된 값이 사용자가
      // 아는 값과 다른지를 값 노출 없이 판별하는 유일한 창구.
      const isAuthError = AUTH_ERROR_RE.test(String((e && e.message) || ""));
      await pushBodyLogError(uid, "cloud", isAuthError ? `${e.message} — ${credShape(ID, PW)}` : e);
      // 실패 시 스로틀 도장은 "유지"한다(해제 금지) — 실패 상태에서 즉시 재시도를 반복하면
      // 인바디가 계정을 잠글 수 있다. 카운터를 올려 상한을 넘으면 force도 창을 지키게 한다.
      // INCR로 올린다(감사 R-01): GET→parseInt→SET은 read-modify-write라 동시 실패 시
      // 증분이 유실돼 상한 도달이 늦어진다 = 계정을 더 두드린다.
      // 카운터를 못 올리면 상한 방어가 조용히 무력화된다(연타가 계속 인바디를 두드림).
      // 막을 수는 없어도 반드시 드러낸다 — 침묵이 이 계층의 최대 위험이다.
      try { await kv("INCR", failKey); }
      catch (ie) { console.error("[import-inbox] fail counter INCR 실패 — 연속 실패 상한이 동작하지 않을 수 있음:", ie); }
      // 인증 실패는 재시도로 낫지 않는다 — 이 크리덴셜을 즉시 봉인해 남은 시도 횟수를 지킨다.
      if (isAuthError) {
        // 봉인 쓰기가 실패하면 다음 force가 다시 인바디를 두드린다 — 조용히 넘기지 않고
        // 최소한 로그를 남긴다(감사 R-13의 관측성 보강).
        try { await kv("SET", authBlockKey, `${fp}|${new Date().toISOString()}`); }
        catch (be) { console.error("[import-inbox] authblock write failed — 다음 시도가 봉인 없이 진행됨:", be); }
      }
      throw e;
    }
  } finally {
    // 선점 해제 — 순차 재시도(연타)는 기존과 동일하게 동작해야 한다.
    try { await kv("DEL", lockKey); } catch { /* TTL이 60초 뒤 자동 해제 */ }
  }
}

// 인증 실패 진단용 크리덴셜 요약 — 값은 절대 남기지 않고 "형태"만 보여준다.
// 서버에 저장된 값이 사용자가 아는 값과 다른지(오타·잘림·공백·앞자리 0 누락)를
// 로그 한 줄로 판별하기 위한 것. 아이디는 앞 3자만(010 vs 10 구분), 나머지는 길이만.
export function credShape(id, pw) {
  return `ID ${id.length}자(${id.slice(0, 3)}…) · PW ${pw.length}자`;
}

// Upstash HGETALL은 REST 응답에서 [field, value, field, value, ...] 평탄 배열로 온다.
function hashToEntries(result) {
  if (!result) return [];
  if (Array.isArray(result)) {
    const out = [];
    for (let i = 0; i + 1 < result.length; i += 2) out.push([result[i], result[i + 1]]);
    return out;
  }
  if (typeof result === "object") return Object.entries(result);
  return [];
}

export default async function handler(req, res) {
  if (!checkOrigin(req, res)) return;
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await rateLimit(req, res, { key: "import-inbox", max: 30, windowSec: 60 }))) return;

  if (!kvConfigured()) {
    console.error("[import-inbox] KV not configured");
    return res.status(500).json({ error: "Not configured" });
  }

  const { uid, idToken, action, keys, bodyKeys, force } = req.body || {};
  if (!uid || typeof uid !== "string" || uid.length > 128) {
    return res.status(400).json({ error: "uid required" });
  }
  if (!(await verifyUid(idToken, uid))) {
    return res.status(401).json({ error: "auth required" });
  }

  const inboxKey = `import:inbox:${uid}`;
  const bodyInboxKey = `import:body-inbox:${uid}`;

  try {
    if (action === "pull") {
      const raw = await kv("HGETALL", inboxKey);
      const entries = [];
      for (const [, v] of hashToEntries(raw)) {
        try { entries.push(JSON.parse(v)); } catch { /* 손상 항목은 건너뜀 */ }
      }
      entries.sort((a, b) => (a.ts || 0) - (b.ts || 0));

      let log = [];
      try {
        const rawLog = (await kv("LRANGE", `import:log:${uid}`, "0", "4")) || [];
        log = rawLog.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
      } catch { /* 로그는 표시용 — 실패해도 pull은 계속 */ }

      // 인바디 클라우드 직수신 — 사서함을 읽기 "전"에 당겨와 이번 응답에 바로 실린다.
      // 실패해도 pull 전체는 계속(운동·HAE 경로 격리). 30분 스로틀은 함수 내부에서.
      let bodyCloudStatus = "off";
      try { bodyCloudStatus = (await cloudPullIfDue(uid, force === true)) || "off"; }
      catch (e) { bodyCloudStatus = "failed"; console.error("[import-inbox] cloud pull failed:", e); }

      // 체성분 사서함(별도 키) — additive 확장: 구 클라이언트는 이 필드들을 무시한다(계약 불변)
      const bodyEntries = [];
      try {
        const bodyRaw = await kv("HGETALL", bodyInboxKey);
        for (const [, v] of hashToEntries(bodyRaw)) {
          try { bodyEntries.push(JSON.parse(v)); } catch { /* 손상 항목은 건너뜀 */ }
        }
        bodyEntries.sort((a, b) => (a.sampleTs || 0) - (b.sampleTs || 0));
      } catch { /* 체성분 사서함 실패가 운동 pull을 막지 않는다(격리) */ }

      let bodyLog = [];
      try {
        const rawBodyLog = (await kv("LRANGE", `import:body-log:${uid}`, "0", "4")) || [];
        bodyLog = rawBodyLog.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
      } catch { /* 표시용 */ }

      return res.status(200).json({
        entries,
        log,
        cutover: process.env.IMPORT_CUTOVER_DATE || null,
        enabled: !!(process.env.IMPORT_TOKEN && process.env.IMPORT_UID && process.env.IMPORT_CUTOVER_DATE),
        bodyEntries,
        bodyLog,
        bodyCutover: process.env.IMPORT_BODY_CUTOVER_DATE || null,
        bodyEnabled: !!(process.env.IMPORT_TOKEN && process.env.IMPORT_UID && process.env.IMPORT_BODY_CUTOVER_DATE),
        // 인바디 클라우드 직수신 활성 여부 — INBODY_LOGIN_ID·PW가 롤백 스위치
        bodyCloudEnabled: !!(process.env.INBODY_LOGIN_ID && process.env.INBODY_LOGIN_PW && process.env.IMPORT_BODY_CUTOVER_DATE),
        // 이번 pull에서 클라우드가 무엇을 했는지 — 버튼을 눌러도 아무 반응이 없어 보이는
        // 상황(미설정·봉인·스로틀)을 사용자가 화면에서 바로 구분할 수 있게 한다.
        bodyCloudStatus,
      });
    }

    if (action === "ack") {
      // keys(운동)·bodyKeys(체성분) 각각 독립 HDEL — 구 클라이언트(keys만 전송)는 기존과 동일 동작
      const sanitize = (arr) => (Array.isArray(arr) ? arr.filter((k) => typeof k === "string" && k.length > 0 && k.length <= 300) : []);
      if ((Array.isArray(keys) && keys.length > 500) || (Array.isArray(bodyKeys) && bodyKeys.length > 500)) {
        return res.status(400).json({ error: "keys required" });
      }
      const safe = sanitize(keys);
      const safeBody = sanitize(bodyKeys);
      if (!safe.length && !safeBody.length) return res.status(400).json({ error: "keys required" });
      const removed = safe.length ? await kv("HDEL", inboxKey, ...safe) : 0;
      const bodyRemoved = safeBody.length ? await kv("HDEL", bodyInboxKey, ...safeBody) : 0;
      return res.status(200).json({ ok: true, removed: Number(removed) || 0, bodyRemoved: Number(bodyRemoved) || 0 });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[import-inbox]", e);
    return res.status(500).json({ error: "inbox failed" });
  }
}
