// api/health-import.js — 애플워치 운동 자동 수신 검문소 (Vercel Serverless Function).
//
// iOS 단축어가 운동 종료/저녁 백업/원탭 버튼(3중 자동화)으로 POST하는 수신 창구.
// 같은 운동이 여러 번 도착하는 것이 기본 동작이므로 insert-only로만 받는다:
// 한 번 접수된 운동(seen 키)은 영구히 다시 받지 않고(ignored), 절대 갱신하지 않는다.
//
// 서버는 Firestore 자격증명을 갖지 않는다(이 저장소의 의도된 보안 태세 — share-store.js 참조).
// 합격한 운동은 KV 사서함(import:inbox)에 넣어 두고, 앱이 열릴 때 가져가(import-inbox.js)
// 수동 입력과 동일한 클라이언트 경로로 day 문서에 병합한다. 일기장(day 문서) 쓰기 주체는
// 앱 하나로 유지 → 유효목표·판정·통계가 기존 단일 출처로 자동 반영된다.
//
// ⚠️ checkOrigin을 적용하지 않는다(의도적): 브라우저가 아니라 단축어가 Origin 헤더 없이
// POST하는 경로다. 대신 X-Import-Token(환경변수) + rate limit으로 통제한다.
//
// 환경변수 3종(전부 있어야 활성 — 하나라도 없으면 503으로 잠금, 실수 배포 방지):
//   IMPORT_TOKEN        X-Import-Token 헤더와 대조할 비밀값
//   IMPORT_UID          기록 주인의 Firebase uid (사서함 귀속 대상)
//   IMPORT_CUTOVER_DATE 이 날짜(YYYY-MM-DD) 이전에 시작된 운동은 거부 — 과거 수동 기록과 이중 계상 차단
//
// KV 키:
//   import:seen:{uid}:{dedupKey}   (Str)  접수 도장 — TTL 없음(영구). insert-only의 근거
//   import:inbox:{uid}             (Hash) 사서함 — field=dedupKey, value=항목 JSON. 앱이 병합 후 HDEL
//   import:log:{uid}               (List) 최근 수신 요약 20건 — 설정 카드 표시용
//
// 로그 위생(규칙 8): 본문 전문을 남기지 않는다 — 건수·출처·결과 요약과
// 미등록 유형명(화이트리스트 확장 검토용, 규칙 3)만 기록.
import { rateLimit } from "./_lib/security.js";
import { kv, kvConfigured } from "./_lib/kv.js";
import {
  MAX_BODY_BYTES, validateEnvelope, validateWorkoutSchema, planWorkout, buildMessage,
  isHaePayload, convertHae, parseTzOffset, HAE_TZ_OFFSET_MIN_DEFAULT,
} from "./_lib/import-rules.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // 미설정 = 비활성(503). 토큰뿐 아니라 uid·컷오버도 없으면 검문 기준 자체가 성립하지 않는다.
  const TOKEN = process.env.IMPORT_TOKEN;
  const UID = process.env.IMPORT_UID;
  const CUTOVER = process.env.IMPORT_CUTOVER_DATE;
  if (!TOKEN || !UID || !CUTOVER || !/^\d{4}-\d{2}-\d{2}$/.test(CUTOVER)) {
    return res.status(503).json({
      error: "disabled",
      message: "가져오기 비활성 — 서버 환경변수(IMPORT_TOKEN·IMPORT_UID·IMPORT_CUTOVER_DATE) 설정 필요",
    });
  }

  if (req.headers["x-import-token"] !== TOKEN) {
    return res.status(401).json({ error: "unauthorized", message: "토큰 불일치" });
  }

  if (!(await rateLimit(req, res, { key: "health-import", max: 30, windowSec: 60 }))) return;

  if (!kvConfigured()) {
    console.error("[health-import] KV not configured");
    return res.status(500).json({ error: "Not configured" });
  }

  // 본문 크기 상한 (정상 페이로드는 수 KB)
  const clen = parseInt(req.headers["content-length"] || "0", 10);
  const size = Number.isFinite(clen) && clen > 0 ? clen : JSON.stringify(req.body || {}).length;
  if (size > MAX_BODY_BYTES) {
    return res.status(400).json({ error: "bad-request", message: `본문 ${Math.round(MAX_BODY_BYTES / 1024)}KB 초과` });
  }

  // HAE 폴백(단축어에 '운동 찾기' 동작이 없는 기기): { data:{ workouts:[...] } } 페이로드를
  // 표준 봉투로 변환해, 이후의 검문 규칙·insert-only·dedup을 네이티브 경로와 동일하게 태운다.
  let body = req.body;
  let haeDropped = 0;
  if (isHaePayload(body)) {
    const tz = parseTzOffset(process.env.IMPORT_TZ_OFFSET) ?? HAE_TZ_OFFSET_MIN_DEFAULT;
    const conv = convertHae(body, tz);
    haeDropped = conv.dropped;
    if (conv.workouts.length === 0) {
      // 주기 동기화에서 '새 운동 없음'은 정상 — 400이 아니라 0건 응답(HAE가 에러로 표시하지 않게)
      console.log(`[health-import] format=hae accepted=0 ignored=0 filtered=0 rejected=${haeDropped} (workouts empty)`);
      return res.status(200).json({
        accepted: 0, ignored: 0, filtered: 0, rejected: haeDropped,
        message: buildMessage({ accepted: 0, ignored: 0, strength: 0, unknown: 0, rejected: haeDropped, firstRejectReason: haeDropped ? "HAE 항목 형식 오류" : "" }),
      });
    }
    body = { source: "hae", sentAt: new Date().toISOString(), workouts: conv.workouts };
  }

  // 규칙 1: 스키마 엄격 검증 — 봉투/필드 형식 오류는 400 (단축어 조립 디버깅용 메시지 포함)
  const envErr = validateEnvelope(body);
  if (envErr) return res.status(400).json({ error: "bad-request", message: envErr });
  for (let i = 0; i < body.workouts.length; i++) {
    const schemaErr = validateWorkoutSchema(body.workouts[i], i);
    if (schemaErr) return res.status(400).json({ error: "bad-request", message: schemaErr });
  }

  // 운동 단위 판정 (부분 성공 허용)
  let accepted = 0, ignored = 0, strength = 0, unknown = 0, rejected = 0;
  let firstRejectReason = "";
  const unknownTypes = [];
  const inboxKey = `import:inbox:${UID}`;

  try {
    for (const w of body.workouts) {
      const plan = planWorkout(w, { cutoverDate: CUTOVER });
      if (plan.verdict === "filtered") {
        if (plan.cause === "strength") strength++;
        else { unknown++; if (unknownTypes.length < 10) unknownTypes.push(String(plan.type).slice(0, 40)); }
        continue;
      }
      if (plan.verdict === "rejected") {
        rejected++;
        if (!firstRejectReason) firstRejectReason = plan.reason;
        continue;
      }

      // 규칙 4·5: insert-only + 동시 도착 원자성.
      // 순서가 중요 — ① seen 조회(평시 중복 차단) ② 사서함 기입(같은 field라 멱등)
      // ③ seen을 SET NX(원자)로 도장: race의 승자 1명만 accepted. 사서함 기입을 도장보다
      // 먼저 해 "도장은 찍혔는데 사서함에 없음"(영구 유실) 창을 없앤다 — 실패 시 재전송이 복구.
      const seenKey = `import:seen:${UID}:${plan.entry.importKey}`;
      const already = await kv("GET", seenKey);
      if (already) { ignored++; continue; }
      await kv("HSET", inboxKey, plan.entry.importKey, JSON.stringify({ ...plan.entry, source: body.source, receivedAt: new Date().toISOString() }));
      const nx = await kv("SET", seenKey, new Date().toISOString(), "NX");
      if (nx === null) { ignored++; continue; } // 동시 도착 race 패자 — 사서함 field는 동일 내용 1개
      accepted++;
    }

    rejected += haeDropped; // HAE 변환 단계에서 형식이 깨져 떨어진 항목도 거부로 집계
    if (haeDropped > 0 && !firstRejectReason) firstRejectReason = "HAE 항목 형식 오류";

    // 관측성: 최근 수신 요약(설정 카드용) — 본문 전문 없음
    const filtered = strength + unknown;
    try {
      await kv("LPUSH", `import:log:${UID}`, JSON.stringify({
        at: new Date().toISOString(), source: body.source, accepted, ignored, filtered, rejected,
      }));
      await kv("LTRIM", `import:log:${UID}`, "0", "19");
    } catch (e) { console.error("[health-import] log write failed:", e); }

    console.log(`[health-import] source=${body.source} accepted=${accepted} ignored=${ignored} filtered=${filtered} rejected=${rejected}${unknownTypes.length ? ` unknownTypes=${unknownTypes.join(",")}` : ""}`);

    return res.status(200).json({
      accepted, ignored, filtered, rejected,
      message: buildMessage({ accepted, ignored, strength, unknown, rejected, firstRejectReason }),
    });
  } catch (e) {
    console.error("[health-import] store error:", e);
    return res.status(500).json({ error: "store-failed", message: "저장소 오류 — 잠시 후 재시도" });
  }
}
