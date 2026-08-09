// api/body-import.js — 인바디 체성분 자동 수신 검문소 (Vercel Serverless Function).
//
// 운동 검문소(health-import.js)의 자매 함수 — 별도 파일 = 별도 서버리스 함수로 런타임 격리
// (체성분 파서 오류가 운동 수신을 인질로 잡지 않는다 — 실패 격리 원칙). 별도 단축어
// "Body Plan 체성분 전송"이 HAE '건강 지표 내보내기' JSON을 POST하는 수신 창구.
//
// 운동과 같은 것: 서버는 Firestore 자격증명 없음 — 합격 초안은 KV 사서함에 보관, 앱이
// pull 즉시 착지하고 ack(HDEL). X-Import-Token 인증(checkOrigin 미적용 — 단축어 경로),
// 본문 크기 가드, 문자열/버퍼 본문 직접 파싱, 사서함 기입 → seen SET NX 순서(유실 창 제거).
// 운동과 다른 것(도메인 규칙): insert-only가 아니라 day-keyed 최신 갱신(B2) — 단 사서함
// field는 `${date}|${sampleTs}` "불변" 키로 두고 갱신은 앱 병합 계층이 수행한다.
// 규칙 단일 출처: api/_lib/body-import-rules.js (B1~B9 주석 참조).
//
// 환경변수 3종(전부 있어야 활성 — 하나라도 없으면 503, 운동 게이트와 독립):
//   IMPORT_TOKEN             운동과 공용 (X-Import-Token 대조)
//   IMPORT_UID               운동과 공용 (사서함 귀속 대상)
//   IMPORT_BODY_CUTOVER_DATE 이 날짜(YYYY-MM-DD) 이전 측정 거부 — 과거 수동 기록과 이중 계상 차단.
//                            이 변수만 지우면 체성분 수신만 꺼진다(운동 무영향 롤백 스위치).
//
// KV 키 (운동 키와 완전 분리):
//   import:body-seen:{uid}:{date}|{sampleTs}  (Str)  접수 도장 — 같은 페이로드 재전송 멱등의 근거
//   import:body-inbox:{uid}                   (Hash) 사서함 — field=`${date}|${sampleTs}`, 앱이 병합 후 HDEL
//   import:body-log:{uid}                     (List) 최근 수신 요약 20건 — 첫 실전송 확인 3종의 판별 창구(§1.4)
import { rateLimit } from "./_lib/security.js";
import { kvConfigured } from "./_lib/kv.js";
import { MAX_BODY_BYTES, parseTzOffset, HAE_TZ_OFFSET_MIN_DEFAULT } from "./_lib/import-rules.js";
import { isHaeMetricsPayload, planBodyImport, buildBodyMessage } from "./_lib/body-import-rules.js";
import { storeBodyEntries, pushBodyLog } from "./_lib/body-inbox-store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const TOKEN = process.env.IMPORT_TOKEN;
  const UID = process.env.IMPORT_UID;
  const CUTOVER = process.env.IMPORT_BODY_CUTOVER_DATE;
  if (!TOKEN || !UID || !CUTOVER || !/^\d{4}-\d{2}-\d{2}$/.test(CUTOVER)) {
    return res.status(503).json({
      error: "disabled",
      message: "체성분 가져오기 비활성 — 서버 환경변수(IMPORT_TOKEN·IMPORT_UID·IMPORT_BODY_CUTOVER_DATE) 설정 필요",
    });
  }

  // ⚠️ rate limit이 토큰 대조보다 "먼저"(운동 검문소와 동일 — 2026-08 감사 R-39).
  // 순서가 바뀌면 토큰 불일치 요청이 카운터에 집계되지 않아 추측 시도에 상한이 없어진다.
  if (!(await rateLimit(req, res, { key: "body-import", max: 30, windowSec: 60 }))) return;

  if (req.headers["x-import-token"] !== TOKEN) {
    return res.status(401).json({ error: "unauthorized", message: "토큰 불일치" });
  }

  if (!kvConfigured()) {
    console.error("[body-import] KV not configured");
    return res.status(500).json({ error: "Not configured" });
  }

  const clen = parseInt(req.headers["content-length"] || "0", 10);
  const size = Number.isFinite(clen) && clen > 0 ? clen : JSON.stringify(req.body || {}).length;
  if (size > MAX_BODY_BYTES) {
    return res.status(400).json({ error: "bad-request", message: `본문 ${Math.round(MAX_BODY_BYTES / 1024)}KB 초과` });
  }

  // 단축어 '파일' 첨부(비JSON Content-Type) 대응 — 운동 검문소와 동일
  let body = req.body;
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    try { body = JSON.parse(String(body)); } catch {
      return res.status(400).json({ error: "bad-request", message: "본문 JSON 파싱 실패 — 본문이 JSON 텍스트인지 확인" });
    }
  }

  if (!isHaeMetricsPayload(body)) {
    // 운동 페이로드(workouts)가 잘못 오면 여기서 명확히 안내 — 단축어 조립 디버깅용
    return res.status(400).json({
      error: "bad-request",
      message: "지표(metrics) 페이로드가 아님 — HAE '건강 지표 내보내기'(JSON) 블록 확인. 운동 전송은 /api/health-import",
    });
  }

  const tz = parseTzOffset(process.env.IMPORT_TZ_OFFSET) ?? HAE_TZ_OFFSET_MIN_DEFAULT;
  const { entries, summary } = planBodyImport(body, { cutoverDate: CUTOVER, tzOffsetMin: tz });

  try {
    // 기입·로그는 공유 저장 계층(body-inbox-store.js) — 클라우드 직수신 pull과 동일 순서·동일 키
    const { accepted, ignored } = await storeBodyEntries(UID, entries);
    await pushBodyLog(UID, "hae", { accepted, ignored, summary });

    console.log(`[body-import] accepted=${accepted} ignored=${ignored} rejected=${summary.rejected} excluded=${summary.excluded} samplesToday=${summary.samplesToday}${summary.unmatchedNames.length ? ` unmatched=${summary.unmatchedNames.join(",")}` : ""}`);

    return res.status(200).json({
      accepted, ignored,
      rejected: summary.rejected, excluded: summary.excluded,
      samplesToday: summary.samplesToday,
      ...(summary.unmatchedNames.length > 0 ? { unmatchedNames: summary.unmatchedNames } : {}),
      message: buildBodyMessage({
        accepted, ignored,
        rejected: summary.rejected, excluded: summary.excluded,
        firstRejectReason: summary.firstRejectReason,
      }),
    });
  } catch (e) {
    console.error("[body-import] store error:", e);
    return res.status(500).json({ error: "store-failed", message: "저장소 오류 — 잠시 후 재시도" });
  }
}
