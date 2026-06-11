// Long Press 액션바 컴포넌트
export function LongPressActionBar({ onEdit, onDelete, onCancel, color = "#d4af37" }) {
  return (
    <div className="dbp-lp-bar" style={{ display: "flex", gap: 8, padding: "8px 12px", background: "#252525", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={onEdit} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", background: "rgba(74,143,201,0.12)", color: "#4a8fc9" }}>✎ 수정</button>
      <button onClick={onDelete} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", background: "rgba(224,82,82,0.12)", color: "#e05252" }}>✕ 삭제</button>
      <button onClick={onCancel} style={{ padding: "10px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", background: "#2a2a2a", color: "#8a8a8a" }}>취소</button>
    </div>
  );
}
