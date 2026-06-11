import { useState } from "react";
import { PROFILE_COLORS } from "../theme.jsx";

// 프로필 설정 (새 사용자 등록 + 비밀번호)
export function ProfileSetup({ onSave, onCancel, colorIdx }) {
  const [name, setName] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [targetFat, setTargetFat] = useState("15");
  const [password, setPassword] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const color = PROFILE_COLORS[(colorIdx || 0) % PROFILE_COLORS.length];

  const valid = name.trim() && parseFloat(height) > 0 && parseInt(age) > 0;
  const pwMatch = !password || password === pwConfirm;
  const is = { width: "100%", padding: "12px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#f5f5f0", fontSize: 15, boxSizing: "border-box", marginBottom: 10 };

  return (
    <div style={{ background: "#1e1e1e", borderRadius: 14, padding: 20 }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: color, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 500, color: "#fff" }}>
          {name ? name.charAt(0).toUpperCase() : "?"}
        </div>
        <div style={{ fontSize: 14, color: "#707070" }}>새 프로필 만들기</div>
      </div>

      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>이름 (아이디) *</div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="예: Daniel" style={is} />

      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>키 (cm) *</div>
      <input type="number" value={height} onChange={e => setHeight(e.target.value)} placeholder="예: 175" style={is} />

      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>나이 *</div>
      <input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="예: 35" style={is} />

      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>목표 체지방률 (%)</div>
      <input type="number" value={targetFat} onChange={e => setTargetFat(e.target.value)} placeholder="예: 15" style={is} />

      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>비밀번호 (선택 — 비워두면 비밀번호 없이 사용)</div>
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호" style={is} />
      {password && (
        <>
          <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>비밀번호 확인</div>
          <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="비밀번호 다시 입력"
            style={{ ...is, borderColor: pwConfirm && !pwMatch ? "#e05252" : "rgba(255,255,255,0.08)" }} />
          {pwConfirm && !pwMatch && <div style={{ fontSize: 12, color: "#e05252", marginBottom: 8 }}>비밀번호가 일치하지 않습니다</div>}
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 14, background: "#2a2a2a", border: "none", borderRadius: 16, color: "#8a8a8a", fontSize: 15, cursor: "pointer" }}>취소</button>
        <button disabled={!valid || !pwMatch} onClick={() => onSave({
          id: name.trim().toLowerCase().replace(/\s+/g, "_"),
          name: name.trim(),
          height: parseFloat(height),
          age: parseInt(age),
          targetFat: parseFloat(targetFat) || 15,
          password: password || null,
          color,
          createdAt: new Date().toISOString()
        })} style={{ flex: 1, padding: 14, background: valid && pwMatch ? "#d4af37" : "#2a2a2a", border: "none", borderRadius: 16, color: valid && pwMatch ? "#141414" : "#666", fontSize: 15, fontWeight: 500, cursor: valid && pwMatch ? "pointer" : "not-allowed" }}>시작하기</button>
      </div>
    </div>
  );
}
