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
import { pendingReminders, reminderPush, daysBetween } from "../src/reminders.js";

// 크론 실행 시점(UTC)을 KST 날짜 문자열(YYYY-MM-DD)로. 밤 8시 KST 기준 "오늘".
function todayKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
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
      const payload = reminderPush(pending);
      if (!payload) continue;

      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await kv("DEL", `push:sub:${uid}`);
          await kv("SREM", "push:uids", uid);
          cleaned++;
        } else {
          console.error("[cron-reminders] send fail", uid, err.statusCode);
        }
      }
    }
    return res.status(200).json({ ok: true, today, checked, sent, cleaned });
  } catch (e) {
    console.error("[cron-reminders]", e);
    return res.status(500).json({ error: "cron failed" });
  }
}
