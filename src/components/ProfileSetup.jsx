import { useState } from "react";
import { PROFILE_COLORS } from "../theme.jsx";

// 프로필 온보딩 (경로 B) — 첫 로그인 시 이름·키·나이·목표 체지방을 입력받아
// users/{uid}/data/profile 로 저장한다. 키·나이는 목표 계산(calcTargets)의 필수 입력이라
// 기본값(175/35) 하드코딩 대신 여기서 반드시 받는다. 비밀번호는 Firebase Auth가 대체해 제거.
export function ProfileSetup({ onSave, onCancel, defaultName, colorSeed }) {
  const [name, setName] = useState(defaultName || "");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [targetFat, setTargetFat] = useState("15");
  // uid 기반 결정적 색상 (프로필 목록이 없어져 순번 대신 시드 사용)
  const seed = String(colorSeed || "").split("").reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const color = PROFILE_COLORS[seed % PROFILE_COLORS.length];

  const valid = name.trim() && parseFloat(height) > 0 && parseInt(age) > 0;
  const is = { width: "100%", padding: "12px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#f5f5f0", fontSize: 15, boxSizing: "border-box", marginBottom: 10 };

  return (
    <div style={{ background: "#1e1e1e", borderRadius: 14, padding: 20 }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: color, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 500, color: "#fff" }}>
          {name ? name.charAt(0).toUpperCase() : "?"}
        </div>
        <div style={{ fontSize: 14, color: "#707070" }}>프로필 설정</div>
        <div style={{ fontSize: 11, color: "#4a4a4a", marginTop: 4 }}>키·나이는 목표 칼로리 계산에 사용돼요</div>
      </div>

      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>이름 *</div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="예: Daniel" style={is} />

      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>키 (cm) *</div>
      <input type="number" value={height} onChange={e => setHeight(e.target.value)} placeholder="예: 175" style={is} />

      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>나이 *</div>
      <input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="예: 35" style={is} />

      <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>목표 체지방률 (%)</div>
      <input type="number" value={targetFat} onChange={e => setTargetFat(e.target.value)} placeholder="예: 15" style={is} />

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {onCancel && <button onClick={onCancel} style={{ flex: 1, padding: 14, background: "#2a2a2a", border: "none", borderRadius: 16, color: "#8a8a8a", fontSize: 15, cursor: "pointer" }}>취소</button>}
        <button disabled={!valid} onClick={() => onSave({
          name: name.trim(),
          height: parseFloat(height),
          age: parseInt(age),
          targetFat: parseFloat(targetFat) || 15,
          color,
          createdAt: new Date().toISOString()
        })} style={{ flex: 1, padding: 14, background: valid ? "#d4af37" : "#2a2a2a", border: "none", borderRadius: 16, color: valid ? "#141414" : "#666", fontSize: 15, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}>시작하기</button>
      </div>
    </div>
  );
}
