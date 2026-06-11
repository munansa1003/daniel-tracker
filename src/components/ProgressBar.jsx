/* ───── 공통 컴포넌트 ───── */
export function ProgressBar({ value, max, color, label, unit = "g" }) {
  const over = value > max;
  const pct = Math.min((value / max) * 100, 100);
  const darkColor = color === "#5a9e6f" ? "#2a6a3f" : color === "#4a8fc9" ? "#1e3f66" : "#801818";
  const basePct = over ? (max / value) * 100 : pct;
  const overPct = over ? ((value - max) / value) * 100 : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span style={{ color: "#8a8a8a" }}>{label}</span>
        <span style={{ fontFamily: "monospace", color: over ? "#e05252" : "#f5f5f0" }}>
          {Math.round(value)}{unit} / {max}{unit}
          {over && <span style={{ color: "#e05252", marginLeft: 4 }}>(+{Math.round(value - max)})</span>}
        </span>
      </div>
      <div style={{ height: 8, background: "#2a2a2a", borderRadius: 4, overflow: "hidden", display: "flex" }}>
        <div style={{ width: over ? `${basePct}%` : `${pct}%`, height: "100%", background: color, transition: "width 0.4s" }} />
        {over && <div style={{ width: `${overPct}%`, height: "100%", background: darkColor, transition: "width 0.4s" }} />}
      </div>
    </div>
  );
}
