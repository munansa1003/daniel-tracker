// api/export-view.js — Vercel Serverless Function (공유 뷰 Phase 1)
// AI 리더(Claude 웹)가 URL만으로 읽을 수 있는 SSR 텍스트 뷰. 현재는 가상 데이터 검증용.
//
// ⚠️ checkOrigin을 적용하지 않는다(의도적):
//   이 라우트는 브라우저 앱(fetch)이 아니라 **외부 리더·주소창 직접 방문**이 Origin 헤더
//   없이 GET 하는 공개 읽기 경로다. checkOrigin은 화이트리스트에 없는 origin을 403으로
//   막으므로(빈 origin 포함) 여기 걸면 정상 요청이 전부 실패한다.
//   대신 (1) 토큰 일치 시에만 본문 응답 (2) 불일치·누락은 404 (3) rateLimit(분당 30)
//   (4) noindex·no-store 로 노출을 통제한다.
import { buildAnalysisPackage, resolvePeriod } from "../src/analysisExport.js";
import { sampleState } from "./_lib/sample-state.js";
import { rateLimit } from "./_lib/security.js";
import { kvConfigured } from "./_lib/kv.js";
import { getShare, touchShare, isValidToken } from "./_lib/share-store.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  // 공개 경로라 관대하게(분당 30) — 리더가 재시도해도 막히지 않을 수준
  if (!(await rateLimit(req, res, { key: "export-view", max: 30, windowSec: 60 }))) return;

  const expected = process.env.SHARE_TEST_TOKEN;
  const token = req.query?.token;   // Phase 1: 환경변수 토큰 → 가상 샘플
  const share = req.query?.t;       // Phase 2: 앱이 발급한 공유 토큰 → KV 스냅샷

  // 진단 모드(?diag=1) — 배포/설정 문제를 토큰 없이 구분하기 위한 최소 정보.
  // 토큰 값·사용자 데이터는 절대 싣지 않는다(설정 여부·커밋·환경만).
  if (req.query?.diag === "1") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      route: "export-view",
      tokenConfigured: !!expected,          // 환경변수가 이 배포에 주입됐는지
      tokenLength: expected ? expected.length : 0, // 값 자체는 노출하지 않음(길이만)
      shareEnabled: kvConfigured(),         // 공유 링크(Phase 2) 사용 가능 여부
      vercelEnv: process.env.VERCEL_ENV || "unknown",
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "unknown",
      branch: process.env.VERCEL_GIT_COMMIT_REF || "unknown",
    });
  }

  const noStore = () => { res.setHeader("Cache-Control", "no-store"); };
  // 사람이 읽을 수 있는 404 — 빈 "Not found"는 "라우트 자체가 없다"로 오해되기 쉽다(실제 오진 사례).
  // 만료/미발급/폐기를 구분해 알려주지 않으므로(같은 문구) 토큰 존재 여부는 여전히 노출되지 않는다.
  const notFound = (reason) => {
    noStore();
    res.setHeader("X-Share-View", reason);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return res.status(404).send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">
<title>링크를 찾을 수 없음</title></head>
<body>
<p>이 링크는 만료되었거나 존재하지 않습니다.</p>
<p>앱에서 새 공유 링크를 만들어 주세요. (로그인은 필요하지 않으며, 링크 자체가 유효해야 합니다)</p>
</body></html>`);
  };
  const render = (metaLine, pkg) => {
    const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Body Plan 공유 뷰</title>
</head>
<body>
<p>${esc(metaLine)}</p>
<pre>${esc(pkg)}</pre>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return res.status(200).send(html);
  };

  // ── Phase 2: 앱이 발급한 공유 링크 (?t=) ──
  // 저장된 스냅샷을 그대로 렌더. 만료·폐기된 토큰은 KV에서 사라져 자동으로 404.
  if (share !== undefined) {
    if (!isValidToken(share) || !kvConfigured()) {
      return notFound(kvConfigured() ? "denied" : "unconfigured");
    }
    try {
      const rec = await getShare(share);
      if (!rec) return notFound("expired"); // KV에 없음 = 만료로 자동 소멸했거나 존재한 적 없음
      // 폐기 흔적(tombstone) 또는 만료 경계(TTL 정리 직전) → 410 Gone으로 명확히 안내
      if (rec.revoked || typeof rec.pkg !== "string" || (rec.expiresAt && rec.expiresAt <= Date.now())) {
        noStore();
        res.setHeader("X-Share-View", rec.revoked ? "revoked" : "expired");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        return res.status(410).send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">
<title>링크 만료</title></head>
<body><p>이 링크는 만료되었거나 폐기되었습니다. 앱에서 새 공유 링크를 만들어 주세요.</p></body></html>`);
      }
      // 접근 통계 — 렌더를 막지 않게 fire-and-forget (KEEPTTL로 만료 시각 보존)
      touchShare(share, rec).catch(() => {});
      const created = new Date(rec.createdAt || Date.now()).toISOString().slice(0, 16).replace("T", " ");
      const expires = new Date(rec.expiresAt || Date.now()).toISOString().slice(0, 16).replace("T", " ");
      return render(`Body Plan 공유 뷰 · 공유 시점 스냅샷 · 생성: ${created} UTC · 만료: ${expires} UTC`, rec.pkg);
    } catch (e) {
      console.error("[export-view] share read error:", e);
      return notFound("error");
    }
  }

  // ── Phase 1: 환경변수 토큰 (?token=) → 가상 샘플 ──
  // 토큰 불일치·누락은 404(존재 자체를 숨김) + 어떤 데이터도 싣지 않음
  // 본문엔 데이터를 싣지 않되, 원인 구분은 헤더로만(설정 누락 vs 값 불일치)
  if (!expected || token !== expected) return notFound(expected ? "denied" : "unconfigured");

  const today = todayStr();
  const range = resolvePeriod("2w", today, {}); // 최근 14일
  const pkg = buildAnalysisPackage(sampleState(today), range, today); // 코치 요약본(기본)
  return render(`Body Plan 공유 뷰 · Phase 1 테스트(가상 데이터) · 생성: ${today}`, pkg);
}
