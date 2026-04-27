import { useState, useEffect, useCallback, useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar, ComposedChart, Legend } from "recharts";
import store, { getCurrentUserId, setUserId, logout, getProfiles, saveProfiles } from "./store.js";
import { DEFAULT_FOODS, DEFAULT_EX, TARGETS as DEFAULT_TARGETS, COLORS } from "./data.js";

const today = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const nowHour = () => new Date().getHours();

// 체중 기반 목표 단탄지 계산 (Mifflin-St Jeor, 활동계수 1.55, 20% 적자)
function calcTargets(weight, height = 175, age = 35) {
  const bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  const tdee = bmr * 1.55;
  const k = Math.round(tdee * 0.80);
  const p = Math.round(weight * 2.2);
  const f = Math.round(weight * 0.8);
  const c = Math.round((k - p * 4 - f * 9) / 4);
  return { p, c, f, k, weight: Math.round(weight * 10) / 10 };
}

// 배열을 시간순으로 정렬
function sortByHour(arr) {
  return [...arr].sort((a, b) => (a.hour || 0) - (b.hour || 0));
}

// 시간대별 식단 그룹핑
function groupMealsByTime(meals) {
  const groups = [
    { label: "🌅 아침", key: "morning", min: 6, max: 10, meals: [] },
    { label: "🌞 점심", key: "lunch", min: 11, max: 14, meals: [] },
    { label: "🌙 저녁", key: "dinner", min: 15, max: 20, meals: [] },
    { label: "🌃 야식", key: "night", min: 21, max: 5, meals: [] }
  ];
  meals.forEach((m, idx) => {
    const h = m.hour || 0;
    if (h >= 6 && h <= 10) groups[0].meals.push({ ...m, _idx: idx });
    else if (h >= 11 && h <= 14) groups[1].meals.push({ ...m, _idx: idx });
    else if (h >= 15 && h <= 20) groups[2].meals.push({ ...m, _idx: idx });
    else groups[3].meals.push({ ...m, _idx: idx });
  });
  return groups.filter(g => g.meals.length > 0);
}

