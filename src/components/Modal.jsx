import { THEME } from "../theme.jsx";

export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} className="dbp-fade-in" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} />
      <div className="dbp-fade" style={{ position: "relative", width: "100%", maxWidth: 480, maxHeight: "85vh", background: THEME.card, borderRadius: "20px 20px 0 0", padding: "20px 20px 32px", overflowY: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.5)" }}>
        <div style={{ width: 36, height: 4, background: THEME.surface, borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 500, color: THEME.text }}>{title}</span>
          <button className="dbp-btn" onClick={onClose} style={{ background: THEME.surface, border: "none", borderRadius: 10, color: THEME.muted, width: 32, height: 32, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
