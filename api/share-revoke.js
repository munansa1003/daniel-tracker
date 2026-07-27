// api/share-revoke.js — AI 공유 링크 즉시 폐기.
// 만료를 기다리지 않고 링크를 죽인다. 소유자(uid) 일치를 확인해 남의 링크는 못 지운다.
import { checkOrigin, rateLimit } from "./_lib/security.js";
import { kvConfigured } from "./_lib/kv.js";
import { verifyIdToken } from "./_lib/verify-auth.js";
import { getShare, delShare, isValidToken } from "./_lib/share-store.js";

export default async function handler(req, res) {
  if (!checkOrigin(req, res)) return;
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await rateLimit(req, res, { key: "share-revoke", max: 20, windowSec: 60 }))) return;

  if (!kvConfigured()) return res.status(500).json({ error: "Not configured" });

  const { idToken, token } = req.body || {};
  const uid = await verifyIdToken(idToken);
  if (!uid) return res.status(401).json({ error: "auth required" });
  if (!isValidToken(token)) return res.status(400).json({ error: "bad token" });

  try {
    const rec = await getShare(token);
    // 이미 만료·삭제된 경우도 성공으로 취급(멱등) — 앱은 어차피 상태를 지운다
    if (!rec) return res.status(200).json({ ok: true, alreadyGone: true });
    if (rec.uid !== uid) return res.status(403).json({ error: "not owner" });

    await delShare(token);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[share-revoke]", e);
    return res.status(500).json({ error: "revoke failed" });
  }
}
