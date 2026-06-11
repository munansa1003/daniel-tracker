import { useState } from "react";

/* ───── 운동 추가 폼 ───── */
export function AddExForm({ initialName, onSave, onCancel, weight }) {
  const [n, setN] = useState(initialName || "");
  const [m, setM] = useState("");
  const [memo, setMemo] = useState("");
  const valid = n.trim() && parseFloat(m) > 0;
  const is = { width: "100%", padding: "10px 12px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };
  const presets = [{ label: "가벼움", v: 3.5 }, { label: "중간", v: 5 }, { label: "높음", v: 8 }, { label: "매우높음", v: 10 }];

  return (
    <div>
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>운동 이름 *</div>
      <input value={n} onChange={e => setN(e.target.value)} placeholder="예: 랫풀다운" style={is} />
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>MET 계수 *</div>
      <input type="number" step="0.1" value={m} onChange={e => setM(e.target.value)} placeholder="5.0" style={is} />
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {presets.map(pr => (
          <button key={pr.v} onClick={() => setM(String(pr.v))}
            style={{ padding: "4px 10px", fontSize: 11, background: parseFloat(m) === pr.v ? "#4a8fc9" : "#2a2a2a", color: parseFloat(m) === pr.v ? "#fff" : "#8a8a8a", border: "none", borderRadius: 20, cursor: "pointer" }}>{pr.label} ({pr.v})</button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>메모</div>
      <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="선택사항" style={is} />
      {valid && <div style={{ background: "#252525", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: "monospace", color: "#8a8a8a" }}>30분 시 약 {Math.round((parseFloat(m) * (weight || 77.5) * 30) / 60)}kcal 소모</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "none", borderRadius: 8, color: "#8a8a8a", fontSize: 14, cursor: "pointer" }}>취소</button>
        <button disabled={!valid} onClick={() => onSave({ n: n.trim(), m: parseFloat(m), memo: memo.trim() })}
          style={{ flex: 1, padding: 12, background: valid ? "#5a9e6f" : "#2a2a2a", border: "none", borderRadius: 8, color: valid ? "#fff" : "#666", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}>저장</button>
      </div>
    </div>
  );
}
