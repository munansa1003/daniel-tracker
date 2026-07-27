// api/_lib/verify-auth.js — Firebase ID 토큰 검증 (Admin SDK 없이).
// Google identitytoolkit(accounts:lookup)으로 서명·만료를 검증해 uid 사칭을 차단한다.
// API 키는 클라이언트 번들에 이미 공개된 웹 키(비밀 아님) — env로 교체 가능.
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyDnY73MnZviHLP1W-hE7fsamOqL35lpyRc";

// 성공 시 uid 문자열, 실패 시 null
export async function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.users?.[0]?.localId || null;
  } catch (e) {
    console.error("[verify-auth] token verify error:", e);
    return null;
  }
}
