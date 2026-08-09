// api/cron-reminders.js — 매일 밤 8시(KST) 예약 푸시 (Vercel Cron)
//
// vercel.json의 crons가 "0 11 * * *"(=11:00 UTC=20:00 KST)에 이 엔드포인트를 호출.
// Vercel Cron은 CRON_SECRET 설정 시 Authorization: Bearer <secret> 헤더를 자동으로 붙인다.
//
// 동작: 구독 중인 각 uid의 상태를 읽어 pendingReminders로 조건 판단 →
//       해당하면 web-push로 1건 발송. 만료(404/410)된 구독은 정리.
//
// 필요한 env: CRON_SECRET, VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, KV_REST_API_*

import webpush from "web-push";
import { kv, kvConfigured } from "./_lib/kv.js";
import { rateLimit, safeEqual } from "./_lib/security.js";
import { pendingReminders, reminderPush, weeklyReportPush, importSilencePush, daysBetween, REMINDER_DEFAULTS } from "../src/reminders.js";

// 수신 로그(List)의 최신 항목에서 `at`만 꺼낸다. 로그가 없으면 null(= 그 경로를 쓴 적 없음).
async function lastImportAt(key) {
  try {
    const raw = (await kv("LRANGE", key, "0", "0")) || [];
    if (!raw.length) return null;
    const rec = JSON.parse(raw[0]);
    return (rec && rec.at) || null;
  } catch { return null; } // 관측용이라 실패해도 크론 본체를 막지 않는다
}

// 크론 실행 시점(UTC)을 KST 날짜 문자열(YYYY-MM-DD)로. 밤 8시 KST 기준 "오늘".
function todayKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  // 이 엔드포인트는 구독자 전원에게 푸시를 쏜다 — 인터넷에 그대로 노출된 URL이다.
  // 옛 조건은 `if (secret && ...)`라 **CRON_SECRET이 없으면 검문 자체를 건너뛰었다**:
  // env 하나가 빠지는 것만으로 아무나 호출해 푸시를 반복 발송할 수 있었다(감사 R-40).
  // 이제 없으면 통과가 아니라 정지다. 401(비밀값 불일치)과 503(설정 누락)을 구분해,
  // 밤 8시 푸시가 안 올 때 "env를 안 넣었다"를 로그에서 바로 읽을 수 있게 한다.
  //
  // ⚠️ 운영 주의: Vercel 환경변수에 CRON_SECRET이 없으면 예약 푸시가 **동작하지 않는다**.
  // (열어두는 쪽이 더 위험하므로 의도한 fail-closed. Vercel Cron은 이 변수가 설정돼 있으면
  //  Authorization: Bearer <secret>를 자동으로 붙인다 — 값만 넣으면 그대로 동작한다.)
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron-reminders] CRON_SECRET 미설정 — 예약 푸시를 실행하지 않는다. Vercel 환경변수에 CRON_SECRET을 추가할 것.");
    return res.status(503).json({ error: "CRON_SECRET not configured" });
  }
  // 비밀값 대조보다 rate limit이 **먼저**다 — 뒤에 두면 공격자가 시도 횟수를 공짜로 쓴다
  // (health-import·body-import에서 같은 순서 문제를 고쳤다 — 감사 R-39).
  if (!(await rateLimit(req, res, { key: "cron", max: 10, windowSec: 60 }))) return;
  if (!safeEqual(req.headers.authorization, `Bearer ${secret}`)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const pub = process.env.VITE_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || "mailto:munansa@gmail.com";
  if (!pub || !priv) return res.status(500).json({ error: "VAPID not configured" });
  if (!kvConfigured()) return res.status(500).json({ error: "KV not configured" });
  webpush.setVapidDetails(subj, pub, priv);

  const today = todayKST();
  let checked = 0, sent = 0, cleaned = 0;

  try {
    const uids = (await kv("SMEMBERS", "push:uids")) || [];
    for (const uid of uids) {
      checked++;
      const [subRaw, stRaw] = await Promise.all([
        kv("GET", `push:sub:${uid}`),
        kv("GET", `push:state:${uid}`),
      ]);
      if (!subRaw) { await kv("SREM", "push:uids", uid); continue; }

      const subscription = JSON.parse(subRaw);
      const st = stRaw ? JSON.parse(stRaw) : {};
      const accountMature = st.accountCreatedAt ? daysBetween(st.accountCreatedAt, today) >= 15 : false;
      const backupDaysAgo = st.lastBackup ? daysBetween(st.lastBackup, today) : 999;

      const pending = pendingReminders({
        reminders: st.reminders,
        recordedToday: st.lastRecordDate === today,
        lastWeighDate: st.lastWeighDate || null,
        todayStr: today,
        accountMature,
        backupDaysAgo,
      });
      // 상태 리마인더 1건 + (월요일이면) 주간 성적표 — 태그가 달라 둘 다 표시 가능
      const payloads = [];
      const daily = reminderPush(pending);
      if (daily) payloads.push(daily);
      const rmd = { ...REMINDER_DEFAULTS, ...(st.reminders || {}) };
      if (rmd.report) {
        const weekly = weeklyReportPush(st.weekReport || null, today);
        if (weekly) payloads.push(weekly);
      }
      // 자동 수신 침묵 — 앱이 올린 스냅샷이 아니라 **KV 수신 로그를 직접** 본다.
      // 그래야 앱을 며칠 안 열어도 "단축어가 죽었다"를 감지할 수 있다(감사 R-06).
      if (rmd.sync) {
        const [exAt, bdAt] = await Promise.all([
          lastImportAt(`import:log:${uid}`),
          lastImportAt(`import:body-log:${uid}`),
        ]);
        const silence = importSilencePush({ lastExerciseAt: exAt, lastBodyAt: bdAt, todayStr: today });
        if (silence) payloads.push(silence);
      }
      if (!payloads.length) continue;

      for (const payload of payloads) {
        try {
          await webpush.sendNotification(subscription, JSON.stringify(payload));
          sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await kv("DEL", `push:sub:${uid}`);
            await kv("SREM", "push:uids", uid);
            cleaned++;
            break; // 구독이 죽었으면 나머지도 보낼 수 없음
          } else {
            console.error("[cron-reminders] send fail", uid, err.statusCode);
          }
        }
      }
    }
    return res.status(200).json({ ok: true, today, checked, sent, cleaned });
  } catch (e) {
    console.error("[cron-reminders]", e);
    return res.status(500).json({ error: "cron failed" });
  }
}
