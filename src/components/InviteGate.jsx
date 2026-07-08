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
      // permission-denied는 대부분 잘못된 코드지만, App Check(reCAPTCHA) 차단 환경에서도
      // 같은 코드가 떨어지므로 두 번째 안내를 함께 준다
      setError(r.error === "permission-denied"
        ? "유효하지 않은 초대 코드예요. 코드가 확실하다면 광고 차단 기능(reCAPTCHA 차단)을 꺼보세요."
        : "등록에 실패했어요 — 온라인 상태를 확인하세요");
    }
  };

  return (
    // 레이아웃은 로그인 화면(G+C 확정안)과 공통 모티프 — 좌상단 브랜드 도트, 좌측 정렬 헤딩 + 골드 룰
    <div style={{ background: THEME.bg, color: THEME.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", padding: "26px 24px 60px" }}>
      <div className="dbp-fade" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: THEME.gold }} />
        <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.5px" }}>{APP_NAME}</span>
      </div>
      <div className="dbp-fade" style={{ marginTop: 84, marginBottom: 24 }}>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.8px", lineHeight: 1.4 }}>초대 코드 입력</div>
        <div style={{ width: 34, height: 2, background: THEME.gold, opacity: 0.7, marginTop: 16 }} />
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
      <div onClick={busy ? undefined : onSignOut} style={{ fontSize: 12, color: THEME.muted, marginTop: 24, cursor: busy ? "default" : "pointer", textDecoration: "underline", opacity: busy ? 0.4 : 1, display: "inline-block" }}>
        다른 계정으로 로그인
      </div>
    </div>
  );
}
