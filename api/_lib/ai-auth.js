// api/_lib/ai-auth.js — AI 분석 API(analyze-*) 로그인 확인.
// Anthropic 사용량(돈)이 드는 라우트를 아무나 호출하지 못하게, Firebase ID 토큰을 검증하고
// 허용된 uid만 통과시킨다. 검증은 verify-auth.js(Admin SDK 없이 identitytoolkit 조회)를 재사용.
//
// 환경변수 AI_ALLOWED_UIDS (병행 호환 스위치):
//   - 없음/빈 값  → 검증 끔. 지금까지와 똑같이 동작(origin + IP 분당 제한만).
//   - "uid1,uid2" → 그 uid로 로그인한 요청만 통과.
//   - "*"         → 로그인(유효 토큰)만 확인, uid는 묻지 않음.
// 토큰은 요청 본문의 idToken 필드로 받는다(share-create와 같은 방식 — CORS 헤더 변경 불필요).
import { verifyIdToken } from "./verify-auth.js";

// 같은 토큰을 연달아 검증하지 않도록 웜 인스턴스 안에서 잠깐 기억한다.
// Firebase ID 토큰 수명은 1시간 — 5분 캐시는 그 안쪽이다.
const CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX = 50;
const cache = new Map(); // idToken → { uid, at }

export function parseAllowedUids(raw) {
  if (typeof raw !== "string") return null;
  const list = raw.split(",").map(s => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

async function uidOf(idToken) {
  const hit = cache.get(idToken);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.uid;
  const uid = await verifyIdToken(idToken);
  if (uid) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(idToken, { uid, at: Date.now() });
  }
  return uid;
}

// 테스트 전용
export function _resetAiAuthCache() { cache.clear(); }

// 통과면 true. 막으면 응답(401/403)을 보내고 false.
export async function requireAiAuth(req, res) {
  const allowed = parseAllowedUids(process.env.AI_ALLOWED_UIDS);
  if (!allowed) return true; // 스위치 꺼짐 → 기존 동작 그대로

  const idToken = req.body?.idToken;
  const uid = typeof idToken === "string" && idToken ? await uidOf(idToken) : null;
  if (!uid) {
    res.status(401).json({ error: "로그인이 필요해요. 다시 로그인한 뒤 시도해주세요.", code: "auth_required" });
    return false;
  }
  if (!allowed.includes("*") && !allowed.includes(uid)) {
    res.status(403).json({ error: "이 계정은 AI 분석을 쓸 수 없어요.", code: "not_allowed" });
    return false;
  }
  return true;
}
