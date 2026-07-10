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

// Firebase ID 토큰 검증 — uid 사칭(타인 구독 덮어쓰기·주간 성적표 가로채기) 차단.
// Admin SDK 없이 Google identitytoolkit(accounts:lookup)으로 서명·만료를 검증한다.
// API 키는 클라이언트 번들에 이미 공개된 웹 키(비밀 아님) — env로 교체 가능.
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyDnY73MnZviHLP1W-hE7fsamOqL35lpyRc";

async function verifyUid(idToken, uid) {
  if (!idToken || typeof idToken !== "string") return false;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    return data?.users?.[0]?.localId === uid;
  } catch (e) {
    console.error("[push-sync] token verify error:", e);
    return false;
  }
}

export default async function handler(req, res) {
  if (!checkOrigin(req, res)) return;
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await rateLimit(req, res, { key: "push-sync", max: 30, windowSec: 60 }))) return;

  if (!kvConfigured()) {
    console.error("[push-sync] KV not configured");
    return res.status(500).json({ error: "Not configured" });
  }

  const { uid, idToken, subscription, state, reminders, enabled } = req.body || {};
  if (!uid || typeof uid !== "string" || uid.length > 128) {
    return res.status(400).json({ error: "uid required" });
  }
  if (!(await verifyUid(idToken, uid))) {
    return res.status(401).json({ error: "auth required" });
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