// Net 칼로리 카드 (신호등 스타일)
function NetCalCard({ intake, exercise }) {
  const net = Math.round(intake - exercise);
  let status, color, emoji;
  if (net < 1500) { status = "위험"; color = "#e05252"; emoji = "🔴"; }
  else if (net < 1800) { status = "주의"; color = "#d4943a"; emoji = "🟡"; }
  else if (net <= 2100) { status = "적정"; color = "#5a9e6f"; emoji = "🟢"; }
  else { status = "초과"; color = "#d4943a"; emoji = "🟡"; }

  const zones = [
    { l: "위험", r: "~1,500", c: "#e05252", bg: "rgba(224,82,82,0.1)", active: net < 1500 },
    { l: "주의", r: "1,500~1,800", c: "#d4943a", bg: "rgba(212,148,58,0.1)", active: net >= 1500 && net < 1800 },
    { l: "적정", r: "1,800~2,100", c: "#5a9e6f", bg: "rgba(90,158,111,0.1)", active: net >= 1800 && net <= 2100 },
    { l: "초과", r: "2,100~", c: "#d4943a", bg: "rgba(212,148,58,0.1)", active: net > 2100 }
  ];

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ background: `${color}11`, border: `1px solid ${color}33`, borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "#787570", marginBottom: 2 }}>Net 칼로리</div>
            <div style={{ fontSize: 22, fontWeight: 500, fontFamily: "monospace", color }}>
              {net.toLocaleString()} <span style={{ fontSize: 12, color: "#787570" }}>kcal</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20 }}>{emoji}</div>
            <div style={{ fontSize: 11, color }}>{status}</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#787570", lineHeight: 1.5 }}>
          섭취 {Math.round(intake).toLocaleString()} - 운동 {Math.round(exercise).toLocaleString()} = <span style={{ color: "#e8e4dc" }}>Net {net.toLocaleString()}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {zones.map((z, i) => (
          <div key={i} style={{ flex: 1, background: z.bg, borderRadius: 8, padding: "6px 4px", textAlign: "center", border: z.active ? `1px solid ${z.c}55` : "1px solid transparent" }}>
            <div style={{ fontSize: 10, color: z.c, marginBottom: 2 }}>{z.l}</div>
            <div style={{ fontSize: 10, fontFamily: "monospace", color: z.c }}>{z.r}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───── 공통 컴포넌트 ───── */
function ProgressBar({ value, max, color, label, unit = "g" }) {
  const over = value > max;
  const pct = Math.min((value / max) * 100, 100);
  const darkColor = color === "#5a9e6f" ? "#2a6a3f" : color === "#4a8fc9" ? "#1e3f66" : "#801818";
  const basePct = over ? (max / value) * 100 : pct;
  const overPct = over ? ((value - max) / value) * 100 : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span style={{ color: "#aaa" }}>{label}</span>
        <span style={{ fontFamily: "monospace", color: over ? "#e05252" : "#e8e4dc" }}>
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

function MiniDonut({ value, max, color, size = 72 }) {
  const over = value > max;
  const darkColor = color === "#4a8fc9" ? "#1e3f66" : color === "#d4943a" ? "#7a4a10" : "#801818";
  let data, colors;
  if (!over) {
    const pct = Math.min(value / max, 1);
    data = [{ v: pct }, { v: 1 - pct }];
    colors = [color, "#2a2a2a"];
  } else {
    const overPct = (value - max) / value;
    const basePct = max / value;
    data = [{ v: overPct }, { v: basePct }];
    colors = [darkColor, color];
  }
  return (
    <div style={{ width: size, height: size }}>
      <ResponsiveContainer><PieChart><Pie data={data} dataKey="v" innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none">{data.map((_, i) => <Cell key={i} fill={colors[i]} />)}</Pie></PieChart></ResponsiveContainer>
    </div>
  );
}

// 프로필 색상 팔레트
const PROFILE_COLORS = ["#4a8fc9", "#d4943a", "#5a9e6f", "#9b7dc9", "#e05252", "#d4c43a", "#4ac9a8", "#c94a7d"];

// 로그인 화면 (A안 - 프로필 선택형)
function LoginScreen({ onLogin }) {
  const [profiles, setProfiles] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pwModal, setPwModal] = useState(null); // 비밀번호 입력 대상 프로필
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [deleteIdx, setDeleteIdx] = useState(null); // 삭제 대상 인덱스
  const [adminPw, setAdminPw] = useState("");
  const [adminPwError, setAdminPwError] = useState(false);

  const ADMIN_PASSWORD = "1234"; // ★ 관리자 비밀번호 — 원하는 값으로 변경하세요

  useEffect(() => {
    getProfiles().then(p => { setProfiles(p); setLoading(false); });
  }, []);

  const handleCreate = async (profile) => {
    const newProfiles = [...profiles, profile];
    setProfiles(newProfiles);
    await saveProfiles(newProfiles);
    setShowNew(false);
    onLogin(profile);
  };

  const handleDeleteRequest = (idx, e) => {
    e.stopPropagation();
    setDeleteIdx(idx);
    setAdminPw("");
    setAdminPwError(false);
  };

  const handleDeleteConfirm = async () => {
    if (adminPw !== ADMIN_PASSWORD) {
      setAdminPwError(true);
      return;
    }
    const newProfiles = profiles.filter((_, i) => i !== deleteIdx);
    setProfiles(newProfiles);
    await saveProfiles(newProfiles);
    setDeleteIdx(null);
  };

  const handleProfileClick = (profile) => {
    if (profile.password) {
      setPwModal(profile);
      setPw("");
      setPwError(false);
    } else {
      onLogin(profile);
    }
  };

  const handlePwSubmit = () => {
    if (pw === pwModal.password) {
      setPwModal(null);
      onLogin(pwModal);
    } else {
      setPwError(true);
    }
  };

  if (loading) return <div style={{ background: "#0f0f0f", color: "#787570", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>로딩 중...</div>;

  return (
    <div style={{ background: "#0f0f0f", color: "#e8e4dc", minHeight: "100vh", maxWidth: 480, margin: "0 auto", padding: "60px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 6 }}>Daniel Body Plan</div>
        <div style={{ fontSize: 13, color: "#787570" }}>사용자를 선택하세요</div>
      </div>

      {showNew ? (
        <ProfileSetup onSave={handleCreate} onCancel={() => setShowNew(false)} colorIdx={profiles.length} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {profiles.map((p, i) => (
              <div key={i} onClick={() => handleProfileClick(p)}
                style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "18px 10px", textAlign: "center", cursor: "pointer", position: "relative" }}>
                <button onClick={(e) => handleDeleteRequest(i, e)}
                  style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", color: "#555", fontSize: 14, cursor: "pointer" }}>✕</button>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: p.color || PROFILE_COLORS[i % PROFILE_COLORS.length], margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 500, color: "#fff" }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#787570", marginTop: 4 }}>목표 체지방 {p.targetFat}%</div>
                {p.password && <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>🔒</div>}
              </div>
            ))}

            <div onClick={() => setShowNew(true)}
              style={{ background: "#191919", border: "1px dashed rgba(255,255,255,0.15)", borderRadius: 14, padding: "18px 10px", textAlign: "center", cursor: "pointer" }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#333", margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "#787570" }}>+</div>
              <div style={{ fontSize: 15, color: "#787570" }}>새 사용자</div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>추가하기</div>
            </div>
          </div>
        </>
      )}

      {/* 비밀번호 입력 모달 */}
      {pwModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={() => setPwModal(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
          <div style={{ position: "relative", width: "90%", maxWidth: 340, background: "#191919", borderRadius: 16, padding: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: pwModal.color || "#4a8fc9", margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 500, color: "#fff" }}>
                {pwModal.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{pwModal.name}</div>
            </div>
            <div style={{ fontSize: 12, color: "#787570", marginBottom: 6 }}>비밀번호</div>
            <input type="password" value={pw} onChange={e => { setPw(e.target.value); setPwError(false); }}
              onKeyDown={e => e.key === "Enter" && handlePwSubmit()}
              placeholder="비밀번호를 입력하세요"
              autoFocus
              style={{ width: "100%", padding: 12, background: "#222", border: `1px solid ${pwError ? "#e05252" : "rgba(255,255,255,0.12)"}`, borderRadius: 8, color: "#e8e4dc", fontSize: 15, boxSizing: "border-box", marginBottom: 6 }} />
            {pwError && <div style={{ fontSize: 12, color: "#e05252", marginBottom: 8 }}>비밀번호가 틀렸습니다</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setPwModal(null)} style={{ flex: 1, padding: 12, background: "#333", border: "none", borderRadius: 10, color: "#aaa", fontSize: 14, cursor: "pointer" }}>취소</button>
              <button onClick={handlePwSubmit} style={{ flex: 1, padding: 12, background: "#4a8fc9", border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>로그인</button>
            </div>
          </div>
        </div>
      )}

      {/* 관리자 비밀번호 삭제 모달 */}
      {deleteIdx !== null && profiles[deleteIdx] && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={() => setDeleteIdx(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
          <div style={{ position: "relative", width: "90%", maxWidth: 340, background: "#191919", borderRadius: 16, padding: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: "#e05252" }}>프로필 삭제</div>
              <div style={{ fontSize: 13, color: "#787570", marginTop: 6 }}>"{profiles[deleteIdx].name}"을(를) 삭제하려면<br/>관리자 비밀번호를 입력하세요</div>
            </div>
            <input type="password" value={adminPw} onChange={e => { setAdminPw(e.target.value); setAdminPwError(false); }}
              onKeyDown={e => e.key === "Enter" && handleDeleteConfirm()}
              placeholder="관리자 비밀번호"
              autoFocus
              style={{ width: "100%", padding: 12, background: "#222", border: `1px solid ${adminPwError ? "#e05252" : "rgba(255,255,255,0.12)"}`, borderRadius: 8, color: "#e8e4dc", fontSize: 15, boxSizing: "border-box", marginBottom: 6 }} />
            {adminPwError && <div style={{ fontSize: 12, color: "#e05252", marginBottom: 8 }}>관리자 비밀번호가 틀렸습니다</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setDeleteIdx(null)} style={{ flex: 1, padding: 12, background: "#333", border: "none", borderRadius: 10, color: "#aaa", fontSize: 14, cursor: "pointer" }}>취소</button>
              <button onClick={handleDeleteConfirm} style={{ flex: 1, padding: 12, background: "#e05252", border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} (새 사용자 등록 + 비밀번호)
// 프로필 설정 (새 사용자 등록 + 비밀번호)
function ProfileSetup({ onSave, onCancel, colorIdx }) {
  const [name, setName] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [targetFat, setTargetFat] = useState("15");
  const [password, setPassword] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const color = PROFILE_COLORS[(colorIdx || 0) % PROFILE_COLORS.length];

  const valid = name.trim() && parseFloat(height) > 0 && parseInt(age) > 0;
  const pwMatch = !password || password === pwConfirm;
  const is = { width: "100%", padding: "12px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#e8e4dc", fontSize: 15, boxSizing: "border-box", marginBottom: 10 };

  return (
    <div style={{ background: "#191919", borderRadius: 14, padding: 20 }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: color, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 500, color: "#fff" }}>
          {name ? name.charAt(0).toUpperCase() : "?"}
        </div>
        <div style={{ fontSize: 14, color: "#787570" }}>새 프로필 만들기</div>
      </div>

      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>이름 (아이디) *</div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="예: Daniel" style={is} />

      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>키 (cm) *</div>
      <input type="number" value={height} onChange={e => setHeight(e.target.value)} placeholder="예: 175" style={is} />

      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>나이 *</div>
      <input type="number" value={age} onChange={e => setAge(e.target.value)} placeholder="예: 35" style={is} />

      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>목표 체지방률 (%)</div>
      <input type="number" value={targetFat} onChange={e => setTargetFat(e.target.value)} placeholder="예: 15" style={is} />

      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>비밀번호 (선택 — 비워두면 비밀번호 없이 사용)</div>
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호" style={is} />
      {password && (
        <>
          <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>비밀번호 확인</div>
          <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="비밀번호 다시 입력"
            style={{ ...is, borderColor: pwConfirm && !pwMatch ? "#e05252" : "rgba(255,255,255,0.12)" }} />
          {pwConfirm && !pwMatch && <div style={{ fontSize: 12, color: "#e05252", marginBottom: 8 }}>비밀번호가 일치하지 않습니다</div>}
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 14, background: "#333", border: "none", borderRadius: 10, color: "#aaa", fontSize: 15, cursor: "pointer" }}>취소</button>
        <button disabled={!valid || !pwMatch} onClick={() => onSave({
          id: name.trim().toLowerCase().replace(/\s+/g, "_"),
          name: name.trim(),
          height: parseFloat(height),
          age: parseInt(age),
          targetFat: parseFloat(targetFat) || 15,
          password: password || null,
          color,
          createdAt: new Date().toISOString()
        })} style={{ flex: 1, padding: 14, background: valid && pwMatch ? "#4a8fc9" : "#333", border: "none", borderRadius: 10, color: valid && pwMatch ? "#fff" : "#666", fontSize: 15, fontWeight: 600, cursor: valid && pwMatch ? "pointer" : "not-allowed" }}>시작하기</button>
      </div>
    </div>
  );
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
      <div style={{ position: "relative", width: "100%", maxWidth: 480, maxHeight: "85vh", background: "#191919", borderRadius: "16px 16px 0 0", padding: "20px 20px 32px", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#e8e4dc" }}>{title}</span>
          <button onClick={onClose} style={{ background: "#333", border: "none", borderRadius: 8, color: "#aaa", width: 32, height: 32, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ───── 음식 추가 폼 ───── */
function AddFoodForm({ initialName, onSave, onCancel }) {
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
  const is = { width: "100%", padding: "10px 12px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };

  return (
    <div>
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>음식 이름 *</div>
      <input value={n} onChange={e => setN(e.target.value)} placeholder="예: 닭볶음탕 1인분" style={is} />
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>단위 (1회분)</div>
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
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
        <span>칼로리(kcal)</span>
        <label style={{ fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={autoK} onChange={e => setAutoK(e.target.checked)} />자동계산
        </label>
      </div>
      <input type="number" value={k} onChange={e => { setAutoK(false); setK(e.target.value); }} style={{ ...is, color: autoK ? "#787570" : "#e8e4dc" }} disabled={autoK} />
      {valid && <div style={{ background: "#222", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: "monospace", color: "#aaa" }}>미리보기: {n} — P{p||0} C{c||0} F{f||0} · {k||0}kcal</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 12, background: "#333", border: "none", borderRadius: 8, color: "#aaa", fontSize: 14, cursor: "pointer" }}>취소</button>
        <button disabled={!valid} onClick={() => onSave({ n: n.trim(), u: u.trim() || "1회분", p: parseFloat(p) || 0, c: parseFloat(c) || 0, f: parseFloat(f) || 0, k: parseFloat(k) || 0 })}
          style={{ flex: 1, padding: 12, background: valid ? "#4a8fc9" : "#333", border: "none", borderRadius: 8, color: valid ? "#fff" : "#666", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}>저장</button>
      </div>
    </div>
  );
}

/* ───── 운동 추가 폼 ───── */
function AddExForm({ initialName, onSave, onCancel }) {
  const [n, setN] = useState(initialName || "");
  const [m, setM] = useState("");
  const [memo, setMemo] = useState("");
  const valid = n.trim() && parseFloat(m) > 0;
  const is = { width: "100%", padding: "10px 12px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };
  const presets = [{ label: "가벼움", v: 3.5 }, { label: "중간", v: 5 }, { label: "높음", v: 8 }, { label: "매우높음", v: 10 }];

  return (
    <div>
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>운동 이름 *</div>
      <input value={n} onChange={e => setN(e.target.value)} placeholder="예: 랫풀다운" style={is} />
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>MET 계수 *</div>
      <input type="number" step="0.1" value={m} onChange={e => setM(e.target.value)} placeholder="5.0" style={is} />
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {presets.map(pr => (
          <button key={pr.v} onClick={() => setM(String(pr.v))}
            style={{ padding: "4px 10px", fontSize: 11, background: parseFloat(m) === pr.v ? "#4a8fc9" : "#333", color: parseFloat(m) === pr.v ? "#fff" : "#aaa", border: "none", borderRadius: 20, cursor: "pointer" }}>{pr.label} ({pr.v})</button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>메모</div>
      <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="선택사항" style={is} />
      {valid && <div style={{ background: "#222", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: "monospace", color: "#aaa" }}>30분 시 약 {Math.round((parseFloat(m) * 77.5 * 30) / 60)}kcal 소모</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 12, background: "#333", border: "none", borderRadius: 8, color: "#aaa", fontSize: 14, cursor: "pointer" }}>취소</button>
        <button disabled={!valid} onClick={() => onSave({ n: n.trim(), m: parseFloat(m), memo: memo.trim() })}
          style={{ flex: 1, padding: 12, background: valid ? "#5a9e6f" : "#333", border: "none", borderRadius: 8, color: valid ? "#fff" : "#666", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}>저장</button>
      </div>
    </div>
  );
}

/* ───── 식단 수정 폼 ───── */
function EditMealForm({ meal, onSave, onCancel, onDelete }) {
  const [serving, setServing] = useState(String(meal.serving));
  const [hour, setHour] = useState(meal.hour || 0);
  const is = { width: "100%", padding: "10px 12px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };
  return (
    <div>
      <div style={{ background: "#222", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>{meal.n}</div>
        <div style={{ color: "#787570", fontFamily: "monospace", fontSize: 12 }}>P{meal.p} · C{meal.c} · F{meal.f} · {meal.k}kcal (1회분)</div>
      </div>
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>수량 (서빙)</div>
      <input type="number" step="0.1" min="0.1" value={serving} onChange={e => setServing(e.target.value)} style={is} />
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>식사 시간</div>
      <select value={hour} onChange={e => setHour(parseInt(e.target.value))}
        style={{ ...is, fontFamily: "monospace" }}>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {h < 6 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁"}</option>
        ))}
      </select>
      {parseFloat(serving) > 0 && (
        <div style={{ background: "#222", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: "monospace", color: "#aaa" }}>
          합계: P{Math.round(meal.p * parseFloat(serving))} C{Math.round(meal.c * parseFloat(serving))} F{Math.round(meal.f * parseFloat(serving))} · {Math.round(meal.k * parseFloat(serving))}kcal
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDelete} style={{ padding: 12, background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 8, color: "#e05252", fontSize: 14, cursor: "pointer" }}>삭제</button>
        <button onClick={onCancel} style={{ flex: 1, padding: 12, background: "#333", border: "none", borderRadius: 8, color: "#aaa", fontSize: 14, cursor: "pointer" }}>취소</button>
        <button onClick={() => onSave({ serving: parseFloat(serving) || 1, hour })}
          style={{ flex: 1, padding: 12, background: "#4a8fc9", border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>저장</button>
      </div>
    </div>
  );
}

/* ───── 운동 수정 폼 ───── */
function EditExForm({ exercise, onSave, onCancel, onDelete, weight }) {
  const [duration, setDuration] = useState(String(exercise.duration));
  const [hour, setHour] = useState(exercise.hour || 0);
  const is = { width: "100%", padding: "10px 12px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };
  const estKcal = Math.round((exercise.m * (weight || 77.5) * (parseInt(duration) || 30)) / 60);
  return (
    <div>
      <div style={{ background: "#222", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>{exercise.n}</div>
        <div style={{ color: "#787570", fontSize: 12 }}>MET {exercise.m}</div>
      </div>
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>운동 시간 (분)</div>
      <input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)} style={is} />
      <div style={{ fontSize: 12, color: "#787570", marginBottom: 4 }}>시간대</div>
      <select value={hour} onChange={e => setHour(parseInt(e.target.value))}
        style={{ ...is, fontFamily: "monospace" }}>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {h < 6 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁"}</option>
        ))}
      </select>
      <div style={{ background: "#222", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: "monospace", color: "#aaa" }}>
        예상 소모: -{estKcal} kcal
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDelete} style={{ padding: 12, background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 8, color: "#e05252", fontSize: 14, cursor: "pointer" }}>삭제</button>
        <button onClick={onCancel} style={{ flex: 1, padding: 12, background: "#333", border: "none", borderRadius: 8, color: "#aaa", fontSize: 14, cursor: "pointer" }}>취소</button>
        <button onClick={() => onSave({ duration: parseInt(duration) || 30, hour })}
          style={{ flex: 1, padding: 12, background: "#5a9e6f", border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>저장</button>
      </div>
    </div>
  );
}

/* ───── 체성분 탭 ───── */
function BodyTab({ bodyLog, addBody, date, onEditBody, onDeleteBody }) {
  const [w, setW] = useState("");
  const [m, setM] = useState("");
  const [fp, setFp] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [ew, setEw] = useState("");
  const [em, setEm] = useState("");
  const [efp, setEfp] = useState("");
  const existing = bodyLog.find(b => b.date === date);
  const is = { width: "100%", padding: "10px 12px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };

  const startEdit = (idx) => {
    const b = bodyLog[bodyLog.length - 1 - idx]; // reversed display
    setEditIdx(idx);
    setEw(String(b.weight));
    setEm(String(b.muscle));
    setEfp(String(b.fatPct));
  };

  const saveEdit = () => {
    const realIdx = bodyLog.length - 1 - editIdx;
    if (onEditBody && ew) {
      onEditBody(realIdx, { weight: parseFloat(ew), muscle: parseFloat(em) || 0, fatPct: parseFloat(efp) || 0 });
    }
    setEditIdx(null);
  };

  const handleDelete = (displayIdx) => {
    const realIdx = bodyLog.length - 1 - displayIdx;
    if (onDeleteBody && confirm("이 기록을 삭제할까요?")) {
      onDeleteBody(realIdx);
    }
  };

  return (
    <>
      <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>체성분 기록 ({date})</div>
        {existing && <div style={{ background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13, color: "#e8e4dc" }}>기록됨: {existing.weight}kg · 골격근 {existing.muscle}kg · 체지방 {existing.fatPct}%</div>}
        <input type="number" step="0.1" placeholder="체중 (kg)" value={w} onChange={e => setW(e.target.value)} style={is} />
        <input type="number" step="0.1" placeholder="골격근량 (kg)" value={m} onChange={e => setM(e.target.value)} style={is} />
        <input type="number" step="0.1" placeholder="체지방률 (%)" value={fp} onChange={e => setFp(e.target.value)} style={is} />
        <button onClick={() => { if (w) { addBody(w, m, fp); setW(""); setM(""); setFp(""); } }}
          style={{ width: "100%", padding: 12, background: "#4a8fc9", border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>저장</button>
      </div>
      <div style={{ fontSize: 13, color: "#787570", marginBottom: 8 }}>최근 기록</div>
      {bodyLog.slice(-10).reverse().map((b, i) => (
        <div key={i}>
          {editIdx === i ? (
            <div style={{ background: "#191919", border: "1px solid rgba(74,143,201,0.3)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#4a8fc9", marginBottom: 8, fontFamily: "monospace" }}>{b.date} 수정 중</div>
              <input type="number" step="0.1" placeholder="체중" value={ew} onChange={e => setEw(e.target.value)} style={{ ...is, marginBottom: 6 }} />
              <input type="number" step="0.1" placeholder="골격근량" value={em} onChange={e => setEm(e.target.value)} style={{ ...is, marginBottom: 6 }} />
              <input type="number" step="0.1" placeholder="체지방률" value={efp} onChange={e => setEfp(e.target.value)} style={{ ...is, marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setEditIdx(null)} style={{ flex: 1, padding: 8, background: "#333", border: "none", borderRadius: 6, color: "#aaa", fontSize: 13, cursor: "pointer" }}>취소</button>
                <button onClick={saveEdit} style={{ flex: 1, padding: 8, background: "#4a8fc9", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>저장</button>
              </div>
            </div>
          ) : (
            <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: 12, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#e8e4dc" }}>
              <div style={{ flex: 1, cursor: "pointer" }} onClick={() => startEdit(i)}>
                <span style={{ fontFamily: "monospace", color: "#787570", marginRight: 8 }}>{b.date}</span>
                <span>{b.weight}kg · 근육 {b.muscle}kg · 체지방 {b.fatPct}%</span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => startEdit(i)} style={{ padding: "4px 8px", background: "rgba(74,143,201,0.15)", border: "1px solid rgba(74,143,201,0.3)", borderRadius: 6, color: "#4a8fc9", fontSize: 11, cursor: "pointer" }}>수정</button>
                <button onClick={() => handleDelete(i)} style={{ padding: "4px 8px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 11, cursor: "pointer" }}>삭제</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/* ───── 유틸 ───── */
function aggregateDay(d) {
  if (!d) return { p: 0, c: 0, f: 0, k: 0, ex: 0, net: 0 };
  let p = 0, c = 0, f = 0, k = 0, ex = 0;
  (d.meals || []).forEach(m => { const s = m.serving; p += m.p * s; c += m.c * s; f += m.f * s; k += m.k * s; });
  (d.exercises || []).forEach(e => { ex += e.kcal || 0; });
  return { p, c, f, k, ex, net: k - ex };
}
function getWeekKey(ds) { const d = new Date(ds); const day = d.getDay() || 7; d.setDate(d.getDate() + 4 - day); const ys = new Date(d.getFullYear(), 0, 1); return `${d.getFullYear()}-W${String(Math.ceil((((d - ys) / 86400000) + 1) / 7)).padStart(2, "0")}`; }
function getMonthKey(ds) { return ds.slice(0, 7); }
function getYearKey(ds) { return ds.slice(0, 4); }

/* ───── 통계 탭 ───── */
function StatsTab({ bodyLog, allDays, onBackup }) {
  const [period, setPeriod] = useState("week");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const periodData = useMemo(() => {
    const entries = Object.entries(allDays);
    if (!entries.length) return [];
    const groups = {};
    const keyFn = period === "week" ? getWeekKey : period === "month" ? getMonthKey : getYearKey;
    entries.forEach(([date, data]) => {
      const key = keyFn(date);
      if (!groups[key]) groups[key] = { key, days: 0, p: 0, c: 0, f: 0, k: 0, ex: 0 };
      const a = aggregateDay(data);
      groups[key].days++; groups[key].p += a.p; groups[key].c += a.c; groups[key].f += a.f; groups[key].k += a.k; groups[key].ex += a.ex;
    });
    return Object.values(groups).sort((a, b) => a.key.localeCompare(b.key)).slice(-12).map(g => ({
      ...g, pAvg: Math.round(g.p / g.days), cAvg: Math.round(g.c / g.days), fAvg: Math.round(g.f / g.days),
      kAvg: Math.round(g.k / g.days), exAvg: Math.round(g.ex / g.days), netAvg: Math.round((g.k - g.ex) / g.days)
    }));
  }, [allDays, period]);

  const hourlyData = useMemo(() => {
    const h = Array.from({ length: 24 }, (_, i) => ({ hour: i, meals: 0, kcal: 0, p: 0, c: 0, f: 0 }));
    Object.values(allDays).forEach(d => (d.meals || []).forEach(m => {
      const hr = m.hour || 0;
      if (hr >= 0 && hr < 24) { h[hr].meals++; h[hr].kcal += m.k * m.serving; h[hr].p += m.p * m.serving; h[hr].c += m.c * m.serving; h[hr].f += m.f * m.serving; }
    }));
    return h.map(x => ({ ...x, kcal: Math.round(x.kcal), p: Math.round(x.p), c: Math.round(x.c), f: Math.round(x.f) }));
  }, [allDays]);

  // 기간 지정 분석 데이터
  const rangeAnalysis = useMemo(() => {
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return null;
    
    // 식단/운동 데이터
    const entries = Object.entries(allDays).filter(([d]) => d >= rangeStart && d <= rangeEnd);
    if (!entries.length) return null;
    
    let totalP = 0, totalC = 0, totalF = 0, totalK = 0, totalEx = 0;
    entries.forEach(([, data]) => {
      const a = aggregateDay(data);
      totalP += a.p; totalC += a.c; totalF += a.f; totalK += a.k; totalEx += a.ex;
    });
    const days = entries.length;
    
    // 일별 데이터 (차트용)
    const dailyData = entries.sort(([a], [b]) => a.localeCompare(b)).map(([d, data]) => {
      const a = aggregateDay(data);
      return { d: d.slice(5), p: Math.round(a.p), c: Math.round(a.c), f: Math.round(a.f), k: Math.round(a.k), ex: Math.round(a.ex), net: Math.round(a.net) };
    });
    
    // 체성분 변화
    const startBody = bodyLog.filter(b => b.date >= rangeStart).sort((a, b) => a.date.localeCompare(b.date))[0];
    const endBody = [...bodyLog.filter(b => b.date <= rangeEnd)].sort((a, b) => b.date.localeCompare(a.date))[0];
    
    let bodyChange = null;
    if (startBody && endBody && startBody.date !== endBody.date) {
      bodyChange = {
        startDate: startBody.date,
        endDate: endBody.date,
        startWeight: startBody.weight, endWeight: endBody.weight,
        startFat: startBody.fatPct, endFat: endBody.fatPct,
        startMuscle: startBody.muscle, endMuscle: endBody.muscle,
        dWeight: endBody.weight - startBody.weight,
        dFat: endBody.fatPct - startBody.fatPct,
        dMuscle: endBody.muscle - startBody.muscle,
      };
    }
    
    // 체성분 추이 (차트용)
    const bodyTrend = bodyLog.filter(b => b.date >= rangeStart && b.date <= rangeEnd)
      .map(b => ({ d: b.date.slice(5), weight: b.weight, fat: b.fatPct, muscle: b.muscle }));
    
    return {
      days, pAvg: Math.round(totalP / days), cAvg: Math.round(totalC / days),
      fAvg: Math.round(totalF / days), kAvg: Math.round(totalK / days),
      exAvg: Math.round(totalEx / days), netAvg: Math.round((totalK - totalEx) / days),
      dailyData, bodyChange, bodyTrend
    };
  }, [allDays, bodyLog, rangeStart, rangeEnd]);

  const latest = bodyLog[bodyLog.length - 1];
  const first = bodyLog[0];
  const totalDays = Object.keys(allDays).length;
  const pBtn = (p) => ({ flex: 1, padding: "8px 10px", fontSize: 12, fontWeight: 500, background: period === p ? "#4a8fc9" : "transparent", color: period === p ? "#fff" : "#787570", border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer" });
  const sc = (l, v, u, d, good) => (
    <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#787570" }}>{l}</div>
      <div style={{ fontSize: 20, fontWeight: 500, fontFamily: "monospace", marginTop: 4, color: "#e8e4dc" }}>{v}<span style={{ fontSize: 12 }}>{u}</span></div>
      {d !== undefined && <div style={{ fontSize: 11, fontFamily: "monospace", marginTop: 4, color: good ? "#5a9e6f" : "#e05252" }}>{d}</div>}
    </div>
  );

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {latest && first ? <>{sc("현재 체중", latest.weight, "kg", `${(latest.weight - first.weight) >= 0 ? "+" : ""}${(latest.weight - first.weight).toFixed(1)}kg`, latest.weight <= first.weight)}{sc("체지방률", latest.fatPct, "%", `${(latest.fatPct - first.fatPct) >= 0 ? "+" : ""}${(latest.fatPct - first.fatPct).toFixed(1)}%p`, latest.fatPct <= first.fatPct)}{sc("골격근량", latest.muscle, "kg", `${(latest.muscle - first.muscle) >= 0 ? "+" : ""}${(latest.muscle - first.muscle).toFixed(1)}kg`, latest.muscle >= first.muscle)}{sc("기록 일수", totalDays, "일", `체성분 ${bodyLog.length}회`, true)}</> : <>{sc("기록 일수", totalDays, "일")}{sc("체성분", bodyLog.length, "회")}</>}
      </div>
      <div style={{ display: "flex", gap: 0, marginBottom: 12, borderRadius: 8, overflow: "hidden" }}>
        <button onClick={() => setPeriod("week")} style={{ ...pBtn("week"), borderRadius: "8px 0 0 8px" }}>주간</button>
        <button onClick={() => setPeriod("month")} style={pBtn("month")}>월간</button>
        <button onClick={() => setPeriod("year")} style={pBtn("year")}>연간</button>
        <button onClick={() => setPeriod("hourly")} style={pBtn("hourly")}>시간대</button>
        <button onClick={() => setPeriod("range")} style={{ ...pBtn("range"), borderRadius: "0 8px 8px 0" }}>기간</button>
      </div>

      {period === "hourly" && (<>
        <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>시간대별 칼로리 섭취</div>
          <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={hourlyData}><XAxis dataKey="hour" tick={{ fill: "#787570", fontSize: 10 }} tickFormatter={h => `${h}시`} interval={2} /><YAxis tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Bar dataKey="kcal" fill="#5a9e6f" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </div>
        <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>시간대별 영양소 분포</div>
          <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={hourlyData}><XAxis dataKey="hour" tick={{ fill: "#787570", fontSize: 10 }} tickFormatter={h => `${h}시`} interval={2} /><YAxis tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="p" stackId="a" fill={COLORS.p} name="단백질" /><Bar dataKey="c" stackId="a" fill={COLORS.c} name="탄수" /><Bar dataKey="f" stackId="a" fill={COLORS.f} name="지방" /></BarChart></ResponsiveContainer></div>
        </div>
      </>)}

      {/* 기간 지정 분석 */}
      {period === "range" && (<>
        <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 10 }}>기간 선택</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
              style={{ flex: 1, padding: "8px 10px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 13, fontFamily: "monospace" }} />
            <span style={{ color: "#787570", fontSize: 13 }}>~</span>
            <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
              style={{ flex: 1, padding: "8px 10px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 13, fontFamily: "monospace" }} />
          </div>
        </div>

        {rangeAnalysis && (<>
          {/* 체성분 변화 비교 */}
          {rangeAnalysis.bodyChange && (
            <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>체성분 변화 ({rangeAnalysis.bodyChange.startDate} → {rangeAnalysis.bodyChange.endDate})</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[
                  { l: "체중", s: rangeAnalysis.bodyChange.startWeight, e: rangeAnalysis.bodyChange.endWeight, d: rangeAnalysis.bodyChange.dWeight, u: "kg", good: rangeAnalysis.bodyChange.dWeight <= 0 },
                  { l: "체지방률", s: rangeAnalysis.bodyChange.startFat, e: rangeAnalysis.bodyChange.endFat, d: rangeAnalysis.bodyChange.dFat, u: "%", good: rangeAnalysis.bodyChange.dFat <= 0 },
                  { l: "골격근량", s: rangeAnalysis.bodyChange.startMuscle, e: rangeAnalysis.bodyChange.endMuscle, d: rangeAnalysis.bodyChange.dMuscle, u: "kg", good: rangeAnalysis.bodyChange.dMuscle >= 0 }
                ].map((x, i) => (
                  <div key={i} style={{ background: "#222", borderRadius: 8, padding: 12, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#787570" }}>{x.l}</div>
                    <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace", margin: "4px 0" }}>{x.s} → {x.e}{x.u}</div>
                    <div style={{ fontSize: 18, fontWeight: 500, fontFamily: "monospace", color: x.good ? "#5a9e6f" : "#e05252" }}>
                      {x.d >= 0 ? "+" : ""}{x.d.toFixed(1)}{x.u}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 10 }}>
                <span style={{ fontSize: 12, color: "#787570" }}>기록 일수: <span style={{ color: "#e8e4dc", fontFamily: "monospace" }}>{rangeAnalysis.days}일</span></span>
                <span style={{ fontSize: 12, color: "#787570" }}>기간: <span style={{ color: "#e8e4dc", fontFamily: "monospace" }}>{Math.round((new Date(rangeEnd) - new Date(rangeStart)) / 86400000)}일</span></span>
              </div>
            </div>
          )}

          {/* 기간 평균 영양소 */}
          <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#787570", marginBottom: 10 }}>기간 일평균</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {[
                { l: "단백질", v: rangeAnalysis.pAvg, u: "g", c: COLORS.p },
                { l: "탄수", v: rangeAnalysis.cAvg, u: "g", c: COLORS.c },
                { l: "지방", v: rangeAnalysis.fAvg, u: "g", c: COLORS.f },
                { l: "섭취", v: rangeAnalysis.kAvg, u: "", c: "#5a9e6f" },
                { l: "Net", v: rangeAnalysis.netAvg, u: "", c: "#e05252" }
              ].map((x, i) => (
                <div key={i} style={{ background: "#222", borderRadius: 8, padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#787570" }}>{x.l}</div>
                  <div style={{ fontSize: 16, fontWeight: 500, fontFamily: "monospace", color: x.c, marginTop: 4 }}>{x.v}</div>
                  <div style={{ fontSize: 10, color: "#555" }}>{x.u || "kcal"}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 일별 칼로리 추이 */}
          {rangeAnalysis.dailyData.length > 1 && (
            <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>일별 칼로리 추이</div>
              <div style={{ height: 200 }}><ResponsiveContainer><ComposedChart data={rangeAnalysis.dailyData}><XAxis dataKey="d" tick={{ fill: "#787570", fontSize: 9 }} interval={Math.max(0, Math.floor(rangeAnalysis.dailyData.length / 8))} /><YAxis tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="k" fill="#5a9e6f" name="섭취" radius={[2, 2, 0, 0]} /><Line type="monotone" dataKey="net" stroke="#e05252" strokeWidth={2} name="Net" dot={false} /></ComposedChart></ResponsiveContainer></div>
            </div>
          )}

          {/* 일별 영양소 추이 */}
          {rangeAnalysis.dailyData.length > 1 && (
            <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>일별 영양소 추이</div>
              <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={rangeAnalysis.dailyData}><XAxis dataKey="d" tick={{ fill: "#787570", fontSize: 9 }} interval={Math.max(0, Math.floor(rangeAnalysis.dailyData.length / 8))} /><YAxis tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="p" fill={COLORS.p} name="단백질" radius={[2, 2, 0, 0]} /><Bar dataKey="c" fill={COLORS.c} name="탄수" radius={[2, 2, 0, 0]} /><Bar dataKey="f" fill={COLORS.f} name="지방" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </div>
          )}

          {/* 체성분 추이 그래프 */}
          {rangeAnalysis.bodyTrend.length >= 2 && (
            <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>체성분 추이</div>
              <div style={{ height: 200 }}><ResponsiveContainer><LineChart data={rangeAnalysis.bodyTrend}><XAxis dataKey="d" tick={{ fill: "#787570", fontSize: 10 }} /><YAxis yAxisId="l" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: "#787570", fontSize: 10 }} /><YAxis yAxisId="r" orientation="right" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line yAxisId="l" type="monotone" dataKey="weight" stroke="#4a8fc9" strokeWidth={2} dot={{ r: 2 }} name="체중(kg)" /><Line yAxisId="r" type="monotone" dataKey="fat" stroke="#e05252" strokeWidth={2} dot={{ r: 2 }} name="체지방(%)" /></LineChart></ResponsiveContainer></div>
            </div>
          )}
        </>)}

        {!rangeAnalysis && rangeStart && rangeEnd && (
          <div style={{ textAlign: "center", padding: 24, color: "#555", fontSize: 13 }}>해당 기간에 데이터가 없습니다</div>
        )}
        {(!rangeStart || !rangeEnd) && (
          <div style={{ textAlign: "center", padding: 24, color: "#555", fontSize: 13 }}>시작일과 종료일을 선택하세요</div>
        )}
      </>)}

      {period !== "hourly" && period !== "range" && periodData.length > 0 && (<>
        <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>{period === "week" ? "주간" : period === "month" ? "월간" : "연간"} 칼로리 & Net</div>
          <div style={{ height: 200 }}><ResponsiveContainer><ComposedChart data={periodData}><XAxis dataKey="key" tick={{ fill: "#787570", fontSize: 10 }} tickFormatter={k => k.split("-").slice(-1)[0]} /><YAxis tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="kAvg" fill="#5a9e6f" name="섭취" radius={[3, 3, 0, 0]} /><Bar dataKey="exAvg" fill="#4a8fc9" name="운동" radius={[3, 3, 0, 0]} /><Line type="monotone" dataKey="netAvg" stroke="#e05252" strokeWidth={2} name="Net" dot={{ r: 3 }} /></ComposedChart></ResponsiveContainer></div>
        </div>
        <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>영양소 평균</div>
          <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={periodData}><XAxis dataKey="key" tick={{ fill: "#787570", fontSize: 10 }} tickFormatter={k => k.split("-").slice(-1)[0]} /><YAxis tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="pAvg" fill={COLORS.p} name="단백질" radius={[2, 2, 0, 0]} /><Bar dataKey="cAvg" fill={COLORS.c} name="탄수" radius={[2, 2, 0, 0]} /><Bar dataKey="fAvg" fill={COLORS.f} name="지방" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </div>
      </>)}

      {bodyLog.length >= 2 && period !== "range" && (
        <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>체중 & 체지방 추이</div>
          <div style={{ height: 200 }}><ResponsiveContainer><LineChart data={bodyLog.slice(-30).map(b => ({ d: b.date.slice(5), weight: b.weight, fat: b.fatPct }))}><XAxis dataKey="d" tick={{ fill: "#787570", fontSize: 10 }} /><YAxis yAxisId="l" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: "#787570", fontSize: 10 }} /><YAxis yAxisId="r" orientation="right" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line yAxisId="l" type="monotone" dataKey="weight" stroke="#4a8fc9" strokeWidth={2} dot={{ r: 2 }} name="체중(kg)" /><Line yAxisId="r" type="monotone" dataKey="fat" stroke="#e05252" strokeWidth={2} dot={{ r: 2 }} name="체지방(%)" /></LineChart></ResponsiveContainer></div>
        </div>
      )}

      <button onClick={onBackup} disabled={totalDays === 0}
        style={{ width: "100%", padding: 14, background: totalDays === 0 ? "#333" : "#5a9e6f", border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 500, cursor: totalDays === 0 ? "not-allowed" : "pointer", marginTop: 8 }}>
        {totalDays === 0 ? "데이터 없음" : "📥 CSV로 내보내기 (엑셀 호환)"}
      </button>
    </>
  );
}

/* ═══════════════════════════════════════════════ */
/*                    MAIN APP                     */
/* ═══════════════════════════════════════════════ */
// 앱 래퍼 (로그인 관리)
export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // 이전 로그인 세션 확인
    const savedId = getCurrentUserId();
    if (savedId) {
      getProfiles().then(profiles => {
        const found = profiles.find(p => p.id === savedId);
        if (found) setUser(found);
        setChecking(false);
      });
    } else {
      setChecking(false);
    }
  }, []);

  const handleLogin = (profile) => {
    setUserId(profile.id);
    setUser(profile);
  };

  const handleLogout = () => {
    logout();
    setUser(null);
  };

  if (checking) return <div style={{ background: "#0f0f0f", color: "#787570", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>로딩 중...</div>;
  if (!user) return <LoginScreen onLogin={handleLogin} />;
  return <MainApp user={user} onLogout={handleLogout} />;
}

// 메인 앱
function MainApp({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [date, setDate] = useState(today());
  const [meals, setMeals] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [bodyLog, setBodyLog] = useState([]);
  const [allDays, setAllDays] = useState({});
  const [customFoods, setCustomFoods] = useState([]);
  const [customEx, setCustomEx] = useState([]);
  const [search, setSearch] = useState("");
  const [exSearch, setExSearch] = useState("");
  const [qty, setQty] = useState({});
  const [exMin, setExMin] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [mealHour, setMealHour] = useState(nowHour());
  const [exHour, setExHour] = useState(nowHour());
  const [showAddFood, setShowAddFood] = useState(false);
  const [showAddEx, setShowAddEx] = useState(false);
  const [editMealIdx, setEditMealIdx] = useState(null);
  const [editExIdx, setEditExIdx] = useState(null);
  const [showManage, setShowManage] = useState(false);
  const [manageTab, setManageTab] = useState("food");
  const [lastBackup, setLastBackup] = useState(null);
  const [justBacked, setJustBacked] = useState(false);
  const [yesterdayData, setYesterdayData] = useState({ meals: [], exercises: [] });

  const FOOD_DB = useMemo(() => [...DEFAULT_FOODS, ...customFoods], [customFoods]);
  const EX_DB = useMemo(() => [...DEFAULT_EX, ...customEx], [customEx]);

  // 어제 날짜 계산
  const getYesterday = useCallback((d) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() - 1);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }, []);

  // 초기 로드 (Firebase 비동기)
  useEffect(() => {
    async function loadAll() {
      try {
        const cf = await store.get("custom-foods");
        if (cf) setCustomFoods(cf);
        const ce = await store.get("custom-exercises");
        if (ce) setCustomEx(ce);
        const body = await store.get("bodylog");
        if (body) setBodyLog([...body].sort((a, b) => a.date.localeCompare(b.date)));

        const lb = await store.get("lastBackup");
        if (lb) setLastBackup(lb);

        const keys = await store.list("day:");
        const data = {};
        for (const k of keys) {
          const d = await store.get(k);
          if (d) data[k.replace("day:", "")] = d;
        }
        setAllDays(data);
      } catch (e) { console.error("Load error:", e); }
      setLoaded(true);
    }
    loadAll();
  }, []);

  // 날짜 변경 시 해당 날 + 어제 데이터 로드 (시간순 정렬 적용)
  useEffect(() => {
    async function loadDay() {
      try {
        const data = await store.get(`day:${date}`);
        if (data) {
          setMeals(sortByHour(data.meals || []));
          setExercises(sortByHour(data.exercises || []));
        } else { setMeals([]); setExercises([]); }

        // 어제 데이터 로드
        const yd = getYesterday(date);
        const yData = await store.get(`day:${yd}`);
        if (yData) {
          setYesterdayData({ meals: yData.meals || [], exercises: yData.exercises || [] });
        } else { setYesterdayData({ meals: [], exercises: [] }); }
      } catch { setMeals([]); setExercises([]); setYesterdayData({ meals: [], exercises: [] }); }
    }
    if (loaded) loadDay();
  }, [date, loaded, getYesterday]);

  const saveDay = async (d, m, e) => {
    setAllDays(prev => ({ ...prev, [d]: { meals: m, exercises: e } }));
    await store.set(`day:${d}`, { meals: m, exercises: e });
  };

  const addMeal = (food, q) => {
    const serving = parseFloat(q) || 1;
    const hour = parseInt(mealHour) || nowHour();
    const entry = { ...food, serving, ts: Date.now(), hour };
    const nm = sortByHour([...meals, entry]);
    setMeals(nm); saveDay(date, nm, exercises);
    setSearch(""); setQty({});
  };
  const removeMeal = (idx) => { const nm = meals.filter((_, i) => i !== idx); setMeals(nm); saveDay(date, nm, exercises); };
  const editMeal = (idx, updated) => {
    const nm = sortByHour(meals.map((m, i) => i === idx ? { ...m, ...updated } : m));
    setMeals(nm); saveDay(date, nm, exercises); setEditMealIdx(null);
  };

  const addExercise = (ex, min) => {
    const duration = parseInt(min) || 30;
    const kcal = Math.round((ex.m * TARGETS.weight * duration) / 60);
    const hour = parseInt(exHour) || nowHour();
    const entry = { ...ex, duration, kcal, ts: Date.now(), hour };
    const ne = sortByHour([...exercises, entry]);
    setExercises(ne); saveDay(date, meals, ne);
    setExSearch(""); setExMin({});
  };
  const removeExercise = (idx) => { const ne = exercises.filter((_, i) => i !== idx); setExercises(ne); saveDay(date, meals, ne); };
  const editExercise = (idx, updated) => {
    const ne = sortByHour(exercises.map((e, i) => i === idx ? { ...e, ...updated, kcal: Math.round((e.m * TARGETS.weight * (updated.duration || e.duration)) / 60) } : e));
    setExercises(ne); saveDay(date, meals, ne); setEditExIdx(null);
  };

  const addBody = async (w, muscle, fatPct) => {
    const entry = { date, weight: parseFloat(w), muscle: parseFloat(muscle) || 0, fatPct: parseFloat(fatPct) || 0 };
    const nl = [...bodyLog.filter(b => b.date !== date), entry].sort((a, b) => a.date.localeCompare(b.date));
    setBodyLog(nl); await store.set("bodylog", nl);
  };

  const editBody = async (idx, updated) => {
    const nl = bodyLog.map((b, i) => i === idx ? { ...b, ...updated } : b).sort((a, b) => a.date.localeCompare(b.date));
    setBodyLog(nl); await store.set("bodylog", nl);
  };

  const deleteBody = async (idx) => {
    const nl = bodyLog.filter((_, i) => i !== idx);
    setBodyLog(nl); await store.set("bodylog", nl);
  };

  const saveCustomFood = async (food) => {
    const nf = [...customFoods, { ...food, custom: true }];
    setCustomFoods(nf); await store.set("custom-foods", nf); setShowAddFood(false);
  };
  const deleteCustomFood = async (idx) => {
    const nf = customFoods.filter((_, i) => i !== idx);
    setCustomFoods(nf); await store.set("custom-foods", nf);
  };
  const saveCustomEx = async (ex) => {
    const ne = [...customEx, { ...ex, custom: true }];
    setCustomEx(ne); await store.set("custom-exercises", ne); setShowAddEx(false);
  };
  const deleteCustomEx = async (idx) => {
    const ne = customEx.filter((_, i) => i !== idx);
    setCustomEx(ne); await store.set("custom-exercises", ne);
  };

  // 어제 기록 복사 (개별) — 시간은 현재 선택된 시간 사용
  const copyMealFromYesterday = (meal) => {
    const entry = { ...meal, ts: Date.now(), hour: parseInt(mealHour) || nowHour() };
    const nm = sortByHour([...meals, entry]);
    setMeals(nm); saveDay(date, nm, exercises);
  };

  const copyExFromYesterday = (ex) => {
    const entry = { ...ex, ts: Date.now(), hour: parseInt(exHour) || nowHour() };
    const ne = sortByHour([...exercises, entry]);
    setExercises(ne); saveDay(date, meals, ne);
  };

  // 어제 전체 복사 — 시간은 현재 선택된 시간 사용
  const copyAllMealsFromYesterday = () => {
    const hour = parseInt(mealHour) || nowHour();
    const newMeals = yesterdayData.meals.map(m => ({ ...m, ts: Date.now(), hour }));
    const nm = sortByHour([...meals, ...newMeals]);
    setMeals(nm); saveDay(date, nm, exercises);
  };

  const copyAllExFromYesterday = () => {
    const hour = parseInt(exHour) || nowHour();
    const newEx = yesterdayData.exercises.map(e => ({ ...e, ts: Date.now(), hour }));
    const ne = sortByHour([...exercises, ...newEx]);
    setExercises(ne); saveDay(date, meals, ne);
  };

  // 백업 (CSV 내보내기 + 날짜 기록)
  const doBackup = async () => {
    // CSV 생성
    const rows = [];
    rows.push(["=== 일별 요약 ==="]); rows.push(["날짜","P(g)","C(g)","F(g)","K(kcal)","운동(kcal)","Net(kcal)"]);
    Object.entries(allDays).sort().forEach(([d, data]) => { const a = aggregateDay(data); rows.push([d, Math.round(a.p), Math.round(a.c), Math.round(a.f), Math.round(a.k), Math.round(a.ex), Math.round(a.net)]); });
    rows.push([]); rows.push(["=== 식단 상세 ==="]); rows.push(["날짜","시간","음식","수량","P(g)","C(g)","F(g)","K(kcal)"]);
    Object.entries(allDays).sort().forEach(([d, data]) => (data.meals || []).forEach(m => rows.push([d, `${String(m.hour||0).padStart(2,"0")}:00`, m.n, m.serving, (m.p*m.serving).toFixed(1), (m.c*m.serving).toFixed(1), (m.f*m.serving).toFixed(1), Math.round(m.k*m.serving)])));
    rows.push([]); rows.push(["=== 운동 상세 ==="]); rows.push(["날짜","시간","운동","시간(분)","소모(kcal)","MET"]);
    Object.entries(allDays).sort().forEach(([d, data]) => (data.exercises || []).forEach(e => rows.push([d, `${String(e.hour||0).padStart(2,"0")}:00`, e.n, e.duration, e.kcal, e.m])));
    rows.push([]); rows.push(["=== 체성분 ==="]); rows.push(["날짜","체중(kg)","골격근량(kg)","체지방률(%)"]);
    bodyLog.forEach(b => rows.push([b.date, b.weight, b.muscle, b.fatPct]));
    const csv = "\uFEFF" + rows.map(r => r.map(v => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g,'""')}"` : s; }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `daniel_tracker_${today()}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);

    // 백업 날짜 기록
    const now = today();
    setLastBackup(now);
    setJustBacked(true);
    await store.set("lastBackup", now);
    setTimeout(() => setJustBacked(false), 5000);
  };

  // 백업 경과 일수 계산
  const backupDaysAgo = useMemo(() => {
    if (!lastBackup) return 999;
    const diff = (new Date(today()) - new Date(lastBackup)) / 86400000;
    return Math.floor(diff);
  }, [lastBackup]);

  // 월 평균 체중 기반 동적 목표 계산
  const TARGETS = useMemo(() => {
    const currentMonth = date.slice(0, 7); // "2026-04"
    const monthEntries = bodyLog.filter(b => b.date.startsWith(currentMonth));
    let avgWeight;
    if (monthEntries.length > 0) {
      avgWeight = monthEntries.reduce((s, b) => s + b.weight, 0) / monthEntries.length;
    } else if (bodyLog.length > 0) {
      // 해당 월 기록 없으면 가장 최근 기록 사용
      avgWeight = bodyLog[bodyLog.length - 1].weight;
    } else {
      avgWeight = DEFAULT_TARGETS.weight; // 기본값 77.5
    }
    return calcTargets(avgWeight, user.height || 175, user.age || 35);
  }, [bodyLog, date, user]);

  const totals = useMemo(() => {
    let p = 0, c = 0, f = 0, k = 0;
    meals.forEach(m => { const s = m.serving; p += m.p * s; c += m.c * s; f += m.f * s; k += m.k * s; });
    return { p: Math.round(p), c: Math.round(c), f: Math.round(f), k: Math.round(k) };
  }, [meals]);
  const exTotal = useMemo(() => exercises.reduce((s, e) => s + (e.kcal || 0), 0), [exercises]);
  const netKcal = totals.k - exTotal;

  const filteredFoods = useMemo(() => {
    if (!search.trim()) return [];
    return FOOD_DB.filter(f => f.n.toLowerCase().includes(search.toLowerCase()));
  }, [search, FOOD_DB]);
  const filteredEx = useMemo(() => {
    if (!exSearch.trim()) return [];
    return EX_DB.filter(e => e.n.toLowerCase().includes(exSearch.toLowerCase()));
  }, [exSearch, EX_DB]);

  const tabStyle = (t) => ({
    flex: 1, padding: "14px 0", textAlign: "center", fontSize: 14, fontWeight: 600,
    color: tab === t ? "#4a8fc9" : "#666", background: "none", border: "none",
    borderTop: tab === t ? "2px solid #4a8fc9" : "2px solid transparent", cursor: "pointer"
  });
  const cs = { background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 };

  if (!loaded) return <div style={{ color: "#888", padding: 40, textAlign: "center" }}>Loading...</div>;

  return (
    <div style={{ background: "#0f0f0f", color: "#e8e4dc", minHeight: "100vh", maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Daniel Body Plan</div>
          <div style={{ fontSize: 11, color: "#787570", fontFamily: "monospace" }}>체지방 {user.targetFat || 15}% · {user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={onLogout} style={{ background: "#222", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>OUT</button>
          <button onClick={() => setShowManage(true)} style={{ background: "#222", border: "1px solid rgba(74,143,201,0.3)", borderRadius: 6, color: "#4a8fc9", padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>DB</button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", padding: "6px 10px", fontSize: 12, fontFamily: "monospace" }} />
        </div>
      </div>

      <div style={{ padding: "16px 20px 80px" }}>
        {/* HOME */}
        {tab === "home" && (<>
          {/* 백업 알림 */}
          {justBacked ? (
            <div style={{ background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 10, padding: 12, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, color: "#5a9e6f", fontWeight: 500 }}>백업 완료</div>
                <div style={{ fontSize: 11, color: "#787570", marginTop: 2 }}>마지막 백업: 오늘</div>
              </div>
              <div style={{ fontSize: 18, color: "#5a9e6f" }}>✓</div>
            </div>
          ) : backupDaysAgo >= 15 && (
            <div onClick={doBackup} style={{ background: "rgba(212,148,58,0.1)", border: "1px solid rgba(212,148,58,0.25)", borderRadius: 10, padding: 12, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 13, color: "#d4943a", fontWeight: 500 }}>백업을 해주세요</div>
                <div style={{ fontSize: 11, color: "#787570", marginTop: 2 }}>마지막 백업: {lastBackup ? `${backupDaysAgo}일 전` : "없음"}</div>
              </div>
              <div style={{ background: "#d4943a", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#fff", fontWeight: 500 }}>백업</div>
            </div>
          )}
          <div style={cs}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: "#787570" }}>오늘의 요약</span>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: netKcal > TARGETS.k ? "#e05252" : "#5a9e6f" }}>Net {Math.round(netKcal)} kcal</span>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16 }}>
              {[{ l: "단백질", v: totals.p, t: TARGETS.p, c: COLORS.p }, { l: "탄수", v: totals.c, t: TARGETS.c, c: COLORS.c }, { l: "지방", v: totals.f, t: TARGETS.f, c: COLORS.f }].map(x => (
                <div key={x.l} style={{ textAlign: "center" }}>
                  <MiniDonut value={x.v} max={x.t} color={x.c} />
                  <div style={{ fontSize: 11, color: "#787570", marginTop: 4 }}>{x.l}</div>
                  <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 500, color: x.v > x.t ? "#e8e4dc" : "#e8e4dc" }}>{x.v}g</div>
                  <div style={{ fontSize: 10, color: "#555" }}>/ {x.t}g</div>
                  {x.v > x.t && <div style={{ fontSize: 10, color: "#e05252", fontFamily: "monospace" }}>+{x.v - x.t}g 초과</div>}
                </div>
              ))}
            </div>
            <ProgressBar value={totals.k} max={TARGETS.k} color="#5a9e6f" label="섭취 칼로리" unit="kcal" />
            <ProgressBar value={exTotal} max={600} color="#4a8fc9" label="운동 소모" unit="kcal" />
            <NetCalCard intake={totals.k} exercise={exTotal} />
          </div>
          <div style={cs}>
            <div style={{ fontSize: 13, color: "#787570", marginBottom: 10 }}>오늘 먹은 것 ({meals.length}건)</div>
            {!meals.length && <div style={{ fontSize: 13, color: "#555", textAlign: "center", padding: 16 }}>식단 탭에서 기록 추가</div>}
            {groupMealsByTime(meals).map((group) => {
              const gP = Math.round(group.meals.reduce((s, m) => s + m.p * m.serving, 0));
              const gC = Math.round(group.meals.reduce((s, m) => s + m.c * m.serving, 0));
              const gF = Math.round(group.meals.reduce((s, m) => s + m.f * m.serving, 0));
              const gK = Math.round(group.meals.reduce((s, m) => s + m.k * m.serving, 0));
              return (
                <div key={group.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.meals.length}건)</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "#787570" }}>P{gP} C{gC} F{gF} · {gK}kcal</span>
                  </div>
                  {group.meals.map((m, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 5px 8px", borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 13 }}>
                      <div><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(m.hour || 0).padStart(2, "0")}시</span>{m.n}{m.serving !== 1 && <span style={{ color: "#787570", marginLeft: 4 }}>×{m.serving}</span>}</div>
                      <span style={{ color: "#787570", fontFamily: "monospace", fontSize: 12 }}>{Math.round(m.k * m.serving)}kcal</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={cs}>
            <div style={{ fontSize: 13, color: "#787570", marginBottom: 10 }}>오늘 운동 ({exercises.length}건)</div>
            {!exercises.length && <div style={{ fontSize: 13, color: "#555", textAlign: "center", padding: 16 }}>운동 탭에서 기록 추가</div>}
            {exercises.map((e, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
                <div><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(e.hour || 0).padStart(2, "0")}시</span>{e.n} · {e.duration}분</div>
                <span style={{ color: "#4a8fc9", fontFamily: "monospace", fontSize: 12 }}>-{e.kcal}kcal</span>
              </div>
            ))}
          </div>
        </>)}

        {/* DIET */}
        {tab === "diet" && (<>
          {/* 시간 선택 (먼저) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: "#191919", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
            <span style={{ fontSize: 13, color: "#787570" }}>식사 시간</span>
            <select value={mealHour} onChange={e => setMealHour(parseInt(e.target.value))}
              style={{ flex: 1, padding: "6px 8px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 14, fontFamily: "monospace" }}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {h < 6 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁"}</option>
              ))}
            </select>
            <button onClick={() => setMealHour(nowHour())} style={{ padding: "6px 10px", background: "#333", border: "none", borderRadius: 6, color: "#aaa", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>지금</button>
          </div>

          {/* 어제 식단 빠른 복사 */}
          {yesterdayData.meals.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#787570", marginBottom: 8 }}>어제 먹은 것</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {[...new Map(yesterdayData.meals.map(m => [m.n + "_" + m.serving, m])).values()].map((m, i) => (
                  <div key={i} onClick={() => copyMealFromYesterday(m)}
                    style={{ background: "#222", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 20, padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#e8e4dc" }}>
                    <span>{m.n}{m.serving !== 1 ? ` ×${m.serving}` : ""}</span>
                    <span style={{ color: "#4a8fc9", fontSize: 14 }}>+</span>
                  </div>
                ))}
              </div>
              <div onClick={copyAllMealsFromYesterday}
                style={{ background: "rgba(74,143,201,0.08)", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#4a8fc9", fontWeight: 500 }}>어제 식단 전체 복사</div>
                  <div style={{ fontSize: 11, color: "#787570", marginTop: 2 }}>{yesterdayData.meals.length}건 · {Math.round(yesterdayData.meals.reduce((s, m) => s + m.k * m.serving, 0)).toLocaleString()} kcal</div>
                </div>
                <div style={{ color: "#4a8fc9", fontSize: 18 }}>↓</div>
              </div>
            </div>
          )}

          {/* 검색 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="text" placeholder="음식 검색..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, padding: "10px 12px", background: "#191919", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#e8e4dc", fontSize: 14, boxSizing: "border-box" }} />
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: 16 }}>
            {filteredFoods.map((f, i) => (
              <div key={i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{f.n}</div>
                  <div style={{ fontSize: 11, color: "#787570", fontFamily: "monospace", marginTop: 2 }}>P{f.p} · C{f.c} · F{f.f} · {f.k}kcal</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" step="0.1" min="0.1" placeholder="1" value={qty[i] || ""} onChange={e => setQty({ ...qty, [i]: e.target.value })} style={{ width: 50, padding: "6px 8px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 13, textAlign: "center" }} />
                  <button onClick={() => addMeal(f, qty[i] || "1")} style={{ padding: "6px 14px", background: "#4a8fc9", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                </div>
              </div>
            ))}
            {!filteredFoods.length && search.trim() && <div style={{ textAlign: "center", padding: 24, color: "#555", fontSize: 13 }}>검색 결과 없음</div>}
          </div>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 8 }}>오늘 기록 ({meals.length}건)</div>
          {groupMealsByTime(meals).map((group) => {
            const gP = Math.round(group.meals.reduce((s, m) => s + m.p * m.serving, 0));
            const gC = Math.round(group.meals.reduce((s, m) => s + m.c * m.serving, 0));
            const gF = Math.round(group.meals.reduce((s, m) => s + m.f * m.serving, 0));
            const gK = Math.round(group.meals.reduce((s, m) => s + m.k * m.serving, 0));
            return (
              <div key={group.key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.meals.length}건)</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "#787570" }}>P{gP} C{gC} F{gF} · {gK}kcal</span>
                </div>
                {group.meals.map((m) => (
                  <div key={m._idx} style={{ ...cs, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setEditMealIdx(m._idx)}><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(m.hour || 0).padStart(2, "0")}시</span><span style={{ fontSize: 13 }}>{m.n}</span><span style={{ color: "#787570", fontSize: 12, marginLeft: 4 }}>×{m.serving}</span><div style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>P{Math.round(m.p * m.serving)} C{Math.round(m.c * m.serving)} F{Math.round(m.f * m.serving)} · {Math.round(m.k * m.serving)}kcal</div></div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => setEditMealIdx(m._idx)} style={{ padding: "4px 10px", background: "rgba(74,143,201,0.15)", border: "1px solid rgba(74,143,201,0.3)", borderRadius: 6, color: "#4a8fc9", fontSize: 12, cursor: "pointer" }}>수정</button>
                      <button onClick={() => removeMeal(m._idx)} style={{ padding: "4px 10px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 12, cursor: "pointer" }}>삭제</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </>)}

        {/* EXERCISE */}
        {tab === "exercise" && (<>
          {/* 시간 선택 (먼저) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: "#191919", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
            <span style={{ fontSize: 13, color: "#787570" }}>운동 시간</span>
            <select value={exHour} onChange={e => setExHour(parseInt(e.target.value))}
              style={{ flex: 1, padding: "6px 8px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 14, fontFamily: "monospace" }}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {h < 6 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁"}</option>
              ))}
            </select>
            <button onClick={() => setExHour(nowHour())} style={{ padding: "6px 10px", background: "#333", border: "none", borderRadius: 6, color: "#aaa", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>지금</button>
          </div>

          {/* 어제 운동 빠른 복사 */}
          {yesterdayData.exercises.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#787570", marginBottom: 8 }}>어제 운동</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {yesterdayData.exercises.map((e, i) => (
                  <div key={i} onClick={() => copyExFromYesterday(e)}
                    style={{ background: "#222", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 20, padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#e8e4dc" }}>
                    <span>{e.n} {e.duration}분</span>
                    <span style={{ color: "#5a9e6f", fontSize: 14 }}>+</span>
                  </div>
                ))}
              </div>
              <div onClick={copyAllExFromYesterday}
                style={{ background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#5a9e6f", fontWeight: 500 }}>어제 운동 전체 복사</div>
                  <div style={{ fontSize: 11, color: "#787570", marginTop: 2 }}>{yesterdayData.exercises.length}건 · {Math.round(yesterdayData.exercises.reduce((s, e) => s + (e.kcal || 0), 0)).toLocaleString()} kcal</div>
                </div>
                <div style={{ color: "#5a9e6f", fontSize: 18 }}>↓</div>
              </div>
            </div>
          )}

          {/* 검색 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="text" placeholder="운동 검색..." value={exSearch} onChange={e => setExSearch(e.target.value)} style={{ flex: 1, padding: "10px 12px", background: "#191919", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#e8e4dc", fontSize: 14, boxSizing: "border-box" }} />
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: 16 }}>
            {filteredEx.map((e, i) => (
              <div key={i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{e.n}</div>
                  <div style={{ fontSize: 11, color: "#787570" }}>MET {e.m} {e.memo && `· ${e.memo}`}</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" min="5" step="5" placeholder="30" value={exMin[i] || ""} onChange={ev => setExMin({ ...exMin, [i]: ev.target.value })} style={{ width: 50, padding: "6px 8px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 13, textAlign: "center" }} />
                  <span style={{ fontSize: 11, color: "#555" }}>분</span>
                  <button onClick={() => addExercise(e, exMin[i] || "30")} style={{ padding: "6px 14px", background: "#5a9e6f", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 8 }}>오늘 운동 (소모: {exTotal}kcal)</div>
          {exercises.map((e, i) => (
            <div key={i} style={{ ...cs, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setEditExIdx(i)}><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(e.hour || 0).padStart(2, "0")}시</span><span style={{ fontSize: 13 }}>{e.n}</span><span style={{ color: "#787570", fontSize: 12, marginLeft: 4 }}>{e.duration}분</span><div style={{ fontSize: 11, color: "#4a8fc9", fontFamily: "monospace" }}>-{e.kcal} kcal</div></div>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setEditExIdx(i)} style={{ padding: "4px 10px", background: "rgba(74,143,201,0.15)", border: "1px solid rgba(74,143,201,0.3)", borderRadius: 6, color: "#4a8fc9", fontSize: 12, cursor: "pointer" }}>수정</button>
                <button onClick={() => removeExercise(i)} style={{ padding: "4px 10px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 12, cursor: "pointer" }}>삭제</button>
              </div>
            </div>
          ))}
        </>)}

        {tab === "body" && <BodyTab bodyLog={bodyLog} addBody={addBody} date={date} onEditBody={editBody} onDeleteBody={deleteBody} />}
        {tab === "stats" && <StatsTab bodyLog={bodyLog} allDays={allDays} onBackup={doBackup} />}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#0f0f0f", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", zIndex: 10 }}>
        {[["home", "홈"], ["diet", "식단"], ["exercise", "운동"], ["body", "체성분"], ["stats", "통계"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={tabStyle(k)}>{l}</button>
        ))}
      </div>

      {/* Modals */}
      <Modal open={showAddFood} onClose={() => setShowAddFood(false)} title="새 음식 추가">
        <AddFoodForm initialName={search} onSave={saveCustomFood} onCancel={() => setShowAddFood(false)} />
      </Modal>
      <Modal open={showAddEx} onClose={() => setShowAddEx(false)} title="새 운동 추가">
        <AddExForm initialName={exSearch} onSave={saveCustomEx} onCancel={() => setShowAddEx(false)} />
      </Modal>
      <Modal open={showManage} onClose={() => setShowManage(false)} title="DB 관리">
        <div style={{ display: "flex", gap: 0, marginBottom: 16, borderRadius: 8, overflow: "hidden" }}>
          <button onClick={() => setManageTab("food")} style={{ flex: 1, padding: 10, fontSize: 13, fontWeight: 500, background: manageTab === "food" ? "#4a8fc9" : "#333", color: manageTab === "food" ? "#fff" : "#aaa", border: "none", cursor: "pointer", borderRadius: "8px 0 0 8px" }}>음식 ({FOOD_DB.length})</button>
          <button onClick={() => setManageTab("ex")} style={{ flex: 1, padding: 10, fontSize: 13, fontWeight: 500, background: manageTab === "ex" ? "#4a8fc9" : "#333", color: manageTab === "ex" ? "#fff" : "#aaa", border: "none", cursor: "pointer", borderRadius: "0 8px 8px 0" }}>운동 ({EX_DB.length})</button>
        </div>
        {manageTab === "food" && (<>
          <button onClick={() => { setShowManage(false); setShowAddFood(true); }} style={{ width: "100%", padding: 10, background: "#d4943a", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer", marginBottom: 12 }}>+ 새 음식 추가</button>
          {customFoods.length > 0 && <div style={{ fontSize: 12, color: "#d4943a", marginBottom: 8 }}>직접 추가 ({customFoods.length}개)</div>}
          {customFoods.map((f, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
              <div><div style={{ fontWeight: 500 }}>{f.n}</div><div style={{ fontSize: 11, color: "#787570", fontFamily: "monospace" }}>P{f.p} C{f.c} F{f.f} · {f.k}kcal</div></div>
              <button onClick={() => deleteCustomFood(i)} style={{ padding: "4px 10px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 11, cursor: "pointer" }}>삭제</button>
            </div>
          ))}
          <div style={{ fontSize: 12, color: "#555", marginTop: 12 }}>기본 DB ({DEFAULT_FOODS.length}개)는 삭제 불가</div>
        </>)}
        {manageTab === "ex" && (<>
          <button onClick={() => { setShowManage(false); setShowAddEx(true); }} style={{ width: "100%", padding: 10, background: "#d4943a", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer", marginBottom: 12 }}>+ 새 운동 추가</button>
          {customEx.length > 0 && <div style={{ fontSize: 12, color: "#d4943a", marginBottom: 8 }}>직접 추가 ({customEx.length}개)</div>}
          {customEx.map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
              <div><div style={{ fontWeight: 500 }}>{e.n}</div><div style={{ fontSize: 11, color: "#787570" }}>MET {e.m}</div></div>
              <button onClick={() => deleteCustomEx(i)} style={{ padding: "4px 10px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 11, cursor: "pointer" }}>삭제</button>
            </div>
          ))}
          <div style={{ fontSize: 12, color: "#555", marginTop: 12 }}>기본 DB ({DEFAULT_EX.length}개)는 삭제 불가</div>
        </>)}
      </Modal>

      {/* Edit Meal Modal */}
      <Modal open={editMealIdx !== null} onClose={() => setEditMealIdx(null)} title="식단 수정">
        {editMealIdx !== null && meals[editMealIdx] && <EditMealForm meal={meals[editMealIdx]} onSave={(updated) => editMeal(editMealIdx, updated)} onCancel={() => setEditMealIdx(null)} onDelete={() => { removeMeal(editMealIdx); setEditMealIdx(null); }} />}
      </Modal>

      {/* Edit Exercise Modal */}
      <Modal open={editExIdx !== null} onClose={() => setEditExIdx(null)} title="운동 수정">
        {editExIdx !== null && exercises[editExIdx] && <EditExForm exercise={exercises[editExIdx]} onSave={(updated) => editExercise(editExIdx, updated)} onCancel={() => setEditExIdx(null)} onDelete={() => { removeExercise(editExIdx); setEditExIdx(null); }} weight={TARGETS.weight} />}
      </Modal>
    </div>
  );
}
