// src/shareLink.js — AI 공유 링크 클라이언트 헬퍼.
// 발급/폐기는 서버(api/share-*)가 하고, 여기서는 호출·표시 유틸만 담당한다.
// 순수 함수(TTL_CHOICES·remainingText·shareUrlOf)는 테스트로 보호.
import { getIdToken } from "./auth.js";

export const TTL_CHOICES = [
  { key: "1h", label: "1시간" },
  { key: "24h", label: "24시간" },
  { key: "7d", label: "7일" },
];

// 절대 URL — 공유 대상(클로드)이 열 수 있어야 하므로 origin 포함.
// 경로형(/export/view/<token>)을 쓴다: 일부 외부 리더가 쿼리스트링(?t=)을 유실하는
// 사례가 있어서다. 서버는 쿼리형도 계속 받는다(기존 발급 링크 호환).
export function shareUrlOf(token, origin) {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/export/view/${token}`;
}

// 남은 시간 표기 — 만료됐으면 null
export function remainingText(expiresAt, now = Date.now()) {
  const ms = (expiresAt || 0) - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간 남음`;
  if (h >= 1) return `${h}시간 ${m}분 남음`;
  return `${Math.max(1, m)}분 남음`;
}

export function isExpired(link, now = Date.now()) {
  return !link || !link.token || !link.expiresAt || link.expiresAt <= now;
}

// 발급 — 성공 시 { token, expiresAt }, 실패 시 throw(호출측이 사용자에게 안내)
// prevToken(지금 화면에 있는 링크)을 함께 보내 서버가 그 자리에서 폐기한다: 앱은 링크를
// 하나만 보여주므로 재발급하면 옛 링크도 죽는 것이 사용자가 읽는 의미다(감사 R-23).
export async function createShareLink(pkg, ttl, prevToken) {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("로그인이 필요해요");
  const res = await fetch("/api/share-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, pkg, ttl, ...(prevToken ? { prevToken } : {}) }),
  });
  if (!res.ok) {
    let msg = "링크를 만들지 못했어요";
    try {
      const e = await res.json();
      if (res.status === 413) msg = e.hint || "내용이 너무 커요 — 기간을 줄여주세요";
      else if (res.status === 401) msg = "로그인이 필요해요";
      else if (res.status === 500) msg = "서버 설정이 필요해요(KV 미구성)";
    } catch { /* 본문 없음 */ }
    throw new Error(msg);
  }
  const data = await res.json();
  return { token: data.token, expiresAt: data.expiresAt, createdAt: Date.now() };
}

// 폐기 — 만료·이미 삭제된 경우도 성공으로 취급(멱등)
export async function revokeShareLink(token) {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("로그인이 필요해요");
  const res = await fetch("/api/share-revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, token }),
  });
  if (!res.ok) throw new Error("링크를 폐기하지 못했어요");
  return true;
}
