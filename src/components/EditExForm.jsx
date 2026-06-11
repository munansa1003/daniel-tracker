import { useState } from "react";
import { periodOf } from "../utils.js";

/* ───── 운동 수정 폼 ───── */
export function EditExForm({ exercise, onSave, onCancel, onDelete, weight }) {
  const [duration, setDuration] = useState(String(exercise.duration));
  const [hour, setHour] = useState(exercise.hour || 0);
  const is = { width: "100%", padding: "10px 12px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };
  const estKcal = Math.round((exercise.m * (weight || 77.5) * (parseInt(duration) || 30)) / 60);
  return (
    <div>
      <div style={{ background: "#252525", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>{exercise.n}</div>
        <div style={{ color: "#707070", fontSize: 12 }}>MET {exercise.m}</div>
      </div>
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>운동 시간 (분)</div>
      <input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)} style={is} />
      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>시간대</div>
      <select value={hour} onChange={e => setHour(parseInt(e.target.value))}
        style={{ ...is, fontFamily: "monospace" }}>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {periodOf(h).name}</option>
        ))}
      </select>
      <div style={{ background: "#252525", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: "monospace", color: "#8a8a8a" }}>
        예상 소모: -{estKcal} kcal
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDelete} style={{ padding: 12, background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 8, color: "#e05252", fontSize: 14, cursor: "pointer" }}>삭제</button>
        <button onClick={onCancel} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "none", borderRadius: 8, color: "#8a8a8a", fontSize: 14, cursor: "pointer" }}>취소</button>
        <button onClick={() => onSave({ duration: parseInt(duration) || 30, hour })}
          style={{ flex: 1, padding: 12, background: "#5a9e6f", border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>저장</button>
      </div>
    </div>
  );
}
