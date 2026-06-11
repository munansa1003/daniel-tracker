import { useState } from "react";
import { periodOf } from "../utils.js";

/* ───── 식단 수정 폼 ───── */
export function EditMealForm({ meal, onSave, onCancel, onDelete }) {
  const [serving, setServing] = useState(String(meal.serving));
  const [hour, setHour] = useState(meal.hour || 0);
  const is = { width: "100%", padding: "10px 12px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };
  return (
    <div>
      <div style={{ background: "#252525", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>{meal.n}</div>
        <div style={{ color: "#707070", fontFamily: "monospace", fontSize: 12 }}>P{meal.p} · C{meal.c} · F{meal.f} · {meal.k}kcal (1회분)</div>
      </div>
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>수량 (서빙)</div>
      <input type="number" step="0.1" min="0.1" value={serving} onChange={e => setServing(e.target.value)} style={is} />
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>식사 시간</div>
      <select value={hour} onChange={e => setHour(parseInt(e.target.value))}
        style={{ ...is, fontFamily: "monospace" }}>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {periodOf(h).name}</option>
        ))}
      </select>
      {parseFloat(serving) > 0 && (
        <div style={{ background: "#252525", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: "monospace", color: "#8a8a8a" }}>
          합계: P{Math.round(meal.p * parseFloat(serving))} C{Math.round(meal.c * parseFloat(serving))} F{Math.round(meal.f * parseFloat(serving))} · {Math.round(meal.k * parseFloat(serving))}kcal
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDelete} style={{ padding: 12, background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 8, color: "#e05252", fontSize: 14, cursor: "pointer" }}>삭제</button>
        <button onClick={onCancel} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "none", borderRadius: 8, color: "#8a8a8a", fontSize: 14, cursor: "pointer" }}>취소</button>
        <button onClick={() => onSave({ serving: parseFloat(serving) || 1, hour })}
          style={{ flex: 1, padding: 12, background: "#4a8fc9", border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>저장</button>
      </div>
    </div>
  );
}
