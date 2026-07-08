// api/push-sync.js — 웹푸시 구독/상태 저장 (Vercel Serverless Function)
//
// 클라이언트가 "알림 켜기" 시 구독정보를, 이후 기록/체중/백업이 바뀔 때 상태를 올린다.
// 크론(cron-reminders)이 이 KV 데이터를 읽어 밤 8시에 조건 맞는 푸시를 보낸다.
//
// KV 키:
//   push:uids            (Set)  구독 중인 uid 목록
//   push:sub:{uid}       (Str)  PushSubscription JSON
//   push:state:{uid}     (Str)  { lastRecordDate, lastWeighDate, lastBackup, accountCreatedAt, reminders }

import { checkOrigin, rateLimit } from "./_lib/security.js";
import { kv, kvConfigured } from "./_lib/kv.js";

export default async function handler(req, res) {
  if (!checkOrigin(req, res)) return;
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await rateLimit(req, res, { key: "push-sync", max: 30, windowSec: 60 }))) return;

  if (!kvConfigured()) {
    console.error("[push-sync] KV not configured");
    return res.status(500).json({ error: "Not configured" });
  }

  const { uid, subscription, state, reminders, enabled } = req.body || {};
  if (!uid || typeof uid !== "string" || uid.length > 128) {
    return res.status(400).json({ error: "uid required" });
  }

  try {
    // 구독 해제
    if (enabled === false) {
      await kv("DEL", `push:sub:${uid}`);
      await kv("SREM", "push:uids", uid);
      return res.status(200).json({ ok: true, enabled: false });
    }

    // 구독정보(있으면) 저장 + uid 등록
    if (subscription && subscription.endpoint) {
      await kv("SET", `push:sub:${uid}`, JSON.stringify(subscription));
      await kv("SADD", "push:uids", uid);
    }

    // 상태 병합 저장 (크론이 조건 판단에 사용)
    const merged = {
      lastRecordDate: state?.lastRecordDate ?? null,
      lastWeighDate: state?.lastWeighDate ?? null,
      lastBackup: state?.lastBackup ?? null,
      accountCreatedAt: state?.accountCreatedAt ?? null,
      weekReport: state?.weekReport ?? null, // 지난 주 요약(월요일 성적표 푸시용)
      reminders: reminders || {},
    };
    await kv("SET", `push:state:${uid}`, JSON.stringify(merged));

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[push-sync]", e);
    return res.status(500).json({ error: "sync failed" });
  }
}
