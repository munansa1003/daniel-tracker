// api/_lib/security.js — 공통 보안 유틸 (Vercel은 _ 접두사 디렉토리를 라우트로 노출하지 않음)
// 모든 API 핸들러는 이 모듈의 checkOrigin / rateLimit를 import해서 사용

// 허용 origin 목록 — 로컬 dev + 프로덕션 도메인(들) (env에서 주입)
// PRODUCTION_ORIGIN은 콤마(,)로 구분된 여러 origin 지원 (예: 커스텀 도메인 + Vercel 기본 도메인)
function getAllowedOrigins() {
  const list = [
    "http://localhost:5173",  // vite dev
    "http://localhost:4173",  // vite preview
  ];
  const prod = process.env.PRODUCTION_ORIGIN;
  if (prod) {
    prod.split(",").map(s => s.trim()).filter(Boolean).forEach(o => list.push(o));
  }
  // Vercel preview 배포 (브랜치별 자동 도메인) — VERCEL_URL은 자동 주입됨
  if (process.env.VERCEL_URL) list.push(`https://${process.env.VERCEL_URL}`);
  return list;
}

export function checkOrigin(req, res) {
  const origin = req.headers.origin || "";
  const allowed = getAllowedOrigins();
  if (!allowed.includes(origin)) {
    res.status(403).json({ error: "Forbidden origin" });
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

// IP 추출 (Vercel은 x-forwarded-for 첫 항목이 실제 클라이언트)
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  return req.headers["x-real-ip"] || "unknown";
}

// Upstash Redis REST API 기반 분당 rate limit
// (Vercel 마켓플레이스의 Upstash 통합 시 KV_REST_* 또는 UPSTASH_REDIS_REST_* env 자동 주입)
// KV 미설정 시: 프로덕션에선 경고 후 통과(fail-open) — 가용성 우선, 추후 강제 가능
export async function rateLimit(req, res, { key, max, windowSec = 60 }) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      console.warn(`[rateLimit] KV not configured — bypassed for ${key}`);
    }
    return true;
  }

  const ip = getClientIp(req);
  const fullKey = `rl:${key}:${ip}`;

  try {
    const incRes = await fetch(`${url}/incr/${encodeURIComponent(fullKey)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!incRes.ok) throw new Error(`KV incr ${incRes.status}`);
    const { result: count } = await incRes.json();

    // 첫 호출일 때만 TTL 설정 (이후 요청은 같은 윈도우 안에서 카운트만 증가)
    if (count === 1) {
      await fetch(`${url}/expire/${encodeURIComponent(fullKey)}/${windowSec}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    if (count > max) {
      res.setHeader("Retry-After", String(windowSec));
      res.status(429).json({ error: "Too many requests", retryAfter: windowSec });
      return false;
    }
    return true;
  } catch (e) {
    console.error("[rateLimit] error:", e);
    return true; // KV 장애 시 fail-open
  }
}
