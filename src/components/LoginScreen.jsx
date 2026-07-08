import { useState } from "react";
import { THEME } from "../theme.jsx";
import { APP_NAME } from "../data.js";

// 로그인 화면 (경로 B: Google 로그인) — 프로필 선택 방식을 대체.
// 인증·세션은 Firebase Auth가 전담하고, 이 컴포넌트는 버튼과 오류 표시만 담당한다.
// 이전 구현의 프로필 목록·PBKDF2 비밀번호·마스터키(/api/verify-master)는 Auth 도입으로 제거됨.

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function LoginScreen({ onGoogle, externalError }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleClick = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await onGoogle();
      // 성공 — watchAuth의 멤버십 판정이 끝나 화면이 전환(언마운트)될 때까지 busy 유지.
      // 여기서 풀면 느린 네트워크에서 "로그인이 안 됐다"로 오인하고 재시도하게 된다.
      // (리다이렉트 폴백이면 페이지 이탈이라 어차피 무관)
    } catch (e) {
      const code = e && e.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // 사용자가 취소 — 오류 아님
      } else if (code === "auth/network-request-failed") {
        setError("네트워크 오류 — 온라인 상태를 확인하세요");
      } else {
        setError("로그인에 실패했어요. 잠시 후 다시 시도해주세요.");
        console.error("login error:", e);
      }
      setBusy(false);
    }
  };

  const shownError = error || externalError;

  return (
    <div style={{ background: THEME.bg, color: THEME.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", padding: "140px 24px 60px", textAlign: "center" }}>
      <div className="dbp-fade">
        <div style={{ fontSize: 28, fontWeight: 500, marginBottom: 8, letterSpacing: "-0.5px" }}>{APP_NAME}</div>
        <div style={{ fontSize: 12, color: THEME.gold, opacity: 0.6, letterSpacing: "2px", textTransform: "uppercase", marginBottom: 56 }}>식단 · 운동 · 체성분</div>
      </div>
      <button onClick={handleClick} disabled={busy} className="dbp-btn dbp-fade-d1"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", maxWidth: 320, padding: "14px 20px", background: "#f5f5f0", border: "none", borderRadius: 14, color: "#141414", fontSize: 15, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1, boxShadow: THEME.shadow }}>
        <GoogleLogo />
        {busy ? "로그인 중..." : "Google로 계속하기"}
      </button>
      {shownError && <div style={{ fontSize: 12, color: "#e05252", marginTop: 14 }}>{shownError}</div>}
      <div className="dbp-fade-d2" style={{ fontSize: 11, color: THEME.sub, marginTop: 32, lineHeight: 1.7 }}>
        초대받은 사용자만 이용할 수 있어요.<br />로그인 후 초대 코드를 입력합니다.
      </div>
    </div>
  );
}
