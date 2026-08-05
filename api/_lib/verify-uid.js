// api/_lib/verify-uid.js — Firebase ID 토큰 검증 (Admin SDK 없이).
// push-sync.js의 검증과 같은 방식: Google identitytoolkit(accounts:lookup)으로
// 서명·만료를 확인하고 토큰의 uid가 주장된 uid와 일치하는지 본다.
// API 키는 클라이언트 번들에 이미 공개된 웹 키(비밀 아님) — env로 교체 가능.
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyDnY73MnZviHLP1W-hE7fsamOqL35lpyRc";

export async function verifyUid(idToken, uid) {
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
    console.error("[verify-uid] token verify error:", e);
    return false;
  }
}
