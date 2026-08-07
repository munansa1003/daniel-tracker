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
