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
import { storeBodyEntries, pushBodyLog } from "./_lib/body-inbox-store.js";
import { pullRecentMetrics } from "./_lib/inbody-cloud.js";

// ── 인바디 클라우드 직수신 (A안) ─────────────────────────────────
// 앱이 사서함을 pull하는 순간 서버가 인바디 클라우드에서 최신 측정을 당겨, HAE 단축어와
// "완전히 같은" 검문(planBodyImport)·사서함(storeBodyEntries) 경로에 합류시킨다.
// 크론이 없는 이유: 초안 착지에는 어차피 앱 열기가 필요하므로, 앱이 열리는 순간이 곧
// 최적의 pull 시점이다. env(INBODY_LOGIN_ID·INBODY_LOGIN_PW) 미설정이면 조용히 건너뜀
// — 이 두 변수가 클라우드 경로의 독립 롤백 스위치다(HAE·운동 경로 무영향).
// 스로틀 30분: 인바디 서버에는 실제 앱 수준의 호출 빈도만 발생시킨다.
const CLOUD_PULL_INTERVAL_MS = 30 * 60 * 1000;

async function cloudPullIfDue(uid) {
  const ID = process.env.INBODY_LOGIN_ID;
  const PW = process.env.INBODY_LOGIN_PW;
  const CUTOVER = process.env.IMPORT_BODY_CUTOVER_DATE;
  // 크리덴셜은 기록 주인 것 — 주인 uid의 pull에서만 동작(다른 계정이 트리거 불가)
  if (!ID || !PW || !CUTOVER || uid !== process.env.IMPORT_UID) return;

  const throttleKey = `import:body-cloud-at:${uid}`;
  const last = await kv("GET", throttleKey);
  if (last && Date.now() - Date.parse(last) < CLOUD_PULL_INTERVAL_MS) return;
  await kv("SET", throttleKey, new Date().toISOString()); // 선점 — 동시 pull의 중복 호출 방지

  try {
    const tz = parseTzOffset(process.env.IMPORT_TZ_OFFSET) ?? HAE_TZ_OFFSET_MIN_DEFAULT;
    const { payload } = await pullRecentMetrics({
      loginId: ID, loginPw: PW,
      countryCode: process.env.INBODY_COUNTRY || "KR",
      count: 5, tzOffsetMin: tz,
    });
    const { entries, summary } = planBodyImport(payload, { cutoverDate: CUTOVER, tzOffsetMin: tz });
    const { accepted, ignored } = await storeBodyEntries(uid, entries);
    await pushBodyLog(uid, "cloud", { accepted, ignored, summary });
    console.log(`[import-inbox] cloud pull accepted=${accepted} ignored=${ignored} rejected=${summary.rejected} excluded=${summary.excluded}`);
  } catch (e) {
    // 실패 시 스로틀 해제 — 다음 앱 열기에서 즉시 재시도 (HAE·수동 경로는 그대로 살아 있음)
    try { await kv("DEL", throttleKey); } catch { /* 무시 */ }
    throw e;
  }
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

  const { uid, idToken, action, keys, bodyKeys } = req.body || {};
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
      try { await cloudPullIfDue(uid); } catch (e) { console.error("[import-inbox] cloud pull failed:", e); }

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
