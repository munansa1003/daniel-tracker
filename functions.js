// functions.js — Firebase Cloud Functions v2 진입점 (Vercel `api/*.js`와 병행)
//
// ⚠️ 이 파일은 "배선"만 한다. 검문·파싱·저장 로직은 한 줄도 여기로 옮기지 않는다.
//    `api/*.js`의 `(req, res)` 핸들러는 시그니처·본문 그대로이며, Vercel 배포도 계속 그 파일을
//    쓴다. 그래야 병행 기간에 두 원점이 같은 코드를 돌고, 기존 테스트가 그대로 산다.
//
// 구조(01-firebase-plan §7 · DR-11 — 그룹 4개):
//   api           앱이 부르는 경로 전부. 방벽 = checkOrigin(동일 원점)
//   ingress       단축어가 부르는 수신 창구. 방벽 = X-Import-Token
//   exportView    공개 GET(AI 리더·주소창). 방벽 = 공유 토큰 + rateLimit
//   cronReminders 스케줄. 방벽 = IAM(스케줄러 SA에만 run.invoker) — HTTP 검문 없음
// 그룹 경계는 "인증 태세"다. 태세가 다른 것을 한 서비스에 합치면 한쪽 사고가 다른 쪽을 잡는다.
//
// 라우팅에서 지켜야 하는 두 가지:
//   1) **루트 마운트**만 쓴다(`app.all("/api/:name")` 식). `app.use("/api", …)`처럼 하위 경로에
//      마운트하면 Express가 `req.url`에서 마운트 접두사를 잘라내고, `export-view.js`의
//      경로형 토큰 파싱(`/^\/export\/view\/([^/?#]+)/`)이 조용히 실패한다 → AI 공유 링크 사망.
//   2) Vercel `vercel.json` rewrites의 **쿼리 치환 의미**를 라우터가 재현한다.
//      Firebase Hosting은 `/export/view/:t`의 `:t`를 쿼리로 바꿔 주지 않는다.
//
// 본문 파싱은 여기서 하지 않는다. functions-framework가 이미 JSON·text·urlencoded를 파싱하고,
// 그 밖의 Content-Type은 Buffer로 준다 — 핸들러의 기존 `typeof body === "string" ||
// Buffer.isBuffer(body)` 분기가 그대로 받는다. express.json()을 겹쳐 걸면 중복 파싱이 된다.
import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";

import { bridgeParams } from "./api/_lib/params-bridge.js";

import analyzeFood from "./api/analyze-food.js";
import analyzeExercise from "./api/analyze-exercise.js";
import analyzeBody from "./api/analyze-body.js";
import importInbox from "./api/import-inbox.js";
import pushSync from "./api/push-sync.js";
import shareCreate from "./api/share-create.js";
import shareRevoke from "./api/share-revoke.js";
import healthImport from "./api/health-import.js";
import bodyImport from "./api/body-import.js";
import exportViewHandler from "./api/export-view.js";
import { runReminders } from "./api/cron-reminders.js";

// ── 리전 (DR-2) ────────────────────────────────────────────────────────────
// 리터럴은 이 한 곳뿐이다. `firebase.json`의 rewrite `region` 값과 어긋나면 Hosting이 다른
// 리전(또는 us-central1)을 부르며 404/500이 난다 — 눈으로는 안 잡히는 종류라 단위 테스트가
// 두 값을 대조한다(`src/__tests__/firebase-config.test.js`).
export const FUNCTIONS_REGION = "asia-northeast3";

// ── 시크릿 (DR-7 a안: 개별 시크릿, 존재가 확실한 4개만 바인딩) ─────────────
// 값은 Secret Manager에만 있고 이 저장소·GitHub에는 없다. 바인딩하지 않은 이름
// (SHARE_TEST_TOKEN · INBODY_LOGIN_ID/PW — DR-6 봉인)은 값 부재 = 그 기능만 off다.
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const IMPORT_TOKEN = defineSecret("IMPORT_TOKEN");
const KV_REST_API_TOKEN = defineSecret("KV_REST_API_TOKEN");
const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");

