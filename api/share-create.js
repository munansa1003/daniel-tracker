// api/share-create.js — AI 공유 링크 발급.
// 앱(브라우저)이 만든 분석 패키지를 받아 임의 토큰과 함께 KV에 TTL로 저장한다.
// 이 라우트는 앱이 fetch로 호출하므로 checkOrigin을 적용한다(공유 뷰와 반대).
import { checkOrigin, rateLimit } from "./_lib/security.js";
import { kvConfigured } from "./_lib/kv.js";
import { verifyIdToken } from "./_lib/verify-auth.js";
import { putShare, ttlHoursOf, MAX_PKG_BYTES, TTL_OPTIONS } from "./_lib/share-store.js";

export default async function handler(req, res) {
  if (!checkOrigin(req, res)) return;
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await rateLimit(req, res, { key: "share-create", max: 10, windowSec: 60 }))) return;

  if (!kvConfigured()) {
    console.error("[share-create] KV not configured");
    return res.status(500).json({ error: "Not configured" });
  }

  const { idToken, pkg, ttl } = req.body || {};

  // 본인 확인 — 남의 토큰으로 발급/저장 불가
  const uid = await verifyIdToken(idToken);
  if (!uid) return res.status(401).json({ error: "auth required" });

  if (typeof pkg !== "string" || pkg.length < 50) {
    return res.status(400).json({ error: "pkg required" });
  }
  if (Buffer.byteLength(pkg, "utf8") > MAX_PKG_BYTES) {
    return res.status(413).json({ error: "too large", hint: "기간을 줄이거나 코치 요약본을 사용하세요" });
  }
  if (ttl && !TTL_OPTIONS.some((o) => o.key === ttl)) {
    return res.status(400).json({ error: "bad ttl" });
  }

  try {
    const hours = ttlHoursOf(ttl);
    const ttlSeconds = hours * 3600;
    const token = globalThis.crypto.randomUUID().replace(/-/g, ""); // 32자 hex(122비트 난수)
    const now = Date.now();
    await putShare(token, { uid, pkg, createdAt: now, expiresAt: now + ttlSeconds * 1000 }, ttlSeconds);

    return res.status(200).json({
      ok: true,
      token,
      path: `/export/view/${token}`, // 경로형 — 일부 리더가 쿼리스트링을 유실해서. 쿼리형(?t=)도 서버는 계속 받음
      expiresAt: now + ttlSeconds * 1000,
      ttlHours: hours,
    });
  } catch (e) {
    console.error("[share-create]", e);
    return res.status(500).json({ error: "create failed" });
  }
}
