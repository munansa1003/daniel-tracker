import { useState } from "react";
import { THEME } from "../theme.jsx";
import { APP_NAME } from "../data.js";

// 초대 코드 게이트 — 로그인은 됐지만 아직 멤버가 아닌 계정 (경로 B: 공개 가입 차단).
// 코드 유효성은 클라이언트가 아니라 Firestore 보안 규칙이 검증한다(invites/{code}.active).
export function InviteGate({ email, onSubmit, onSignOut }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true); setError("");
    const r = await onSubmit(c);
    setBusy(false);
    if (!r.ok) {
      setError(r.error === "permission-denied"
        ? "유효하지 않은 초대 코드예요"
        : "등록에 실패했어요 — 온라인 상태를 확인하세요");
    }
  };

  return (
    <div style={{ background: THEME.bg, color: THEME.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", padding: "120px 24px 60px", textAlign: "center" }}>
      <div className="dbp-fade">
        <div style={{ fontSize: 24, fontWeight: 500, marginBottom: 8, letterSpacing: "-0.5px" }}>{APP_NAME}</div>
        <div style={{ fontSize: 12, color: THEME.gold, opacity: 0.6, letterSpacing: "2px", textTransform: "uppercase", marginBottom: 40 }}>초대 코드 입력</div>
      </div>
      <div className="dbp-fade-d1" style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, padding: 20, boxShadow: THEME.shadow, textAlign: "left" }}>
        <div style={{ fontSize: 12, color: THEME.sub, marginBottom: 14, lineHeight: 1.6 }}>
          <span style={{ color: THEME.text }}>{email || "로그인된 계정"}</span>(으)로 로그인됐어요.<br />
          이 앱은 초대받은 사용자만 이용할 수 있어요. 전달받은 초대 코드를 입력해주세요.
        </div>
        <input value={code} onChange={e => { setCode(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="초대 코드"
          autoFocus
          style={{ width: "100%", padding: 12, background: THEME.inner, border: `1px solid ${error ? "#e05252" : THEME.borderLight}`, borderRadius: 8, color: THEME.text, fontSize: 15, boxSizing: "border-box", marginBottom: 6 }} />
        {error && <div style={{ fontSize: 12, color: "#e05252", marginBottom: 8 }}>{error}</div>}
        <button onClick={submit} disabled={busy || !code.trim()} className="dbp-btn"
          style={{ width: "100%", padding: 13, marginTop: 8, background: code.trim() ? THEME.gold : THEME.surface, border: "none", borderRadius: 12, color: code.trim() ? "#141414" : "#666", fontSize: 14, fontWeight: 600, cursor: busy || !code.trim() ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "확인 중..." : "등록하기"}
        </button>
      </div>
      <div onClick={onSignOut} style={{ fontSize: 12, color: THEME.muted, marginTop: 24, cursor: "pointer", textDecoration: "underline" }}>
        다른 계정으로 로그인
      </div>
    </div>
  );
}
