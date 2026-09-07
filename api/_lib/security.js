// api/_lib/security.js — 공통 보안 유틸 (Vercel은 _ 접두사 디렉토리를 라우트로 노출하지 않음)
// 모든 API 핸들러는 이 모듈의 checkOrigin / rateLimit / safeEqual을 import해서 사용
import { timingSafeEqual } from "node:crypto";

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
  // Vercel preview 배포 (브랜치별 자동 도메인) — VERCEL_URL은 자동 주입됨.
  // Firebase로 옮긴 뒤에도 남겨 둔다: 병행 기간엔 같은 코드가 Vercel에서도 돌기 때문이다.
  // Firebase 쪽에는 이 변수가 없으므로 이 줄은 그냥 지나간다.
  if (process.env.VERCEL_URL) list.push(`https://${process.env.VERCEL_URL}`);
  return list;
}

// Firebase Hosting 프리뷰 채널 원점 허용 — **스테이징 전용**.
//
// 채널 주소는 배포마다 호스트가 달라(`<project>--<채널>-<해시>.web.app`) 목록으로 못 적는다.
// 그래서 PREVIEW_ORIGIN_SUFFIX(콤마로 여러 개)로 연다. 열리는 조건이 두 겹이다:
//   ① 값이 **설정돼 있어야** 한다 — prod에는 두지 않으므로 기본 상태는 완전 off.
//   ② https 이고, 호스트가 그 값과 맞아야 한다.
//
// 값의 형태는 둘 다 받는다:
//   · `*` 없는 값 → 순수 접미사. 호스트가 그 접미사보다 **길면서** 그것으로 끝나야 한다.
//     "더 길어야 한다"가 중요하다 — 같으면 그건 프리뷰가 아니라 고정 도메인이고, 고정 도메인은
//     PRODUCTION_ORIGIN에 정확히 적는 자리다. 여기서 같은 것까지 받으면 값 하나로 고정 도메인이
//     조용히 열려 이 함수의 의미가 흐려진다.
//   · `*` 있는 값 → 호스트 패턴. `*`는 **점을 넘지 않는** 한 조각과만 맞는다.
//     프리뷰 채널 호스트는 프로젝트 이름이 **앞**에 오므로(`bodyplan-staging--pr-12-ab34cd.web.app`)
//     순수 접미사로는 프로젝트를 못 묶는다 — `.web.app`으로 열면 남의 Firebase 사이트까지 열린다.
//     `bodyplan-staging--*.web.app`처럼 적으면 그 프로젝트의 채널만 허용된다(03 §2 C안의 표기).
// 값은 정규식이 아니다 — `*` 외의 모든 문자는 이스케이프해 그대로 비교한다.
function matchesPreviewSuffix(origin) {
  const raw = process.env.PREVIEW_ORIGIN_SUFFIX;
  if (!raw) return false;
  let host;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    host = u.host;
  } catch { return false; }
  return raw.split(",").map(s => s.trim()).filter(Boolean).some((pat) => {
    if (!pat.includes("*")) return host.length > pat.length && host.endsWith(pat);
    const re = new RegExp("^" + pat.split("*").map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^.]*") + "$");
    return re.test(host);
  });
}

export function checkOrigin(req, res) {
  const origin = req.headers.origin || "";
  const allowed = getAllowedOrigins();
  if (!allowed.includes(origin) && !matchesPreviewSuffix(origin)) {
    res.status(403).json({ error: "Forbidden origin" });
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

// 비밀값 비교 — 길이가 달라도 던지지 않고, 같은 길이면 바이트 수와 무관하게 같은 시간이 걸린다.
// (=== 는 첫 불일치에서 빠져나와 "앞 몇 글자가 맞았는지"가 응답 시간에 새어나갈 수 있다)
export function safeEqual(a, b) {
  const A = Buffer.from(String(a ?? ""), "utf8");
  const B = Buffer.from(String(b ?? ""), "utf8");
  // 길이 자체가 다르면 timingSafeEqual이 던지므로, 길이 비교는 따로 하고 본문은 항상 비교한다
  // (길이가 다를 때 즉시 false를 반환해도 새는 정보는 "길이"뿐 — 비밀값 내용은 새지 않는다)
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

// IP 추출 — rate limit의 **버킷 키**다. 틀리면 조용히 망가지는 종류라 순서를 못 박아 둔다.
//
// Vercel: `x-forwarded-for`의 첫 항목이 실제 클라이언트였다(플랫폼이 이 헤더를 덮어쓴다).
// Firebase Hosting: 앞단이 Fastly CDN이라 원 IP가 `fastly-client-ip`로 오고,
//   `x-forwarded-for`에는 **CDN의 IP**가 실릴 수 있다. 그대로 두면 모든 사용자가 한 버킷에
//   뭉쳐, 남이 쓴 횟수 때문에 내가 429를 맞는다(정상 사용자가 막히는 형태의 사고).
//
// ⚠️ `fastly-client-ip`를 **아무 데서나 먼저 보면 안 된다.** Vercel은 그 헤더를 덮어쓰지
// 않으므로, 그대로 신뢰하면 공격자가 헤더 하나로 자기 버킷을 매 요청 새로 만들어
// **rate limit을 통째로 우회**한다. 토큰 추측 시도에 횟수 제한을 걸어 둔 것이 감사 R-39의
// 요지인데, 그 방어가 병행 기간의 Vercel 쪽에서만 사라지는 형태가 된다.
// 그래서 플랫폼을 먼저 확인한다: `K_SERVICE`는 **Cloud Run이 주입**하는 값이라 사용자가
// 넣을 수 없다. 그 값이 있을 때만 Fastly 헤더를 신뢰하고, 없으면(=Vercel·로컬) 옛 순서 그대로다.
//
// 남는 위험은 설계 문서가 이미 받아들인 것 하나뿐이다: Hosting을 건너뛰고 함수의 직접
// URL(*.run.app)로 부르면 그때는 Fastly 헤더도 위조 가능하다(02 §1 #22, P2).
// 즉 rate limit은 "실수·과사용 방어"이지 결정적 방벽이 아니다 — 진짜 방벽은 각 라우트의
// 토큰/origin 검문이고, 검문보다 rate limit이 먼저라는 순서는 R-39에서 이미 고정했다.
export function getClientIp(req) {
  const headers = req.headers || {};
  if (process.env.K_SERVICE) {
    const fastly = headers["fastly-client-ip"];
    if (typeof fastly === "string" && fastly.trim()) return fastly.trim();
  }
  const xff = headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  const real = headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  return req.socket?.remoteAddress || "unknown";
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
