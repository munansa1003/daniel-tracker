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
  const token = req.query?.token;

  // 진단 모드(?diag=1) — 배포/설정 문제를 토큰 없이 구분하기 위한 최소 정보.
  // 토큰 값·사용자 데이터는 절대 싣지 않는다(설정 여부·커밋·환경만).
  if (req.query?.diag === "1") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      route: "export-view",
      tokenConfigured: !!expected,          // 환경변수가 이 배포에 주입됐는지
      tokenLength: expected ? expected.length : 0, // 값 자체는 노출하지 않음(길이만)
      vercelEnv: process.env.VERCEL_ENV || "unknown",
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "unknown",
      branch: process.env.VERCEL_GIT_COMMIT_REF || "unknown",
    });
  }

  // 토큰 불일치·누락은 404(존재 자체를 숨김) + 어떤 데이터도 싣지 않음
  if (!expected || token !== expected) {
    res.setHeader("Cache-Control", "no-store");
    // 본문엔 데이터를 싣지 않되, 원인 구분은 헤더로만(설정 누락 vs 값 불일치)
    res.setHeader("X-Share-View", expected ? "denied" : "unconfigured");
    return res.status(404).send("Not found");
  }

  const today = todayStr();
  const range = resolvePeriod("2w", today, {}); // 최근 14일
  const pkg = buildAnalysisPackage(sampleState(today), range, today); // 코치 요약본(기본)

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Body Plan 공유 뷰</title>
</head>
<body>
<p>Body Plan 공유 뷰 · Phase 1 테스트(가상 데이터) · 생성: ${esc(today)}</p>
<pre>${esc(pkg)}</pre>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.status(200).send(html);
}
