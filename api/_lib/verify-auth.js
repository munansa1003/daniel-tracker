// api/_lib/verify-auth.js — Firebase ID 토큰 검증 (Admin SDK 없이).
// Google identitytoolkit(accounts:lookup)으로 서명·만료를 검증해 uid 사칭을 차단한다.
// API 키는 클라이언트 번들에 이미 공개된 웹 키(비밀 아님) — env로 교체 가능.
//
// 이름이 둘인 이유: Firebase Functions는 env 이름의 `FIREBASE_` 접두사를 **예약어로 거부**한다
// (`firebase-tools` `lib/functions/env.js`의 RESERVED_PREFIXES) → 그 이름으로는 배포가 안 된다.
// 그래서 새 이름 `WEB_API_KEY`를 먼저 보되 옛 이름도 계속 읽는다. 병행 기간에 같은 코드가
// Vercel(옛 이름)과 Firebase(새 이름) 양쪽에서 돌아야 하기 때문이다. 둘 다 없으면 폴백 상수를
// 쓰므로 **미설정 상태에서도 정상 동작**한다(값이 비밀이 아니라서 가능한 일).
//
// 모듈 상수가 아니라 함수인 이유: 상수로 두면 import 시점의 env가 굳는다. Functions params를
// process.env로 옮기는 어댑터(params-bridge)는 첫 요청 때 도는 경우가 있어, 그때 이미 굳은
// 값은 갱신되지 않는다. 호출 시점에 읽으면 그 순서 문제가 아예 없다.
function webApiKey() {
  return process.env.WEB_API_KEY || process.env.FIREBASE_WEB_API_KEY || "AIzaSyDnY73MnZviHLP1W-hE7fsamOqL35lpyRc";
}

// 성공 시 uid 문자열, 실패 시 null
export async function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${webApiKey()}`, {
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
