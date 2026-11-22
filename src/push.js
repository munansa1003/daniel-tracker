// src/push.js — 웹푸시 구독/상태 동기화(클라이언트).
// "알림 켜기" → 브라우저 구독 생성 → /api/push-sync 로 저장.
// 이후 앱이 열리거나 기록/체중/백업이 바뀔 때 상태 + 현재 구독을 갱신 → 크론이 밤 8시에 조건 맞으면 푸시.
// 경로 B: 요청마다 Firebase ID 토큰을 동봉 — 서버가 uid 사칭(타인 구독 덮어쓰기)을 차단.
import { getCurrentUserId } from "./store.js";
import { getIdToken } from "./auth.js";

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
  const idToken = await getIdToken(); // 미로그인/오프라인이면 null → 서버가 401 (호출측은 조용히 허용)
  return fetch("/api/push-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, idToken }),
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

// 이미 구독돼 있으면 상태 + **구독 정보**를 갱신(조용히 실패 허용). 구독 없으면 아무것도 안 함.
//
// 구독 정보를 매번 함께 보내는 이유(2026-11 "밤 8시 푸시가 안 온다"):
// 크론은 푸시 서비스가 404/410을 주면 서버의 push:sub를 지운다. 그런데 예전엔 여기서 상태만
// 보내서, 한 번 지워진 구독은 **다시는 서버에 올라가지 않았다**. 화면의 "알림 켜짐 ✓"는
// 브라우저 권한만 보므로 계속 켜진 것처럼 보이고, 권한이 granted로 남아 "알림 켜기" 버튼도
// 다시 나오지 않는다 — 사용자가 스스로 복구할 길이 없는 침묵 실패였다.
// 브라우저가 구독을 새로 바꾼 경우(endpoint 교체)도 같은 경로로 서버가 옛 값을 들고 있게 된다.
// 앱이 열릴 때마다 현재 구독을 다시 올리면 둘 다 다음 실행에서 저절로 낫는다.
// 서버(push-sync)는 이미 subscription이 오면 SET + SADD 하므로 서버 변경은 없다(멱등).
export async function syncPushState({ state, reminders }) {
  if (!pushConfigured()) return;
  const uid = getCurrentUserId();
  if (!uid) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await post({ uid, subscription: sub.toJSON(), state, reminders });
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