// ── 비밀 아닌 설정값 ───────────────────────────────────────────────────────
// 전부 default를 준다. default가 없으면 배포 때 CLI가 값을 물어봐(비대화형 CI에서 실패한다).
// 값은 `.env.<project>`로 주입하며 그 파일은 **커밋하지 않는다**(공개 저장소 — uid·메일 노출).
// CI가 배포 직전에 GitHub Variables로 만든다(03 §6).
const PRODUCTION_ORIGIN = defineString("PRODUCTION_ORIGIN", { default: "https://daniel-tracker-cb781.web.app" });
const PREVIEW_ORIGIN_SUFFIX = defineString("PREVIEW_ORIGIN_SUFFIX", { default: "" });
const KV_REST_API_URL = defineString("KV_REST_API_URL", { default: "" });
const IMPORT_UID = defineString("IMPORT_UID", { default: "" });
const IMPORT_CUTOVER_DATE = defineString("IMPORT_CUTOVER_DATE", { default: "" });
const IMPORT_BODY_CUTOVER_DATE = defineString("IMPORT_BODY_CUTOVER_DATE", { default: "" });
const IMPORT_TZ_OFFSET = defineString("IMPORT_TZ_OFFSET", { default: "" });
const VAPID_SUBJECT = defineString("VAPID_SUBJECT", { default: "" });
const VITE_VAPID_PUBLIC_KEY = defineString("VITE_VAPID_PUBLIC_KEY", { default: "" });

// 그룹별로 "이 함수가 실제로 쓰는" param만 다리를 놓는다(최소 권한과 같은 정신).
// `api` 그룹이 IMPORT_TOKEN을 받는 이유(설계 문서 §2 표에는 없던 것 — 구현 중 발견):
// `import-inbox.js:255,259`가 설정 카드에 보낼 `enabled`·`bodyEnabled`를
// `IMPORT_TOKEN && IMPORT_UID && IMPORT_CUTOVER_DATE`로 계산한다. 그 핸들러는 `api` 그룹에 있고,
// 토큰을 `ingress`에만 바인딩하면 **자동 가져오기가 멀쩡히 동작하는데 카드가 항상 "꺼짐"**이라고
// 말한다. 사용자를 없는 고장으로 보내는 거짓말이라, 최소 권한을 한 칸 넓히는 쪽을 택했다.
// (`IMPORT_UID`·`IMPORT_CUTOVER_DATE`류는 `.env.<project>`라 코드베이스 전체에 이미 붙는다.)
const API_PARAMS = { PRODUCTION_ORIGIN, PREVIEW_ORIGIN_SUFFIX, KV_REST_API_URL, ANTHROPIC_API_KEY, KV_REST_API_TOKEN, IMPORT_TOKEN };
const INGRESS_PARAMS = { KV_REST_API_URL, IMPORT_UID, IMPORT_CUTOVER_DATE, IMPORT_BODY_CUTOVER_DATE, IMPORT_TZ_OFFSET, IMPORT_TOKEN, KV_REST_API_TOKEN };
const EXPORT_VIEW_PARAMS = { KV_REST_API_URL, KV_REST_API_TOKEN };
const CRON_PARAMS = { KV_REST_API_URL, VAPID_SUBJECT, VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, KV_REST_API_TOKEN };

// ── 공통 배선 헬퍼 ─────────────────────────────────────────────────────────

// 어느 그룹이 응답했는지 헤더로 남긴다. 겹치는 rewrite glob(`/api/health-import` vs `/api/**`)의
// 우선순위는 문서로 확인되지 않은 항목이라, 스모크가 "무엇이 응답했나"를 눈이 아니라 헤더로 본다.
function group(name, params) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Function-Group", name);
    bridgeParams(params, { key: name });
    next();
  });
  return app;
}

// `req.query`에 값을 얹는다 — Vercel rewrite의 `?t=:t`·`?diag=1` 치환과 같은 결과를 만든다.
// 직접 대입(`req.query.t = …`) 대신 **자체 속성으로 덮어쓰는** 이유: Express의 `query`는
// 프로토타입의 getter라 버전에 따라 접근할 때마다 새 객체를 돌려줄 수 있다(express 5의 알려진
// 차이). 자체 속성을 정의하면 어느 버전에서도 값이 남는다.
function injectQuery(req, extra) {
  const merged = { ...(req.query || {}), ...extra };
  try {
    Object.defineProperty(req, "query", { value: merged, writable: true, configurable: true, enumerable: true });
  } catch {
    Object.assign(req.query, extra); // 자체 속성 정의가 막히면 최선의 폴백
  }
  return req;
}

// ── 그룹 1: api — 앱이 부르는 경로 ─────────────────────────────────────────
// 키는 Vercel의 파일명(= URL 경로)과 1:1이다. 여기 없는 이름은 404이며,
// 그 404 자체가 "rewrite가 엉뚱한 그룹으로 갔다"를 알려 주는 신호다.
export const API_HANDLERS = {
  "analyze-food": analyzeFood,
  "analyze-exercise": analyzeExercise,
  "analyze-body": analyzeBody,
  "import-inbox": importInbox,
  "push-sync": pushSync,
  "share-create": shareCreate,
  "share-revoke": shareRevoke,
};

