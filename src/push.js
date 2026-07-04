// src/push.js — 웹푸시 구독/상태 동기화(클라이언트).
// "알림 켜기" → 브라우저 구독 생성 → /api/push-sync 로 저장.
// 이후 기록/체중/백업 변화 시 상태만 갱신 → 크론이 밤 8시에 조건 맞으면 푸시.
import { getCurrentUserId } from "./store.js";

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// 백그라운드 푸시 가능 여부(권한과 무관, "이 브라우저 + VAPID 설정" 여부)
export function pushConfigured() {
  return typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    !!VAPID_PUBLIC;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function post(body) {
  return fetch("/api/push-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 구독 생성(권한 프롬프트 포함) + 서버 저장. 성공 시 true.
export async function enablePush({ state, reminders }) {
  if (!pushConfigured()) return false;
  const uid = getCurrentUserId();
  if (!uid) return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
  }
  const r = await post({ uid, subscription: sub.toJSON(), state, reminders });
  return r.ok;
}

// 이미 구독돼 있으면 상태만 갱신(조용히 실패 허용). 구독 없으면 아무것도 안 함.
export async function syncPushState({ state, reminders }) {
  if (!pushConfigured()) return;
  const uid = getCurrentUserId();
  if (!uid) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await post({ uid, state, reminders });
  } catch { /* 무시 */ }
}

// 구독 해제 + 서버에서 제거.
export async function disablePush() {
  const uid = getCurrentUserId();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch { /* 무시 */ }
  if (uid) { try { await post({ uid, enabled: false }); } catch { /* 무시 */ } }
}
