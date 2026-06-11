import { useState, useEffect } from "react";
import { COLORS } from "../data.js";

/* ───── 음식 추가 폼 ───── */
export function AddFoodForm({ initialName, onSave, onCancel }) {
  const [n, setN] = useState(initialName || "");
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [c, setC] = useState("");
  const [f, setF] = useState("");
  const [k, setK] = useState("");
  const [autoK, setAutoK] = useState(true);

  useEffect(() => {
    if (autoK) {
      const calc = (parseFloat(p) || 0) * 4 + (parseFloat(c) || 0) * 4 + (parseFloat(f) || 0) * 9;
      setK(calc > 0 ? String(Math.round(calc)) : "");
    }
  }, [p, c, f, autoK]);

  const valid = n.trim() && ((parseFloat(p) || 0) + (parseFloat(c) || 0) + (parseFloat(f) || 0) > 0);
  const is = { width: "100%", padding: "10px 12px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };

  return (
    <div>
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>음식 이름 *</div>
      <input value={n} onChange={e => setN(e.target.value)} placeholder="예: 닭볶음탕 1인분" style={is} />
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>단위 (1회분)</div>
      <input value={u} onChange={e => setU(e.target.value)} placeholder="예: 100g, 1그릇, 1개" style={is} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, color: COLORS.p, marginBottom: 4 }}>단백질(g)</div>
          <input type="number" value={p} onChange={e => setP(e.target.value)} placeholder="0" style={{ ...is, marginBottom: 0 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: COLORS.c, marginBottom: 4 }}>탄수(g)</div>
          <input type="number" value={c} onChange={e => setC(e.target.value)} placeholder="0" style={{ ...is, marginBottom: 0 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: COLORS.f, marginBottom: 4 }}>지방(g)</div>
          <input type="number" value={f} onChange={e => setF(e.target.value)} placeholder="0" style={{ ...is, marginBottom: 0 }} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
        <span>칼로리(kcal)</span>
        <label style={{ fontSize: 11, color: "#4a4a4a", display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={autoK} onChange={e => setAutoK(e.target.checked)} />자동계산
        </label>
      </div>
      <input type="number" value={k} onChange={e => { setAutoK(false); setK(e.target.value); }} style={{ ...is, color: autoK ? "#707070" : "#f5f5f0" }} disabled={autoK} />
      {valid && <div style={{ background: "#252525", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: "monospace", color: "#8a8a8a" }}>미리보기: {n} — P{p||0} C{c||0} F{f||0} · {k||0}kcal</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "none", borderRadius: 8, color: "#8a8a8a", fontSize: 14, cursor: "pointer" }}>취소</button>
        <button disabled={!valid} onClick={() => onSave({ n: n.trim(), u: u.trim() || "1회분", p: parseFloat(p) || 0, c: parseFloat(c) || 0, f: parseFloat(f) || 0, k: parseFloat(k) || 0 })}
          style={{ flex: 1, padding: 12, background: valid ? "#4a8fc9" : "#2a2a2a", border: "none", borderRadius: 8, color: valid ? "#fff" : "#666", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}>저장</button>
      </div>
    </div>
  );
}