export const apiApp = group("api", API_PARAMS);
apiApp.all("/api/:name", (req, res) => {
  const handler = Object.prototype.hasOwnProperty.call(API_HANDLERS, req.params.name)
    ? API_HANDLERS[req.params.name]
    : null;
  if (!handler) return res.status(404).json({ error: "not-found", message: `unknown api route: ${req.params.name}` });
  return handler(req, res);
});
apiApp.all("*", (req, res) => res.status(404).json({ error: "not-found" }));

// ── 그룹 2: ingress — 단축어(HAE) 수신 창구 ────────────────────────────────
export const INGRESS_HANDLERS = {
  "health-import": healthImport,
  "body-import": bodyImport,
};

export const ingressApp = group("ingress", INGRESS_PARAMS);
ingressApp.all("/api/:name", (req, res) => {
  const handler = Object.prototype.hasOwnProperty.call(INGRESS_HANDLERS, req.params.name)
    ? INGRESS_HANDLERS[req.params.name]
    : null;
  if (!handler) return res.status(404).json({ error: "not-found", message: `unknown ingress route: ${req.params.name}` });
  return handler(req, res);
});
ingressApp.all("*", (req, res) => res.status(404).json({ error: "not-found" }));

// ── 그룹 3: exportView — 공개 GET (AI 리더·주소창) ─────────────────────────
// 세 경로 전부 같은 핸들러다. `vercel.json`이 하던 쿼리 치환만 여기서 재현한다.
export const exportViewApp = group("exportView", EXPORT_VIEW_PARAMS);
exportViewApp.all(["/export/view", "/export/view/:t", "/export/diag"], (req, res) => {
  if (req.params && req.params.t !== undefined && req.query?.t === undefined) {
    injectQuery(req, { t: req.params.t });          // `/export/view/:t` → `?t=:t`
  }
  // 후행 슬래시를 떼고 본다 — express는 `/export/diag/`도 이 라우트로 보내는데, 그때
  // `req.path`가 `/export/diag/`라 그냥 비교하면 diag 주입이 빠진다. 그러면 진단을 열려던
  // 사람에게 "링크를 찾을 수 없음" 404 공유 페이지가 나간다(원인을 찾기 가장 어려운 종류).
  if (req.path.replace(/\/+$/, "") === "/export/diag" && req.query?.diag === undefined) {
    injectQuery(req, { diag: "1" });                // `/export/diag` → `?diag=1`
  }
  return exportViewHandler(req, res);
});
exportViewApp.all("*", (req, res) => res.status(404).json({ error: "not-found" }));

// ── 배포 단위 ──────────────────────────────────────────────────────────────
// Hosting 경유 요청은 60초에서 잘리므로 timeoutSeconds를 그보다 크게 잡아도 의미가 없다.
// maxInstances는 비용 천장이다(인스턴스 수 × 시간). 1인~소수 사용 기준의 값.

export const api = onRequest(
  {
    region: FUNCTIONS_REGION,
    memory: "512MiB",          // 사진 base64 JSON 파싱(analyze-food)이 가장 큼
    timeoutSeconds: 60,
    maxInstances: 3,
    secrets: [ANTHROPIC_API_KEY, KV_REST_API_TOKEN, IMPORT_TOKEN],
  },
  apiApp
);

export const ingress = onRequest(
  {
    region: FUNCTIONS_REGION,
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 2,
    secrets: [IMPORT_TOKEN, KV_REST_API_TOKEN],
  },
  ingressApp
);

export const exportView = onRequest(
  {
    region: FUNCTIONS_REGION,
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 2,
    secrets: [KV_REST_API_TOKEN],
  },
  exportViewApp
);

// 크론 — Vercel의 `0 11 * * *`(UTC)와 같은 시각을 시간대로 명시해 적는다.
// v2 기본 시간대는 UTC이므로 timeZone을 빠뜨리면 새벽 5시에 알림이 간다.
// retryCount 0: 실패해도 재시도하지 않는다(재시도 = 같은 사람에게 푸시 두 번).
export const cronReminders = onSchedule(
  {
    schedule: "0 20 * * *",
    timeZone: "Asia/Seoul",
    region: FUNCTIONS_REGION,
    memory: "256MiB",
    timeoutSeconds: 120,
    retryCount: 0,
    secrets: [VAPID_PRIVATE_KEY, KV_REST_API_TOKEN],
  },
  async () => {
    bridgeParams(CRON_PARAMS, { key: "cronReminders" });
    const result = await runReminders();
    console.log("[cronReminders]", JSON.stringify(result));
  }
);
