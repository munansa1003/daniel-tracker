// api/verify-master.js — 관리자 마스터키 검증 (Vercel Serverless Function)
//
// 목적: 클라이언트 번들에서 ADMIN_PASSWORD를 제거하고 서버에서만 검증.
//      브루트포스 방지를 위해 IP당 분당 5회로 rate limit.
//
// 환경변수:
//   - ADMIN_MASTER_KEY  (필수)  마스터 비밀번호
//   - PRODUCTION_ORIGIN (필수)  프로덕션 도메인 (origin 화이트리스트용)
//   - KV_REST_API_URL / KV_REST_API_TOKEN (Vercel KV 자동 주입)

import { checkOrigin, rateLimit, safeEqual } from "./_lib/security.js";

export default async function handler(req, res) {
  if (!checkOrigin(req, res)) return;
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // 분당 5회 제한 (브루트포스 방지)
  if (!(await rateLimit(req, res, { key: "verify-master", max: 5, windowSec: 60 }))) return;

  const { pw } = req.body || {};
  const masterKey = process.env.ADMIN_MASTER_KEY;
  if (!masterKey) {
    console.error("[verify-master] ADMIN_MASTER_KEY not configured");
    return res.status(500).json({ error: "Not configured" });
  }

  if (!safeEqual(pw, masterKey)) {
    return res.status(401).json({ ok: false });
  }

  return res.status(200).json({ ok: true });
}
