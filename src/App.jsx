import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar, ComposedChart, Legend, ScatterChart, Scatter, ReferenceLine } from "recharts";
import store, { getCurrentUserId, setUserId, logout, getProfiles, saveProfiles, getSharedFoods, addSharedFood, getSharedExercises, addSharedExercise } from "./store.js";
import { DEFAULT_FOODS, DEFAULT_EX, TARGETS as DEFAULT_TARGETS, COLORS } from "./data.js";

/* ───── 디자인 시스템: Modern Library + Soft Card + Subtle Fade ───── */
const THEME = {
  bg: "#141414", card: "#1e1e1e", inner: "#252525", surface: "#2a2a2a",
  text: "#f5f5f0", sub: "#707070", hint: "#4a4a4a", muted: "#8a8a8a",
  gold: "#d4af37", goldDim: "rgba(212,175,55,0.12)",
  border: "rgba(255,255,255,0.06)", borderLight: "rgba(255,255,255,0.08)",
  shadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)",
  font: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css');
      * { font-family: ${THEME.font}; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      body { margin: 0; background: ${THEME.bg}; }
      input, select, button { font-family: ${THEME.font}; }
      @keyframes dbp-fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes dbp-fadeIn { from { opacity: 0; } to { opacity: 1; } }
      .dbp-fade { animation: dbp-fadeUp 0.25s ease-out both; }
      .dbp-fade-d1 { animation: dbp-fadeUp 0.25s ease-out 0.04s both; }
      .dbp-fade-d2 { animation: dbp-fadeUp 0.25s ease-out 0.08s both; }
      .dbp-fade-in { animation: dbp-fadeIn 0.2s ease-out both; }
      .dbp-btn { transition: all 0.15s ease; }
      .dbp-btn:hover { box-shadow: 0 0 12px rgba(212,175,55,0.2); }
      .dbp-btn:active { transform: scale(0.97); }
      .dbp-card { transition: opacity 0.2s ease; }
      @keyframes dbp-actionBar { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      .dbp-lp-selected { background: rgba(212,175,55,0.06) !important; border-left: 3px solid #d4af37 !important; }
      .dbp-lp-bar { animation: dbp-actionBar 0.2s ease-out both; }
      .dbp-lp-item { transition: background 0.15s ease; -webkit-user-select: none; user-select: none; }
      input:focus, select:focus { outline: none; border-color: rgba(212,175,55,0.3) !important; }
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
    `}</style>
  );
}

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
    { label: "🌅 아침", key: "morning", meals: [] },
    { label: "🌞 점심", key: "lunch", meals: [] },
    { label: "🌙 저녁", key: "dinner", meals: [] },
    { label: "🌃 야식", key: "night", meals: [] }
  ];
  meals.forEach((m, idx) => {
    const h = m.hour || 0;
    if (h >= 4 && h <= 10) groups[0].meals.push({ ...m, _idx: idx });
    else if (h >= 11 && h <= 14) groups[1].meals.push({ ...m, _idx: idx });
    else if (h >= 15 && h <= 20) groups[2].meals.push({ ...m, _idx: idx });
    else groups[3].meals.push({ ...m, _idx: idx });
  });
  return groups.filter(g => g.meals.length > 0);
}

// 시간대별 운동 그룹핑
function groupExercisesByTime(exercises) {
  const groups = [
    { label: "🌅 아침", key: "morning", items: [] },
    { label: "🌞 점심", key: "lunch", items: [] },
    { label: "🌙 저녁", key: "dinner", items: [] },
    { label: "🌃 야간", key: "night", items: [] }
  ];
  exercises.forEach((e, idx) => {
    const h = e.hour || 0;
    if (h >= 4 && h <= 10) groups[0].items.push({ ...e, _idx: idx });
    else if (h >= 11 && h <= 14) groups[1].items.push({ ...e, _idx: idx });
    else if (h >= 15 && h <= 20) groups[2].items.push({ ...e, _idx: idx });
    else groups[3].items.push({ ...e, _idx: idx });
  });
  return groups.filter(g => g.items.length > 0);
}

// Long Press 액션바 컴포넌트
function LongPressActionBar({ onEdit, onDelete, onCancel, color = "#d4af37" }) {
  return (
    <div className="dbp-lp-bar" style={{ display: "flex", gap: 8, padding: "8px 12px", background: "#252525", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={onEdit} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", background: "rgba(74,143,201,0.12)", color: "#4a8fc9" }}>✎ 수정</button>
      <button onClick={onDelete} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", background: "rgba(224,82,82,0.12)", color: "#e05252" }}>✕ 삭제</button>
      <button onClick={onCancel} style={{ padding: "10px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", background: "#2a2a2a", color: "#8a8a8a" }}>취소</button>
    </div>
  );
}

// useLongPress 훅
function useLongPress(delay = 400) {
  const [selectedIdx, setSelectedIdx] = useState(null);
  const timerRef = useRef(null);
  const movedRef = useRef(false);
  const firedRef = useRef(false);
  const touchedRef = useRef(false);

  // 언마운트 시 타이머 정리
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const bind = useCallback((idx) => ({
    onTouchStart: () => {
      touchedRef.current = true;
      movedRef.current = false;
      firedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!movedRef.current) { firedRef.current = true; setSelectedIdx(prev => prev === idx ? null : idx); }
      }, delay);
    },
    onTouchMove: () => { movedRef.current = true; if (timerRef.current) clearTimeout(timerRef.current); },
    onTouchEnd: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onMouseDown: () => {
      if (touchedRef.current) { touchedRef.current = false; return; }
      movedRef.current = false;
      firedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { firedRef.current = true; setSelectedIdx(prev => prev === idx ? null : idx); }, delay);
    },
    onMouseUp: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onMouseLeave: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onContextMenu: (e) => e.preventDefault(),
  }), [delay]);

  const wasLongPress = useCallback(() => {
    if (firedRef.current) { firedRef.current = false; return true; }
    return false;
  }, []);

  const clear = useCallback(() => setSelectedIdx(null), []);

  return { selectedIdx, bind, wasLongPress, clear };
}

// Net 칼로리 카드 (신호등 스타일)
function NetCalCard({ intake, exercise }) {
  const net = Math.round(intake - exercise);
  let status, color, emoji;
  if (net < 1500) { status = "위험"; color = "#e05252"; emoji = "🔴"; }
  else if (net < 1800) { status = "주의"; color = "#d4af37"; emoji = "🟡"; }
  else if (net <= 2100) { status = "적정"; color = "#5a9e6f"; emoji = "🟢"; }
  else { status = "초과"; color = "#d4af37"; emoji = "🟡"; }

  const zones = [
    { l: "위험", r: "~1,500", c: "#e05252", bg: "rgba(224,82,82,0.1)", active: net < 1500 },
    { l: "주의", r: "1,500~1,800", c: "#d4af37", bg: "rgba(212,175,55,0.1)", active: net >= 1500 && net < 1800 },
    { l: "적정", r: "1,800~2,100", c: "#5a9e6f", bg: "rgba(90,158,111,0.1)", active: net >= 1800 && net <= 2100 },
    { l: "초과", r: "2,100~", c: "#d4af37", bg: "rgba(212,175,55,0.1)", active: net > 2100 }
  ];

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ background: `${color}11`, border: `1px solid ${color}33`, borderRadius: 16, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "#707070", marginBottom: 2 }}>Net 칼로리</div>
            <div style={{ fontSize: 22, fontWeight: 500, fontFamily: "monospace", color }}>
              {net.toLocaleString()} <span style={{ fontSize: 12, color: "#707070" }}>kcal</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20 }}>{emoji}</div>
            <div style={{ fontSize: 11, color }}>{status}</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#707070", lineHeight: 1.5 }}>
          섭취 {Math.round(intake).toLocaleString()} - 운동 {Math.round(exercise).toLocaleString()} = <span style={{ color: "#f5f5f0" }}>Net {net.toLocaleString()}</span>
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

function MiniDonut({ value, max, color, size = 72 }) {
  const over = value > max;
  const darkColor = color === "#4a8fc9" ? "#1e3f66" : color === "#d4af37" ? "#7a4a10" : "#801818";
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
const PROFILE_COLORS = ["#4a8fc9", "#d4af37", "#5a9e6f", "#9b7dc9", "#e05252", "#d4c43a", "#4ac9a8", "#c94a7d"];

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

  if (loading) return <div style={{ background: THEME.bg, color: THEME.sub, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>로딩 중...</div>;

  return (
    <div style={{ background: THEME.bg, color: THEME.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", padding: "60px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 24, fontWeight: 500, marginBottom: 6, letterSpacing: "-0.5px" }}>Daniel Body Plan</div>
        <div style={{ fontSize: 12, color: THEME.gold, opacity: 0.6, letterSpacing: "2px", textTransform: "uppercase" }}>사용자를 선택하세요</div>
      </div>

      {showNew ? (
        <ProfileSetup onSave={handleCreate} onCancel={() => setShowNew(false)} colorIdx={profiles.length} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {profiles.map((p, i) => (
              <div key={i} onClick={() => handleProfileClick(p)} className="dbp-btn dbp-fade"
                style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 16, padding: "18px 10px", textAlign: "center", cursor: "pointer", position: "relative", boxShadow: THEME.shadow, animationDelay: `${i * 0.06}s` }}>
                <button onClick={(e) => handleDeleteRequest(i, e)}
                  style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", color: THEME.hint, fontSize: 14, cursor: "pointer" }}>✕</button>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: p.color || PROFILE_COLORS[i % PROFILE_COLORS.length], margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 500, color: "#fff" }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: THEME.sub, marginTop: 4 }}>목표 체지방 {p.targetFat}%</div>
                {p.password && <div style={{ fontSize: 10, color: THEME.hint, marginTop: 4 }}>🔒</div>}
              </div>
            ))}

            <div onClick={() => setShowNew(true)} className="dbp-btn dbp-fade"
              style={{ background: THEME.card, border: `1px dashed rgba(212,175,55,0.2)`, borderRadius: 16, padding: "18px 10px", textAlign: "center", cursor: "pointer", boxShadow: THEME.shadow }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: THEME.surface, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: THEME.gold }}>+</div>
              <div style={{ fontSize: 15, color: THEME.sub }}>새 사용자</div>
              <div style={{ fontSize: 11, color: THEME.hint, marginTop: 4 }}>추가하기</div>
            </div>
          </div>
        </>
      )}

      {/* 비밀번호 입력 모달 */}
      {pwModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={() => setPwModal(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
          <div style={{ position: "relative", width: "90%", maxWidth: 340, background: "#1e1e1e", borderRadius: 16, padding: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: pwModal.color || "#4a8fc9", margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 500, color: "#fff" }}>
                {pwModal.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{pwModal.name}</div>
            </div>
            <div style={{ fontSize: 12, color: "#707070", marginBottom: 6 }}>비밀번호</div>
            <input type="password" value={pw} onChange={e => { setPw(e.target.value); setPwError(false); }}
              onKeyDown={e => e.key === "Enter" && handlePwSubmit()}
              placeholder="비밀번호를 입력하세요"
              autoFocus
              style={{ width: "100%", padding: 12, background: "#252525", border: `1px solid ${pwError ? "#e05252" : "rgba(255,255,255,0.08)"}`, borderRadius: 8, color: "#f5f5f0", fontSize: 15, boxSizing: "border-box", marginBottom: 6 }} />
            {pwError && <div style={{ fontSize: 12, color: "#e05252", marginBottom: 8 }}>비밀번호가 틀렸습니다</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setPwModal(null)} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "none", borderRadius: 16, color: "#8a8a8a", fontSize: 14, cursor: "pointer" }}>취소</button>
              <button onClick={handlePwSubmit} style={{ flex: 1, padding: 12, background: "#d4af37", border: "none", borderRadius: 12, color: "#141414", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>로그인</button>
            </div>
          </div>
        </div>
      )}

      {/* 관리자 비밀번호 삭제 모달 */}
      {deleteIdx !== null && profiles[deleteIdx] && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={() => setDeleteIdx(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} />
          <div style={{ position: "relative", width: "90%", maxWidth: 340, background: "#1e1e1e", borderRadius: 16, padding: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: "#e05252" }}>프로필 삭제</div>
              <div style={{ fontSize: 13, color: "#707070", marginTop: 6 }}>"{profiles[deleteIdx].name}"을(를) 삭제하려면<br/>관리자 비밀번호를 입력하세요</div>
            </div>
            <input type="password" value={adminPw} onChange={e => { setAdminPw(e.target.value); setAdminPwError(false); }}
              onKeyDown={e => e.key === "Enter" && handleDeleteConfirm()}
              placeholder="관리자 비밀번호"
              autoFocus
              style={{ width: "100%", padding: 12, background: "#252525", border: `1px solid ${adminPwError ? "#e05252" : "rgba(255,255,255,0.08)"}`, borderRadius: 8, color: "#f5f5f0", fontSize: 15, boxSizing: "border-box", marginBottom: 6 }} />
            {adminPwError && <div style={{ fontSize: 12, color: "#e05252", marginBottom: 8 }}>관리자 비밀번호가 틀렸습니다</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setDeleteIdx(null)} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "none", borderRadius: 16, color: "#8a8a8a", fontSize: 14, cursor: "pointer" }}>취소</button>
              <button onClick={handleDeleteConfirm} style={{ flex: 1, padding: 12, background: "#e05252", border: "none", borderRadius: 16, color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 

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

function Modal({ open, onClose, title, children }) {
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

/* ───── 운동 추가 폼 ───── */
function AddExForm({ initialName, onSave, onCancel }) {
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
      {valid && <div style={{ background: "#252525", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, fontFamily: "monospace", color: "#8a8a8a" }}>30분 시 약 {Math.round((parseFloat(m) * 77.5 * 30) / 60)}kcal 소모</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 12, background: "#2a2a2a", border: "none", borderRadius: 8, color: "#8a8a8a", fontSize: 14, cursor: "pointer" }}>취소</button>
        <button disabled={!valid} onClick={() => onSave({ n: n.trim(), m: parseFloat(m), memo: memo.trim() })}
          style={{ flex: 1, padding: 12, background: valid ? "#5a9e6f" : "#2a2a2a", border: "none", borderRadius: 8, color: valid ? "#fff" : "#666", fontSize: 14, fontWeight: 500, cursor: valid ? "pointer" : "not-allowed" }}>저장</button>
      </div>
    </div>
  );
}

/* ───── 식단 수정 폼 ───── */
function EditMealForm({ meal, onSave, onCancel, onDelete }) {
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
          <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {h < 4 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁"}</option>
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

/* ───── 운동 수정 폼 ───── */
function EditExForm({ exercise, onSave, onCancel, onDelete, weight }) {
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
          <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {h < 4 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁"}</option>
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

/* ───── 체성분 탭 (컨셉 B: 차트 탭 전환 + 목표 스테퍼 + 히스토리 3건) ───── */
function BodyTab({ bodyLog, addBody, date, onEditBody, onDeleteBody, user, goals, onSaveGoals, allDays }) {
  const [w, setW] = useState("");
  const [m, setM] = useState("");
  const [fp, setFp] = useState("");
  const [sc, setSc] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [ew, setEw] = useState("");
  const [em, setEm] = useState("");
  const [efp, setEfp] = useState("");
  const [esc, setEsc] = useState("");
  const [coaching, setCoaching] = useState("");
  const [coachDate, setCoachDate] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [chartTab, setChartTab] = useState("weight");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const lpBody = useLongPress(400);

  // 캐시된 코칭 로드 (동기 — localStorage에서 즉시)
  useEffect(() => {
    try {
      const uid = getCurrentUserId();
      const cached = localStorage.getItem("dt_" + uid + "_body-coaching");
      if (cached) {
        const c = JSON.parse(cached);
        if (c && c.text) { setCoaching(c.text); setCoachDate(c.latestDate || ""); }
      }
    } catch {}
  }, []);

  // 7일 이동평균 변화 감지
  const detectionResult = useMemo(() => {
    if (bodyLog.length < 10) return null; // 최소 10일 데이터 필요
    const sorted = [...bodyLog].sort((a, b) => a.date.localeCompare(b.date));
    const recent7 = sorted.slice(-7);
    const prev7 = sorted.slice(-14, -7);
    if (prev7.length < 5 || recent7.length < 5) return null; // 각 구간 최소 5일

    const avg = (arr, key) => arr.reduce((s, v) => s + (v[key] || 0), 0) / arr.length;
    const rW = avg(recent7, "weight"), pW = avg(prev7, "weight");
    const rM = avg(recent7, "muscle"), pM = avg(prev7, "muscle");
    const rF = avg(recent7, "fatPct"), pF = avg(prev7, "fatPct");

    const dW = Math.round((rW - pW) * 10) / 10;
    const dM = Math.round((rM - pM) * 10) / 10;
    const dF = Math.round((rF - pF) * 10) / 10;

    const thresholds = { weight: 0.5, muscle: 0.3, fatPct: 0.7 };
    const triggers = [];
    if (Math.abs(dW) >= thresholds.weight) triggers.push({ label: "체중", val: dW, unit: "kg", goodDir: -1 });
    if (Math.abs(dM) >= thresholds.muscle) triggers.push({ label: "골격근", val: dM, unit: "kg", goodDir: 1 });
    if (Math.abs(dF) >= thresholds.fatPct) triggers.push({ label: "체지방률", val: dF, unit: "%", goodDir: -1 });

    if (triggers.length === 0) return null;
    return { triggers, avgRecent: { weight: rW, muscle: rM, fatPct: rF }, avgPrev: { weight: pW, muscle: pM, fatPct: pF } };
  }, [bodyLog]);

  // 변화 감지 시 자동 AI 호출 (캐시가 최신이면 스킵)
  useEffect(() => {
    if (!detectionResult || coachLoading) return;
    const latestDate = bodyLog.length > 0 ? bodyLog[bodyLog.length - 1].date : "";
    if (coachDate === latestDate) return; // 이미 이 데이터 기준 코칭 있음
    const l = bodyLog[bodyLog.length - 1];
    const p = bodyLog.length >= 2 ? bodyLog[bodyLog.length - 2] : null;
    if (l) fetchCoaching(l, p);
  }, [detectionResult, bodyLog, coachDate]);

  const existing = bodyLog.find(b => b.date === date);
  const latest = bodyLog[bodyLog.length - 1];
  const prev = bodyLog.length >= 2 ? bodyLog[bodyLog.length - 2] : null;
  const ht = user?.height || 175;
  const age = user?.age || 35;
  const is = { width: "100%", padding: "10px 12px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };

  const bmi = latest ? Math.round(latest.weight / ((ht / 100) ** 2) * 10) / 10 : 0;
  const bmr = latest ? Math.round(10 * latest.weight + 6.25 * ht - 5 * age + 5) : 0;
  const fatMass = latest ? Math.round(latest.weight * latest.fatPct / 100 * 10) / 10 : 0;
  const leanMass = latest ? Math.round((latest.weight - fatMass) * 10) / 10 : 0;
  const idealWeight = Math.round(22 * (ht / 100) ** 2 * 10) / 10;
  const weightAdj = latest ? Math.round((idealWeight - latest.weight) * 10) / 10 : 0;

  const stdWeight = idealWeight;
  const stdMuscle = Math.round(ht * 0.195 * 10) / 10;
  const stdFatPct = 15;

  const dW = prev && latest ? Math.round((latest.weight - prev.weight) * 10) / 10 : null;
  const dM = prev && latest ? Math.round((latest.muscle - prev.muscle) * 10) / 10 : null;
  const dF = prev && latest ? Math.round((latest.fatPct - prev.fatPct) * 10) / 10 : null;
  const dS = prev && latest ? (latest.score || 0) - (prev.score || 0) : null;

  // 차트 데이터
  const chartData = useMemo(() => {
    return bodyLog.slice(-30).map(b => ({
      d: b.date.slice(5),
      weight: b.weight,
      muscle: b.muscle,
      fatPct: b.fatPct,
      score: b.score || 0
    }));
  }, [bodyLog]);

  const chartConfig = {
    weight: { key: "weight", color: "#4a8fc9", label: "체중", unit: "kg", target: goals?.weight },
    muscle: { key: "muscle", color: "#5a9e6f", label: "골격근", unit: "kg", target: goals?.muscle },
    fatPct: { key: "fatPct", color: "#e05252", label: "체지방", unit: "%", target: goals?.fatPct }
  };
  const cc = chartConfig[chartTab];

  const chartStats = useMemo(() => {
    if (chartData.length === 0) return null;
    const vals = chartData.map(d => d[cc.key]).filter(v => v > 0);
    if (vals.length === 0) return null;
    return { max: Math.max(...vals), min: Math.min(...vals), avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 };
  }, [chartData, cc.key]);

  // 측정 사이 식단/운동 요약
  const periodSummary = useMemo(() => {
    if (!prev || !latest || !allDays) return null;
    const entries = Object.entries(allDays).filter(([d]) => d > prev.date && d <= latest.date);
    if (entries.length === 0) return null;
    let totalP = 0, totalK = 0, totalEx = 0, exDays = 0;
    entries.forEach(([, d]) => {
      (d.meals || []).forEach(ml => { totalP += ml.p * ml.serving; totalK += ml.k * ml.serving; });
      const dayEx = (d.exercises || []).reduce((s, e) => s + (e.kcal || 0), 0);
      totalEx += dayEx; if (dayEx > 0) exDays++;
    });
    const days = entries.length;
    return { days, avgP: Math.round(totalP / days), avgK: Math.round(totalK / days), totalSessions: exDays, avgBurn: Math.round(totalEx / days), weeklyEx: Math.round(exDays / (days / 7) * 10) / 10 };
  }, [prev, latest, allDays]);

  const fetchCoaching = async (current, previous) => {
    setCoachLoading(true); setCoaching("");
    try {
      const res = await fetch("/api/analyze-body", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current: { weight: current.weight, muscle: current.muscle, fatPct: current.fatPct, score: current.score },
          previous: previous ? { date: previous.date, weight: previous.weight, muscle: previous.muscle, fatPct: previous.fatPct } : null,
          dietSummary: periodSummary ? { avgP: periodSummary.avgP, avgK: periodSummary.avgK, days: periodSummary.days } : null,
          exerciseSummary: periodSummary ? { totalSessions: periodSummary.totalSessions, avgBurn: periodSummary.avgBurn } : null,
          goals: goals ? { weight: goals.weight, fatPct: goals.fatPct, muscle: goals.muscle } : null
        })
      });
      const data = await res.json();
      if (data.success && data.coaching) {
        setCoaching(data.coaching);
        const latestDate = current.date || date;
        setCoachDate(latestDate);
        // 캐시 저장 (Firestore + localStorage)
        store.set("body-coaching", { text: data.coaching, latestDate, savedAt: new Date().toISOString() });
      }
    } catch {} setCoachLoading(false);
  };

  const handleSave = () => {
    if (!w) return;
    addBody(w, m, fp, sc);
    setW(""); setM(""); setFp(""); setSc(""); setShowForm(false);
  };

  const startEdit = (idx) => {
    const b = bodyLog[bodyLog.length - 1 - idx];
    setEditIdx(idx); setEw(String(b.weight)); setEm(String(b.muscle)); setEfp(String(b.fatPct)); setEsc(String(b.score || ""));
  };
  const saveEdit = () => {
    const realIdx = bodyLog.length - 1 - editIdx;
    if (onEditBody && ew) onEditBody(realIdx, { weight: parseFloat(ew), muscle: parseFloat(em) || 0, fatPct: parseFloat(efp) || 0, score: parseInt(esc) || 0 });
    setEditIdx(null);
  };
  const handleDelete = (displayIdx) => {
    const realIdx = bodyLog.length - 1 - displayIdx;
    if (onDeleteBody && confirm("이 기록을 삭제할까요?")) onDeleteBody(realIdx);
  };

  const chgColor = (v, reverse) => { if (v === null || v === 0) return "#707070"; if (reverse) return v < 0 ? "#5a9e6f" : "#e05252"; return v > 0 ? "#5a9e6f" : "#e05252"; };
  const chgSign = (v) => v > 0 ? "+" + v : String(v);
  const barPct = (val, std) => Math.min(Math.round((val / std) * 50), 98);
  const goalPct = (current, start, target, dir) => {
    if (!start || !target || !current) return 0;
    if (dir === "down") { const d = start - target; return d > 0 ? Math.min(Math.max(Math.round(((start - current) / d) * 100), 0), 100) : 0; }
    const d = target - start; return d > 0 ? Math.min(Math.max(Math.round(((current - start) / d) * 100), 0), 100) : 0;
  };
  const adjustGoal = (key, delta) => { if (onSaveGoals && goals) { const v = Math.round(((goals[key] || 0) + delta) * 10) / 10; if (v > 0) onSaveGoals({ ...goals, [key]: v }); } };

  const first = bodyLog[0];
  const displayHistory = showAllHistory ? bodyLog.slice(-30).reverse() : bodyLog.slice(-3).reverse();

  return (
    <>
      {!showForm && (
        <div style={{ marginBottom: 10 }}>
          <button onClick={() => setShowForm(true)}
            style={{ width: "100%", padding: 12, background: existing ? "#252525" : "#4a8fc9", border: existing ? "1px solid rgba(74,143,201,0.3)" : "none", borderRadius: 12, color: existing ? "#4a8fc9" : "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            {existing ? `${date} 기록 수정` : `${date} 체성분 기록`}
          </button>
        </div>
      )}

      {showForm && (
        <div style={{ background: "#1e1e1e", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 16, padding: 16, marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "#707070", marginBottom: 10 }}>체성분 기록 ({date})</div>
          {existing && <div style={{ background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.15)", borderRadius: 6, padding: 8, marginBottom: 10, fontSize: 11, color: "#5a9e6f" }}>기존: {existing.weight}kg · {existing.muscle}kg · {existing.fatPct}% · {existing.score || "-"}점</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <input type="number" step="0.1" placeholder="체중 (kg)" value={w} onChange={e => setW(e.target.value)} style={is} />
            <input type="number" step="0.1" placeholder="골격근량 (kg)" value={m} onChange={e => setM(e.target.value)} style={is} />
            <input type="number" step="0.1" placeholder="체지방률 (%)" value={fp} onChange={e => setFp(e.target.value)} style={is} />
            <input type="number" step="1" placeholder="인바디 점수" value={sc} onChange={e => setSc(e.target.value)} style={is} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: 10, background: "#2a2a2a", border: "none", borderRadius: 8, color: "#8a8a8a", fontSize: 13, cursor: "pointer" }}>취소</button>
            <button onClick={handleSave} disabled={!w} style={{ flex: 2, padding: 10, background: w ? "#4a8fc9" : "#2a2a2a", border: "none", borderRadius: 8, color: w ? "#fff" : "#666", fontSize: 13, fontWeight: 500, cursor: w ? "pointer" : "not-allowed" }}>저장 + AI 코칭</button>
          </div>
        </div>
      )}

      {latest && (
        <>
          {/* 점수 + BMI/BMR + 막대그래프 */}
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 10, color: "#707070" }}>{latest.date}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 28, fontWeight: 500, color: "#d4af37" }}>{latest.score || "—"}</span>
                  <span style={{ fontSize: 11, color: "#707070" }}>점</span>
                  {dS !== null && dS !== 0 && <span style={{ background: dS > 0 ? "rgba(90,158,111,0.15)" : "rgba(224,82,82,0.15)", color: dS > 0 ? "#5a9e6f" : "#e05252", fontSize: 10, padding: "1px 6px", borderRadius: 4 }}>{chgSign(dS)}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <div style={{ background: "#252525", borderRadius: 8, padding: "6px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: "#707070" }}>BMI</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{bmi}</div>
                </div>
                <div style={{ background: "#252525", borderRadius: 8, padding: "6px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: "#707070" }}>BMR</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{bmr.toLocaleString()}</div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              {[
                { label: "체중", val: latest.weight, unit: "kg", std: stdWeight, d: dW, color: "#4a8fc9", reverse: true, tab: "weight" },
                { label: "골격근", val: latest.muscle, unit: "kg", std: stdMuscle, d: dM, color: "#5a9e6f", reverse: false, tab: "muscle" },
                { label: "체지방", val: latest.fatPct, unit: "%", std: stdFatPct, d: dF, color: "#e05252", reverse: true, tab: "fatPct" }
              ].map((item, i) => (
                <div key={i} onClick={() => setChartTab(item.tab)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: i < 2 ? 8 : 0, cursor: "pointer", padding: "2px 0", borderRadius: 4, background: chartTab === item.tab ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  <span style={{ fontSize: 10, color: chartTab === item.tab ? item.color : "#8a8a8a", minWidth: 36, fontWeight: chartTab === item.tab ? 500 : 400 }}>{item.label}</span>
                  <div style={{ flex: 1, height: 14, background: "#2a2a2a", borderRadius: 3, position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: "40%", width: "20%", height: "100%", background: "rgba(255,255,255,0.04)" }}></div>
                    <div style={{ width: barPct(item.val, item.std) + "%", height: "100%", background: item.color, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 4, minWidth: 30 }}>
                      <span style={{ fontSize: 8, color: "#fff", fontWeight: 500 }}>{item.val}{item.unit}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: item.d !== null ? chgColor(item.d, item.reverse) : "#4a4a4a", minWidth: 36, textAlign: "right" }}>{item.d !== null ? chgSign(item.d) : "—"}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <div style={{ flex: 1, background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.12)", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#5a9e6f" }}>체지방량</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{fatMass}kg</div>
              </div>
              <div style={{ flex: 1, background: "rgba(74,143,201,0.08)", border: "1px solid rgba(74,143,201,0.12)", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#4a8fc9" }}>제지방량</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{leanMass}kg</div>
              </div>
              <div style={{ flex: 1, background: weightAdj >= 0 ? "rgba(90,158,111,0.08)" : "rgba(224,82,82,0.08)", border: `1px solid ${weightAdj >= 0 ? "rgba(90,158,111,0.12)" : "rgba(224,82,82,0.12)"}`, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 8, color: weightAdj >= 0 ? "#5a9e6f" : "#e05252" }}>체중 조절</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: weightAdj >= 0 ? "#5a9e6f" : "#e05252" }}>{weightAdj > 0 ? "+" : ""}{weightAdj}kg</div>
              </div>
            </div>
          </div>

          {/* 추이 차트 (탭 전환) */}
          {chartData.length >= 2 && (
            <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                {Object.entries(chartConfig).map(([key, cfg]) => (
                  <div key={key} onClick={() => setChartTab(key)}
                    style={{ flex: 1, textAlign: "center", padding: 6, background: chartTab === key ? cfg.color : "#252525", borderRadius: 6, fontSize: 11, fontWeight: chartTab === key ? 500 : 400, color: chartTab === key ? "#fff" : "#707070", cursor: "pointer", transition: "all 0.2s" }}>
                    {cfg.label}
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="d" tick={{ fill: "#4a4a4a", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(chartData.length / 5) - 1)} />
                  <YAxis domain={["auto", "auto"]} tick={{ fill: "#4a4a4a", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#252525", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, color: "#f5f5f0" }} formatter={(v) => [v + cc.unit, cc.label]} labelStyle={{ color: "#707070" }} />
                  <Line type="monotone" dataKey={cc.key} stroke={cc.color} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: cc.color }} />
                  {cc.target && <ReferenceLine y={cc.target} stroke="#d4af37" strokeDasharray="4 3" strokeWidth={1} label={{ value: `목표 ${cc.target}`, fill: "#d4af37", fontSize: 9, position: "insideTopRight" }} />}
                </LineChart>
              </ResponsiveContainer>
              {chartStats && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#4a4a4a", marginTop: 4 }}>
                  <span>최고 {chartStats.max} · 최저 {chartStats.min}</span>
                  <span>평균 {chartStats.avg}{cc.unit}</span>
                </div>
              )}
            </div>
          )}

          {/* 목표 설정 + 달성률 */}
          {goals && (
            <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#707070", marginBottom: 10 }}>목표 설정</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {[
                  { key: "weight", label: "체중", color: "#4a8fc9", unit: "kg", step: 0.5, dir: "down" },
                  { key: "fatPct", label: "체지방", color: "#e05252", unit: "%", step: 0.5, dir: "down" },
                  { key: "muscle", label: "골격근", color: "#5a9e6f", unit: "kg", step: 0.5, dir: "up" }
                ].map(g => {
                  const pct = first && latest ? goalPct(latest[g.key === "fatPct" ? "fatPct" : g.key], first[g.key === "fatPct" ? "fatPct" : g.key], goals[g.key], g.dir) : 0;
                  return (
                    <div key={g.key} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: g.color, marginBottom: 2 }}>{g.label}</div>
                      <div style={{ background: "#252525", border: `1px solid ${g.color}22`, borderRadius: 6, padding: "4px 2px", display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                        <span onClick={() => adjustGoal(g.key, -g.step)} style={{ fontSize: 14, color: "#4a4a4a", cursor: "pointer", padding: "0 6px", userSelect: "none" }}>−</span>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{goals[g.key]}<span style={{ fontSize: 9, color: "#707070" }}>{g.unit}</span></span>
                        <span onClick={() => adjustGoal(g.key, g.step)} style={{ fontSize: 14, color: "#4a4a4a", cursor: "pointer", padding: "0 6px", userSelect: "none" }}>+</span>
                      </div>
                      <div style={{ height: 2, background: "#2a2a2a", borderRadius: 1, marginTop: 4 }}>
                        <div style={{ width: pct + "%", height: "100%", background: g.dir === "up" ? "#5a9e6f" : "#d4af37", borderRadius: 1 }}></div>
                      </div>
                      <div style={{ fontSize: 8, color: "#4a4a4a", marginTop: 1 }}>{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI 코칭 */}
          {(coaching || coachLoading) && (
            <div style={{ background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.15)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: "#d4af37" }}></div>
                <span style={{ fontSize: 10, color: "#d4af37" }}>AI 코칭</span>
                {coachDate && <span style={{ fontSize: 9, color: "#4a4a4a", marginLeft: "auto" }}>{coachDate} 기준</span>}
              </div>
              {coachLoading ? <div style={{ fontSize: 12, color: "#707070" }}>분석 중...</div> : <div style={{ fontSize: 12, color: "#c0b896", lineHeight: 1.5 }}>{coaching}</div>}
            </div>
          )}

          {/* 다시 분석 버튼 (항상 표시) */}
          {!coachLoading && (
            <div style={{ textAlign: "center", marginBottom: 10 }}>
              <span onClick={() => { if (latest) fetchCoaching(latest, prev); }}
                style={{ fontSize: 11, color: "#4a8fc9", cursor: "pointer", padding: "6px 16px", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 8, display: "inline-block" }}>
                {coaching ? "다시 분석" : "AI 체성분 분석"}
              </span>
            </div>
          )}

          {/* 측정 사이 식단/운동 요약 */}
          {periodSummary && (
            <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#707070", marginBottom: 8 }}>측정 사이 요약 ({periodSummary.days}일)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <div style={{ background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.08)", borderRadius: 8, padding: 8 }}>
                  <div style={{ fontSize: 9, color: "#d4af37" }}>평균 단백질</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{periodSummary.avgP}<span style={{ fontSize: 10, color: "#707070" }}>g/일</span></div>
                </div>
                <div style={{ background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.08)", borderRadius: 8, padding: 8 }}>
                  <div style={{ fontSize: 9, color: "#d4af37" }}>평균 섭취</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{periodSummary.avgK.toLocaleString()}<span style={{ fontSize: 10, color: "#707070" }}>kcal</span></div>
                </div>
                <div style={{ background: "rgba(74,143,201,0.06)", border: "1px solid rgba(74,143,201,0.08)", borderRadius: 8, padding: 8 }}>
                  <div style={{ fontSize: 9, color: "#4a8fc9" }}>운동 빈도</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>주 {periodSummary.weeklyEx}<span style={{ fontSize: 10, color: "#707070" }}>회</span></div>
                </div>
                <div style={{ background: "rgba(74,143,201,0.06)", border: "1px solid rgba(74,143,201,0.08)", borderRadius: 8, padding: 8 }}>
                  <div style={{ fontSize: 9, color: "#4a8fc9" }}>일평균 소모</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{periodSummary.avgBurn}<span style={{ fontSize: 10, color: "#707070" }}>kcal</span></div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* 히스토리 (3건 + 전체보기) */}
      <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "#707070" }}>기록 히스토리 ({bodyLog.length}건)</span>
          {bodyLog.length > 0 && <span style={{ fontSize: 10, color: "#4a4a4a" }}>꾹 눌러서 수정/삭제</span>}
        </div>
        {bodyLog.length === 0 && <div style={{ fontSize: 12, color: "#4a4a4a", textAlign: "center", padding: 16 }}>체성분을 기록해보세요</div>}
        {displayHistory.map((b, i) => (
          <div key={i}>
            {editIdx === i ? (
              <div style={{ background: "#252525", border: "1px solid rgba(74,143,201,0.3)", borderRadius: 8, padding: 10, marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: "#4a8fc9", marginBottom: 6, fontFamily: "monospace" }}>{b.date} 수정</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <input type="number" step="0.1" placeholder="체중" value={ew} onChange={e => setEw(e.target.value)} style={{ ...is, marginBottom: 4, fontSize: 12, padding: "8px 10px" }} />
                  <input type="number" step="0.1" placeholder="골격근량" value={em} onChange={e => setEm(e.target.value)} style={{ ...is, marginBottom: 4, fontSize: 12, padding: "8px 10px" }} />
                  <input type="number" step="0.1" placeholder="체지방률" value={efp} onChange={e => setEfp(e.target.value)} style={{ ...is, marginBottom: 4, fontSize: 12, padding: "8px 10px" }} />
                  <input type="number" step="1" placeholder="점수" value={esc} onChange={e => setEsc(e.target.value)} style={{ ...is, marginBottom: 4, fontSize: 12, padding: "8px 10px" }} />
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setEditIdx(null)} style={{ flex: 1, padding: 6, background: "#2a2a2a", border: "none", borderRadius: 6, color: "#8a8a8a", fontSize: 11, cursor: "pointer" }}>취소</button>
                  <button onClick={saveEdit} style={{ flex: 1, padding: 6, background: "#4a8fc9", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>저장</button>
                </div>
              </div>
            ) : (
              <div>
                <div className={`dbp-lp-item ${lpBody.selectedIdx === i ? "dbp-lp-selected" : ""}`} {...lpBody.bind(i)} onClick={() => { if (!lpBody.wasLongPress()) startEdit(i); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 4px", borderBottom: lpBody.selectedIdx === i ? "none" : "1px solid rgba(255,255,255,0.04)", fontSize: 11, cursor: "pointer", borderRadius: lpBody.selectedIdx === i ? 6 : 0 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontFamily: "monospace", color: "#4a4a4a", marginRight: 6 }}>{b.date.slice(5)}</span>
                    <span>{b.weight}kg · {b.muscle}kg · {b.fatPct}%</span>
                  </div>
                  <span style={{ color: "#d4af37", fontFamily: "monospace", fontSize: 10, minWidth: 28, textAlign: "right" }}>{b.score || "—"}</span>
                </div>
                {lpBody.selectedIdx === i && (
                  <div style={{ overflow: "hidden", borderRadius: "0 0 6px 6px", marginBottom: 4 }}>
                    <LongPressActionBar onEdit={() => { lpBody.clear(); startEdit(i); }} onDelete={() => { lpBody.clear(); handleDelete(i); }} onCancel={lpBody.clear} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {bodyLog.length > 3 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", marginTop: 6, paddingTop: 6, textAlign: "center" }}>
            <span onClick={() => setShowAllHistory(!showAllHistory)} style={{ fontSize: 11, color: "#4a8fc9", cursor: "pointer" }}>
              {showAllHistory ? "접기 ▴" : `전체 보기 (${bodyLog.length}건) ▾`}
            </span>
          </div>
        )}
      </div>
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

// 7일 이동 평균 계산
function calcMovingAvg(data, key, window = 7) {
  return data.map((item, idx) => {
    const start = Math.max(0, idx - window + 1);
    const slice = data.slice(start, idx + 1);
    const avg = slice.reduce((s, d) => s + (d[key] || 0), 0) / slice.length;
    return { ...item, [`${key}_ma`]: Math.round(avg * 10) / 10 };
  });
}

// 목표 달성률 게이지 컴포넌트 (터치하여 목표 수정)
function GoalGauge({ label, current, start, target, unit, goodDir, onChangeTarget }) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(String(target));

  // 방향 인식 진행률 계산
  let pct = 0;
  if (goodDir === "down") {
    // 체중, 체지방: 낮아져야 달성 (start → target 감소 방향)
    const totalDrop = start - target;
    if (totalDrop > 0) {
      pct = ((start - current) / totalDrop) * 100;
    }
  } else {
    // 골격근: 높아져야 달성 (start → target 증가 방향)
    const totalGain = target - start;
    if (totalGain > 0) {
      pct = ((current - start) / totalGain) * 100;
    }
  }
  pct = Math.min(Math.max(Math.round(pct), 0), 100);
  const color = pct >= 80 ? "#5a9e6f" : pct >= 40 ? "#d4af37" : "#e05252";

  const r = 50, cx = 60, cy = 58;
  const startAngle = -210, endAngle = 30;
  const range = endAngle - startAngle;
  const angle = startAngle + range * (pct / 100);
  const toRad = (deg) => (deg * Math.PI) / 180;
  const arcPath = (from, to) => {
    const x1 = cx + r * Math.cos(toRad(from));
    const y1 = cy + r * Math.sin(toRad(from));
    const x2 = cx + r * Math.cos(toRad(to));
    const y2 = cy + r * Math.sin(toRad(to));
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const handleSave = () => {
    const v = parseFloat(editVal);
    if (v > 0 && onChangeTarget) onChangeTarget(v);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ textAlign: "center", background: "#252525", border: `1px solid ${color}44`, borderRadius: 16, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>{label} 목표</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 8 }}>
          <input type="number" step="0.1" value={editVal} onChange={e => setEditVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            autoFocus
            style={{ width: 70, padding: "6px 8px", background: "#2a2a2a", border: `1px solid ${color}66`, borderRadius: 6, color, fontSize: 16, fontFamily: "monospace", textAlign: "center" }} />
          <span style={{ fontSize: 12, color: "#707070" }}>{unit}</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setEditing(false)} style={{ flex: 1, padding: 6, background: "#2a2a2a", border: "none", borderRadius: 6, color: "#8a8a8a", fontSize: 11, cursor: "pointer" }}>취소</button>
          <button onClick={handleSave} style={{ flex: 1, padding: 6, background: color, border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>저장</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", cursor: "pointer" }} onClick={() => { setEditVal(String(target)); setEditing(true); }}>
      <svg viewBox="0 0 120 80" style={{ width: 120, height: 80 }}>
        <path d={arcPath(startAngle, endAngle)} fill="none" stroke="#252525" strokeWidth="8" strokeLinecap="round" />
        <path d={arcPath(startAngle, angle)} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#f5f5f0" fontSize="16" fontWeight="500" fontFamily="monospace">{current}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#707070" fontSize="8">{unit}</text>
      </svg>
      <div style={{ fontSize: 11, color: "#707070", marginTop: -4 }}>{label}</div>
      <div style={{ fontSize: 10, fontFamily: "monospace", color }}>{Math.round(pct)}% 달성</div>
      <div style={{ fontSize: 9, color: "#4a4a4a", marginTop: 2 }}>{start}{unit} → 목표 {target}{unit}</div>
    </div>
  );
}
function getWeekKey(ds) { const d = new Date(ds); const day = d.getDay() || 7; d.setDate(d.getDate() + 4 - day); const ys = new Date(d.getFullYear(), 0, 1); return `${d.getFullYear()}-W${String(Math.ceil((((d - ys) / 86400000) + 1) / 7)).padStart(2, "0")}`; }
function getMonthKey(ds) { return ds.slice(0, 7); }
function getYearKey(ds) { return ds.slice(0, 4); }

/* ───── 통계 탭 ───── */
function StatsTab({ bodyLog, allDays, onBackup, goals, onSaveGoals }) {
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

  // 7일 이동 평균 데이터 (체중 & 체지방)
  const movingAvgData = useMemo(() => {
    if (bodyLog.length < 3) return [];
    let data = bodyLog.slice(-60).map(b => ({ d: b.date.slice(5), weight: b.weight, fat: b.fatPct, muscle: b.muscle }));
    data = calcMovingAvg(data, "weight", 7);
    data = calcMovingAvg(data, "fat", 7);
    data = calcMovingAvg(data, "muscle", 7);
    return data;
  }, [bodyLog]);

  // 상관관계 데이터
  const correlationData = useMemo(() => {
    const entries = Object.entries(allDays).sort(([a], [b]) => a.localeCompare(b));
    const carbsVsWeight = [];
    const exVsMuscle = [];

    entries.forEach(([date, dayData]) => {
      const agg = aggregateDay(dayData);
      // 해당 날짜의 체성분 찾기
      const body = bodyLog.find(b => b.date === date);
      if (body && agg.c > 0) {
        carbsVsWeight.push({ carbs: Math.round(agg.c), weight: body.weight, date: date.slice(5) });
      }
      if (body && agg.ex > 0) {
        const totalExMin = (dayData.exercises || []).reduce((s, e) => s + (e.duration || 0), 0);
        if (totalExMin > 0) {
          exVsMuscle.push({ exMin: totalExMin, muscle: body.muscle, date: date.slice(5) });
        }
      }
    });

    // 평균선 계산
    const avgCarbs = carbsVsWeight.length > 0 ? Math.round(carbsVsWeight.reduce((s, d) => s + d.carbs, 0) / carbsVsWeight.length) : 0;
    const avgWeight = carbsVsWeight.length > 0 ? Math.round(carbsVsWeight.reduce((s, d) => s + d.weight, 0) / carbsVsWeight.length * 10) / 10 : 0;
    const avgExMin = exVsMuscle.length > 0 ? Math.round(exVsMuscle.reduce((s, d) => s + d.exMin, 0) / exVsMuscle.length) : 0;
    const avgMuscle = exVsMuscle.length > 0 ? Math.round(exVsMuscle.reduce((s, d) => s + d.muscle, 0) / exVsMuscle.length * 10) / 10 : 0;

    return { carbsVsWeight, exVsMuscle, avgCarbs, avgWeight, avgExMin, avgMuscle };
  }, [allDays, bodyLog]);
  const pBtn = (p) => ({ flex: 1, padding: "8px 10px", fontSize: 12, fontWeight: 500, background: period === p ? THEME.gold : "transparent", color: period === p ? "#141414" : THEME.sub, border: `1px solid ${THEME.borderLight}`, cursor: "pointer", transition: "all 0.15s ease" });
  const sc = (l, v, u, d, good) => (
    <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#707070" }}>{l}</div>
      <div style={{ fontSize: 20, fontWeight: 500, fontFamily: "monospace", marginTop: 4, color: "#f5f5f0" }}>{v}<span style={{ fontSize: 12 }}>{u}</span></div>
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
        <button onClick={() => setPeriod("range")} style={pBtn("range")}>기간</button>
        <button onClick={() => setPeriod("analysis")} style={{ ...pBtn("analysis"), borderRadius: "0 8px 8px 0" }}>분석</button>
      </div>

      {period === "hourly" && (<>
        <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>시간대별 칼로리 섭취</div>
          <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={hourlyData}><XAxis dataKey="hour" tick={{ fill: "#707070", fontSize: 10 }} tickFormatter={h => `${h}시`} interval={2} /><YAxis tick={{ fill: "#707070", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} /><Bar dataKey="kcal" fill="#5a9e6f" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </div>
        <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>시간대별 영양소 분포</div>
          <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={hourlyData}><XAxis dataKey="hour" tick={{ fill: "#707070", fontSize: 10 }} tickFormatter={h => `${h}시`} interval={2} /><YAxis tick={{ fill: "#707070", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="p" stackId="a" fill={COLORS.p} name="단백질" /><Bar dataKey="c" stackId="a" fill={COLORS.c} name="탄수" /><Bar dataKey="f" stackId="a" fill={COLORS.f} name="지방" /></BarChart></ResponsiveContainer></div>
        </div>
      </>)}

      {/* 기간 지정 분석 */}
      {period === "range" && (<>
        <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#707070", marginBottom: 10 }}>기간 선택</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
              style={{ flex: 1, padding: "8px 10px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, fontFamily: "monospace" }} />
            <span style={{ color: "#707070", fontSize: 13 }}>~</span>
            <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
              style={{ flex: 1, padding: "8px 10px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, fontFamily: "monospace" }} />
          </div>
        </div>

        {rangeAnalysis && (<>
          {/* 체성분 변화 비교 */}
          {rangeAnalysis.bodyChange && (
            <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>체성분 변화 ({rangeAnalysis.bodyChange.startDate} → {rangeAnalysis.bodyChange.endDate})</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[
                  { l: "체중", s: rangeAnalysis.bodyChange.startWeight, e: rangeAnalysis.bodyChange.endWeight, d: rangeAnalysis.bodyChange.dWeight, u: "kg", good: rangeAnalysis.bodyChange.dWeight <= 0 },
                  { l: "체지방률", s: rangeAnalysis.bodyChange.startFat, e: rangeAnalysis.bodyChange.endFat, d: rangeAnalysis.bodyChange.dFat, u: "%", good: rangeAnalysis.bodyChange.dFat <= 0 },
                  { l: "골격근량", s: rangeAnalysis.bodyChange.startMuscle, e: rangeAnalysis.bodyChange.endMuscle, d: rangeAnalysis.bodyChange.dMuscle, u: "kg", good: rangeAnalysis.bodyChange.dMuscle >= 0 }
                ].map((x, i) => (
                  <div key={i} style={{ background: "#252525", borderRadius: 8, padding: 12, textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#707070" }}>{x.l}</div>
                    <div style={{ fontSize: 11, color: "#4a4a4a", fontFamily: "monospace", margin: "4px 0" }}>{x.s} → {x.e}{x.u}</div>
                    <div style={{ fontSize: 18, fontWeight: 500, fontFamily: "monospace", color: x.good ? "#5a9e6f" : "#e05252" }}>
                      {x.d >= 0 ? "+" : ""}{x.d.toFixed(1)}{x.u}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 10 }}>
                <span style={{ fontSize: 12, color: "#707070" }}>기록 일수: <span style={{ color: "#f5f5f0", fontFamily: "monospace" }}>{rangeAnalysis.days}일</span></span>
                <span style={{ fontSize: 12, color: "#707070" }}>기간: <span style={{ color: "#f5f5f0", fontFamily: "monospace" }}>{Math.round((new Date(rangeEnd) - new Date(rangeStart)) / 86400000)}일</span></span>
              </div>
            </div>
          )}

          {/* 기간 평균 영양소 */}
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 10 }}>기간 일평균</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {[
                { l: "단백질", v: rangeAnalysis.pAvg, u: "g", c: COLORS.p },
                { l: "탄수", v: rangeAnalysis.cAvg, u: "g", c: COLORS.c },
                { l: "지방", v: rangeAnalysis.fAvg, u: "g", c: COLORS.f },
                { l: "섭취", v: rangeAnalysis.kAvg, u: "", c: "#5a9e6f" },
                { l: "Net", v: rangeAnalysis.netAvg, u: "", c: "#e05252" }
              ].map((x, i) => (
                <div key={i} style={{ background: "#252525", borderRadius: 8, padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#707070" }}>{x.l}</div>
                  <div style={{ fontSize: 16, fontWeight: 500, fontFamily: "monospace", color: x.c, marginTop: 4 }}>{x.v}</div>
                  <div style={{ fontSize: 10, color: "#4a4a4a" }}>{x.u || "kcal"}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 일별 칼로리 추이 */}
          {rangeAnalysis.dailyData.length > 1 && (
            <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>일별 칼로리 추이</div>
              <div style={{ height: 200 }}><ResponsiveContainer><ComposedChart data={rangeAnalysis.dailyData}><XAxis dataKey="d" tick={{ fill: "#707070", fontSize: 9 }} interval={Math.max(0, Math.floor(rangeAnalysis.dailyData.length / 8))} /><YAxis tick={{ fill: "#707070", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="k" fill="#5a9e6f" name="섭취" radius={[2, 2, 0, 0]} /><Line type="monotone" dataKey="net" stroke="#e05252" strokeWidth={2} name="Net" dot={false} /></ComposedChart></ResponsiveContainer></div>
            </div>
          )}

          {/* 일별 영양소 추이 */}
          {rangeAnalysis.dailyData.length > 1 && (
            <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>일별 영양소 추이</div>
              <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={rangeAnalysis.dailyData}><XAxis dataKey="d" tick={{ fill: "#707070", fontSize: 9 }} interval={Math.max(0, Math.floor(rangeAnalysis.dailyData.length / 8))} /><YAxis tick={{ fill: "#707070", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="p" fill={COLORS.p} name="단백질" radius={[2, 2, 0, 0]} /><Bar dataKey="c" fill={COLORS.c} name="탄수" radius={[2, 2, 0, 0]} /><Bar dataKey="f" fill={COLORS.f} name="지방" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </div>
          )}

          {/* 체성분 추이 그래프 */}
          {rangeAnalysis.bodyTrend.length >= 2 && (
            <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>체성분 추이</div>
              <div style={{ height: 200 }}><ResponsiveContainer><LineChart data={rangeAnalysis.bodyTrend}><XAxis dataKey="d" tick={{ fill: "#707070", fontSize: 10 }} /><YAxis yAxisId="l" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: "#707070", fontSize: 10 }} /><YAxis yAxisId="r" orientation="right" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: "#707070", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line yAxisId="l" type="monotone" dataKey="weight" stroke="#4a8fc9" strokeWidth={2} dot={{ r: 2 }} name="체중(kg)" /><Line yAxisId="r" type="monotone" dataKey="fat" stroke="#e05252" strokeWidth={2} dot={{ r: 2 }} name="체지방(%)" /></LineChart></ResponsiveContainer></div>
            </div>
          )}
        </>)}

        {!rangeAnalysis && rangeStart && rangeEnd && (
          <div style={{ textAlign: "center", padding: 24, color: "#4a4a4a", fontSize: 13 }}>해당 기간에 데이터가 없습니다</div>
        )}
        {(!rangeStart || !rangeEnd) && (
          <div style={{ textAlign: "center", padding: 24, color: "#4a4a4a", fontSize: 13 }}>시작일과 종료일을 선택하세요</div>
        )}
      </>)}

      {/* 분석 탭 */}
      {period === "analysis" && (<>
        {/* 목표 달성률 게이지 */}
        {latest && first && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>목표 달성률</div>
            <div style={{ display: "flex", justifyContent: "space-around" }}>
              <GoalGauge label="체중" current={latest.weight} start={first.weight} target={goals.weight || 72} unit="kg" goodDir="down" onChangeTarget={v => onSaveGoals({ ...goals, weight: v })} />
              <GoalGauge label="체지방률" current={latest.fatPct} start={first.fatPct} target={goals.fatPct || 15} unit="%" goodDir="down" onChangeTarget={v => onSaveGoals({ ...goals, fatPct: v })} />
              <GoalGauge label="골격근량" current={latest.muscle} start={first.muscle} target={goals.muscle || 36} unit="kg" goodDir="up" onChangeTarget={v => onSaveGoals({ ...goals, muscle: v })} />
            </div>
            <div style={{ fontSize: 10, color: "#4a4a4a", textAlign: "center", marginTop: 8 }}>게이지를 터치하면 목표를 수정할 수 있어요</div>
          </div>
        )}

        {/* 7일 이동 평균 — 체중 */}
        {movingAvgData.length > 3 && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 4 }}>체중 추이 + 7일 이동 평균</div>
            <div style={{ fontSize: 11, color: "#4a4a4a", marginBottom: 12 }}>실선: 실제값 · 점선: 7일 평균 (추세)</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <ComposedChart data={movingAvgData}>
                  <XAxis dataKey="d" tick={{ fill: "#707070", fontSize: 9 }} interval={Math.max(0, Math.floor(movingAvgData.length / 8))} />
                  <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} tick={{ fill: "#707070", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="weight" stroke="#4a8fc999" strokeWidth={1} dot={{ r: 1.5, fill: "#4a8fc9" }} name="체중(kg)" />
                  <Line type="monotone" dataKey="weight_ma" stroke="#4a8fc9" strokeWidth={2.5} dot={false} strokeDasharray="0" name="7일 평균" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* 7일 이동 평균 — 체지방 & 골격근 */}
        {movingAvgData.length > 3 && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 4 }}>체지방률 & 골격근 추이 + 7일 평균</div>
            <div style={{ fontSize: 11, color: "#4a4a4a", marginBottom: 12 }}>실선: 실제값 · 굵은선: 7일 평균</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <ComposedChart data={movingAvgData}>
                  <XAxis dataKey="d" tick={{ fill: "#707070", fontSize: 9 }} interval={Math.max(0, Math.floor(movingAvgData.length / 8))} />
                  <YAxis yAxisId="l" domain={['dataMin - 0.3', 'dataMax + 0.3']} tick={{ fill: "#707070", fontSize: 10 }} />
                  <YAxis yAxisId="r" orientation="right" domain={['dataMin - 0.3', 'dataMax + 0.3']} tick={{ fill: "#707070", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="l" type="monotone" dataKey="fat" stroke="#e0525299" strokeWidth={1} dot={{ r: 1.5, fill: "#e05252" }} name="체지방(%)" />
                  <Line yAxisId="l" type="monotone" dataKey="fat_ma" stroke="#e05252" strokeWidth={2.5} dot={false} name="체지방 7일평균" />
                  <Line yAxisId="r" type="monotone" dataKey="muscle" stroke="#5a9e6f99" strokeWidth={1} dot={{ r: 1.5, fill: "#5a9e6f" }} name="골격근(kg)" />
                  <Line yAxisId="r" type="monotone" dataKey="muscle_ma" stroke="#5a9e6f" strokeWidth={2.5} dot={false} name="골격근 7일평균" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* 상관관계: 탄수화물 vs 체중 */}
        {correlationData.carbsVsWeight.length > 5 && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 4 }}>탄수화물 섭취 vs 체중 상관관계</div>
            <div style={{ fontSize: 11, color: "#4a4a4a", marginBottom: 12 }}>각 점 = 하루 기록 · 점선 = 평균</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <ScatterChart>
                  <XAxis dataKey="carbs" name="탄수화물" unit="g" tick={{ fill: "#707070", fontSize: 10 }} />
                  <YAxis dataKey="weight" name="체중" unit="kg" domain={['dataMin - 0.5', 'dataMax + 0.5']} tick={{ fill: "#707070", fontSize: 10 }} tickFormatter={v => v.toFixed(1)} />
                  <Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} formatter={(v, n) => [n === "탄수화물" ? v + "g" : v + "kg", n]} />
                  <ReferenceLine x={correlationData.avgCarbs} stroke="#d4af3755" strokeDasharray="4 4" />
                  <ReferenceLine y={correlationData.avgWeight} stroke="#4a8fc955" strokeDasharray="4 4" />
                  <Scatter data={correlationData.carbsVsWeight} fill="#d4af37" fillOpacity={0.6} r={4} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 11, color: "#707070", marginTop: 8, textAlign: "center" }}>평균 탄수 {correlationData.avgCarbs}g · 평균 체중 {correlationData.avgWeight}kg</div>
          </div>
        )}

        {/* 상관관계: 운동 시간 vs 골격근 */}
        {correlationData.exVsMuscle.length > 5 && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 4 }}>운동 시간 vs 골격근량 상관관계</div>
            <div style={{ fontSize: 11, color: "#4a4a4a", marginBottom: 12 }}>각 점 = 하루 기록 · 점선 = 평균</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <ScatterChart>
                  <XAxis dataKey="exMin" name="운동시간" unit="분" tick={{ fill: "#707070", fontSize: 10 }} />
                  <YAxis dataKey="muscle" name="골격근" unit="kg" domain={['dataMin - 0.3', 'dataMax + 0.3']} tick={{ fill: "#707070", fontSize: 10 }} tickFormatter={v => v.toFixed(1)} />
                  <Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} formatter={(v, n) => [n === "운동시간" ? v + "분" : v + "kg", n]} />
                  <ReferenceLine x={correlationData.avgExMin} stroke="#5a9e6f55" strokeDasharray="4 4" />
                  <ReferenceLine y={correlationData.avgMuscle} stroke="#5a9e6f55" strokeDasharray="4 4" />
                  <Scatter data={correlationData.exVsMuscle} fill="#5a9e6f" fillOpacity={0.6} r={4} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 11, color: "#707070", marginTop: 8, textAlign: "center" }}>평균 운동 {correlationData.avgExMin}분 · 평균 골격근 {correlationData.avgMuscle}kg</div>
          </div>
        )}

        {(!movingAvgData.length && !correlationData.carbsVsWeight.length) && (
          <div style={{ textAlign: "center", padding: 40, color: "#4a4a4a", fontSize: 13 }}>데이터가 충분하지 않습니다. 더 많은 기록을 쌓아보세요.</div>
        )}
      </>)}

      {period !== "hourly" && period !== "range" && period !== "analysis" && periodData.length > 0 && (<>
        <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>{period === "week" ? "주간" : period === "month" ? "월간" : "연간"} 칼로리 & Net</div>
          <div style={{ height: 200 }}><ResponsiveContainer><ComposedChart data={periodData}><XAxis dataKey="key" tick={{ fill: "#707070", fontSize: 10 }} tickFormatter={k => k.split("-").slice(-1)[0]} /><YAxis tick={{ fill: "#707070", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="kAvg" fill="#5a9e6f" name="섭취" radius={[3, 3, 0, 0]} /><Bar dataKey="exAvg" fill="#4a8fc9" name="운동" radius={[3, 3, 0, 0]} /><Line type="monotone" dataKey="netAvg" stroke="#e05252" strokeWidth={2} name="Net" dot={{ r: 3 }} /></ComposedChart></ResponsiveContainer></div>
        </div>
        <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>영양소 평균</div>
          <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={periodData}><XAxis dataKey="key" tick={{ fill: "#707070", fontSize: 10 }} tickFormatter={k => k.split("-").slice(-1)[0]} /><YAxis tick={{ fill: "#707070", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="pAvg" fill={COLORS.p} name="단백질" radius={[2, 2, 0, 0]} /><Bar dataKey="cAvg" fill={COLORS.c} name="탄수" radius={[2, 2, 0, 0]} /><Bar dataKey="fAvg" fill={COLORS.f} name="지방" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </div>
      </>)}

      {bodyLog.length >= 2 && period !== "range" && period !== "analysis" && (
        <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>체중 & 체지방 추이</div>
          <div style={{ height: 200 }}><ResponsiveContainer><LineChart data={bodyLog.slice(-30).map(b => ({ d: b.date.slice(5), weight: b.weight, fat: b.fatPct }))}><XAxis dataKey="d" tick={{ fill: "#707070", fontSize: 10 }} /><YAxis yAxisId="l" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: "#707070", fontSize: 10 }} /><YAxis yAxisId="r" orientation="right" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: "#707070", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#252525", border: "1px solid #2a2a2a", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line yAxisId="l" type="monotone" dataKey="weight" stroke="#4a8fc9" strokeWidth={2} dot={{ r: 2 }} name="체중(kg)" /><Line yAxisId="r" type="monotone" dataKey="fat" stroke="#e05252" strokeWidth={2} dot={{ r: 2 }} name="체지방(%)" /></LineChart></ResponsiveContainer></div>
        </div>
      )}

      <button onClick={onBackup} disabled={totalDays === 0}
        style={{ width: "100%", padding: 14, background: totalDays === 0 ? "#2a2a2a" : "#5a9e6f", border: "none", borderRadius: 16, color: "#fff", fontSize: 14, fontWeight: 500, cursor: totalDays === 0 ? "not-allowed" : "pointer", marginTop: 8 }}>
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

  if (checking) return <><GlobalStyles /><div style={{ background: THEME.bg, color: THEME.sub, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>로딩 중...</div></>;
  if (!user) return <><GlobalStyles /><LoginScreen onLogin={handleLogin} /></>;
  return <><GlobalStyles /><MainApp user={user} onLogout={handleLogout} /></>;
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
  const lpMeal = useLongPress(400);
  const lpEx = useLongPress(400);
  const [showManage, setShowManage] = useState(false);
  const [manageTab, setManageTab] = useState("food");
  const [lastBackup, setLastBackup] = useState(null);
  const [justBacked, setJustBacked] = useState(false);
  const [yesterdayData, setYesterdayData] = useState({ meals: [], exercises: [] });
  const [goals, setGoals] = useState({ weight: 72, fatPct: 15, muscle: 36 });
  const [sharedFoods, setSharedFoods] = useState([]);
  const [sharedExercises, setSharedExercises] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  const [aiExLoading, setAiExLoading] = useState(false);
  const [aiExResults, setAiExResults] = useState(null);
  const [aiExError, setAiExError] = useState("");

  const FOOD_DB = useMemo(() => [...DEFAULT_FOODS, ...customFoods], [customFoods]);
  const SHARED_DB = useMemo(() => sharedFoods.filter(f => !FOOD_DB.some(d => d.n === f.n)), [sharedFoods, FOOD_DB]);
  const EX_DB = useMemo(() => [...DEFAULT_EX, ...customEx], [customEx]);
  const SHARED_EX_DB = useMemo(() => sharedExercises.filter(e => !EX_DB.some(d => d.n === e.n)), [sharedExercises, EX_DB]);

  // 어제 날짜 계산
  const getYesterday = useCallback((d) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() - 1);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }, []);

  // 탭 변경 시 Long Press 선택 해제
  useEffect(() => { lpMeal.clear(); lpEx.clear(); }, [tab]);

  // ── 초기 로드: localStorage-first + Firestore 백그라운드 동기화 ──
  useEffect(() => {
    // Phase 1: localStorage에서 즉시 표시 (동기 — 네트워크 대기 없음)
    const local = store.getLocalAll();
    if (local["custom-foods"]) setCustomFoods(local["custom-foods"]);
    if (local["custom-exercises"]) setCustomEx(local["custom-exercises"]);
    if (local["bodylog"]) setBodyLog([...local["bodylog"]].sort((a, b) => a.date.localeCompare(b.date)));
    if (local["lastBackup"]) setLastBackup(local["lastBackup"]);
    if (local["goals"]) setGoals(local["goals"]);
    const localDays = {};
    for (const k in local) { if (k.startsWith("day:")) localDays[k.slice(4)] = local[k]; }
    if (Object.keys(localDays).length > 0) setAllDays(localDays);
    try { const lsf = localStorage.getItem("dt_shared_foods"); if (lsf) setSharedFoods(JSON.parse(lsf)); } catch {}
    try { const lse = localStorage.getItem("dt_shared_exercises"); if (lse) setSharedExercises(JSON.parse(lse)); } catch {}
    setLoaded(true);

    // Phase 2: Firestore 백그라운드 동기화 (ONE getDocs — 네트워크 1회 왕복)
    Promise.all([store.getAllData(), getSharedFoods(), getSharedExercises()]).then(([remote, sf, se]) => {
      if (sf) setSharedFoods(sf);
      if (se) setSharedExercises(se);
      if (!remote || Object.keys(remote).length === 0) return;
      if (remote["custom-foods"]) setCustomFoods(remote["custom-foods"]);
      if (remote["custom-exercises"]) setCustomEx(remote["custom-exercises"]);
      if (remote["bodylog"]) setBodyLog([...remote["bodylog"]].sort((a, b) => a.date.localeCompare(b.date)));
      if (remote["lastBackup"]) setLastBackup(remote["lastBackup"]);
      if (remote["goals"]) setGoals(remote["goals"]);
      const remoteDays = {};
      for (const k in remote) { if (k.startsWith("day:")) remoteDays[k.slice(4)] = remote[k]; }
      if (Object.keys(remoteDays).length > 0) setAllDays(remoteDays);
    }).catch(e => console.error("Sync error:", e));
  }, []);

  // 날짜 변경 시 allDays에서 해당 날 데이터 추출 (Firestore 호출 없음)
  useEffect(() => {
    if (!loaded) return;
    const d = allDays[date];
    setMeals(sortByHour(d?.meals || []));
    setExercises(sortByHour(d?.exercises || []));
    const yd = getYesterday(date);
    const y = allDays[yd];
    setYesterdayData({ meals: y?.meals || [], exercises: y?.exercises || [] });
  }, [date, loaded, allDays, getYesterday]);

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

  const addBody = async (w, muscle, fatPct, score) => {
    const entry = { date, weight: parseFloat(w), muscle: parseFloat(muscle) || 0, fatPct: parseFloat(fatPct) || 0, score: parseInt(score) || 0 };
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
    // 공용 DB에도 저장
    const updated = await addSharedFood({ ...food, source: "manual", addedBy: user.name });
    if (updated) setSharedFoods(updated);
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

  const saveGoals = async (newGoals) => {
    setGoals(newGoals);
    await store.set("goals", newGoals);
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

  // 운동량 기반 동적 탄수화물 목표 (운동 소모의 50%를 탄수로 보충)
  const carbBonus = useMemo(() => Math.round((exTotal * 0.5) / 4), [exTotal]);
  const adjustedC = useMemo(() => TARGETS.c + carbBonus, [TARGETS.c, carbBonus]);

  const filteredFoods = useMemo(() => {
    if (!search.trim()) return [];
    return FOOD_DB.filter(f => f.n.toLowerCase().includes(search.toLowerCase()));
  }, [search, FOOD_DB]);
  const filteredShared = useMemo(() => {
    if (!search.trim()) return [];
    return SHARED_DB.filter(f => f.n.toLowerCase().includes(search.toLowerCase()));
  }, [search, SHARED_DB]);
  const filteredEx = useMemo(() => {
    if (!exSearch.trim()) return [];
    return EX_DB.filter(e => e.n.toLowerCase().includes(exSearch.toLowerCase()));
  }, [exSearch, EX_DB]);
  const filteredSharedEx = useMemo(() => {
    if (!exSearch.trim()) return [];
    return SHARED_EX_DB.filter(e => e.n.toLowerCase().includes(exSearch.toLowerCase()));
  }, [exSearch, SHARED_EX_DB]);

  // AI 음식 분석
  const analyzeFood = async (query) => {
    setAiLoading(true); setAiError(""); setAiResult(null);
    try {
      const res = await fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      if (data.success && data.food) {
        setAiResult(data.food);
      } else {
        setAiError(data.error || "분석 실패");
      }
    } catch (e) {
      setAiError("네트워크 오류 — 온라인 상태를 확인하세요");
    }
    setAiLoading(false);
  };

  // AI 결과 → 식단 추가 + 공용 DB 저장
  const addMealFromAI = (food, q) => {
    const serving = parseFloat(q) || 1;
    const hour = parseInt(mealHour) || nowHour();
    const entry = { ...food, serving, ts: Date.now(), hour, source: "ai" };
    const nm = sortByHour([...meals, entry]);
    setMeals(nm); saveDay(date, nm, exercises);
    // 공용 DB에 저장 (중복 체크 포함)
    addSharedFood({ n: food.n, u: food.u || "1인분", p: food.p, c: food.c, f: food.f, k: food.k, source: "ai", addedBy: user.name }).then(updated => {
      if (updated) setSharedFoods(updated);
    });
    setAiResult(null); setSearch("");
  };

  // AI 운동 분석
  const analyzeExercise = async (query) => {
    setAiExLoading(true); setAiExError(""); setAiExResults(null);
    try {
      const res = await fetch("/api/analyze-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      if (data.success && data.exercises && data.exercises.length > 0) {
        setAiExResults(data.exercises);
      } else {
        setAiExError(data.error || "분석 실패");
      }
    } catch (e) {
      setAiExError("네트워크 오류 — 온라인 상태를 확인하세요");
    }
    setAiExLoading(false);
  };

  // AI 운동 결과 → 운동 추가 + 공용 DB 저장
  const addExerciseFromAI = (ex, min) => {
    const duration = parseInt(min) || 30;
    const kcal = Math.round((ex.m * TARGETS.weight * duration) / 60);
    const hour = parseInt(exHour) || nowHour();
    const entry = { ...ex, duration, kcal, ts: Date.now(), hour, source: "ai" };
    const ne = sortByHour([...exercises, entry]);
    setExercises(ne); saveDay(date, meals, ne);
    // 공용 DB에 저장 (중복 체크 포함)
    addSharedExercise({ n: ex.n, m: ex.m, memo: ex.memo || "", source: "ai", addedBy: user.name }).then(updated => {
      if (updated) setSharedExercises(updated);
    });
    setExSearch(""); setExMin({});
  };

  const tabStyle = (t) => ({
    flex: 1, padding: "14px 0", textAlign: "center", fontSize: 13, fontWeight: 500,
    color: tab === t ? "#d4af37" : "#4a4a4a", background: "none", border: "none",
    borderTop: tab === t ? "2px solid #d4af37" : "2px solid transparent", cursor: "pointer",
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif",
    transition: "color 0.15s ease, border-color 0.15s ease"
  });
  const cs = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };

  if (!loaded) return <div style={{ color: "#888", padding: 40, textAlign: "center" }}>Loading...</div>;

  return (
    <div style={{ background: THEME.bg, color: THEME.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.3px" }}>Daniel Body Plan</div>
          <div style={{ fontSize: 11, color: THEME.gold, fontFamily: "var(--font-mono, monospace)", opacity: 0.7 }}>체지방 {user.targetFat || 15}% · {user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="dbp-btn" onClick={onLogout} style={{ background: THEME.card, border: "1px solid rgba(224,82,82,0.2)", borderRadius: 8, color: "#e05252", padding: "6px 10px", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>OUT</button>
          <button className="dbp-btn" onClick={() => setShowManage(true)} style={{ background: THEME.card, border: `1px solid ${THEME.goldDim}`, borderRadius: 8, color: THEME.gold, padding: "6px 10px", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>DB</button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ background: THEME.card, border: `1px solid ${THEME.borderLight}`, borderRadius: 8, color: THEME.text, padding: "6px 10px", fontSize: 11, fontFamily: "monospace" }} />
        </div>
      </div>

      <div style={{ padding: "16px 20px 80px" }}>
        {/* HOME */}
        {tab === "home" && (<>
          {/* 백업 알림 */}
          {justBacked ? (
            <div style={{ background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 16, padding: 12, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, color: "#5a9e6f", fontWeight: 500 }}>백업 완료</div>
                <div style={{ fontSize: 11, color: "#707070", marginTop: 2 }}>마지막 백업: 오늘</div>
              </div>
              <div style={{ fontSize: 18, color: "#5a9e6f" }}>✓</div>
            </div>
          ) : backupDaysAgo >= 15 && (
            <div onClick={doBackup} style={{ background: "rgba(212,175,55,0.1)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 16, padding: 12, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 13, color: "#d4af37", fontWeight: 500 }}>백업을 해주세요</div>
                <div style={{ fontSize: 11, color: "#707070", marginTop: 2 }}>마지막 백업: {lastBackup ? `${backupDaysAgo}일 전` : "없음"}</div>
              </div>
              <div style={{ background: "#d4af37", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#fff", fontWeight: 500 }}>백업</div>
            </div>
          )}
          <div className="dbp-fade dbp-card" style={cs}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: THEME.sub }}>오늘의 요약</span>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: netKcal > TARGETS.k ? "#e05252" : "#5a9e6f" }}>Net {Math.round(netKcal)} kcal</span>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16 }}>
              {[{ l: "단백질", v: totals.p, t: TARGETS.p, c: COLORS.p }, { l: "탄수", v: totals.c, t: adjustedC, c: COLORS.c, bonus: carbBonus }, { l: "지방", v: totals.f, t: TARGETS.f, c: COLORS.f }].map(x => (
                <div key={x.l} style={{ textAlign: "center" }}>
                  <MiniDonut value={x.v} max={x.t} color={x.c} />
                  <div style={{ fontSize: 11, color: "#707070", marginTop: 4 }}>{x.l}</div>
                  <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 500, color: "#f5f5f0" }}>{x.v}g</div>
                  <div style={{ fontSize: 10, color: "#4a4a4a" }}>/ {x.t}g</div>
                  {x.bonus > 0 && <div style={{ fontSize: 9, color: "#d4af37", fontFamily: "monospace" }}>+{x.bonus}g 운동보충</div>}
                  {x.v > x.t && <div style={{ fontSize: 10, color: "#e05252", fontFamily: "monospace" }}>+{x.v - x.t}g 초과</div>}
                </div>
              ))}
            </div>
            <ProgressBar value={totals.k} max={TARGETS.k} color="#5a9e6f" label="섭취 칼로리" unit="kcal" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "8px 0" }}>
              <span style={{ fontSize: 13, color: "#8a8a8a" }}>운동 소모</span>
              <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 500, color: exTotal > 0 ? "#4a8fc9" : "#4a4a4a" }}>
                -{exTotal.toLocaleString()} kcal
              </span>
            </div>
            <NetCalCard intake={totals.k} exercise={exTotal} />
          </div>
          <div style={cs}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 10 }}>오늘 먹은 것 ({meals.length}건)</div>
            {!meals.length && <div style={{ fontSize: 13, color: "#4a4a4a", textAlign: "center", padding: 16 }}>식단 탭에서 기록 추가</div>}
            {groupMealsByTime(meals).map((group) => {
              const gP = Math.round(group.meals.reduce((s, m) => s + m.p * m.serving, 0));
              const gC = Math.round(group.meals.reduce((s, m) => s + m.c * m.serving, 0));
              const gF = Math.round(group.meals.reduce((s, m) => s + m.f * m.serving, 0));
              const gK = Math.round(group.meals.reduce((s, m) => s + m.k * m.serving, 0));
              return (
                <div key={group.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.meals.length}건)</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "#707070" }}>P{gP} C{gC} F{gF} · {gK}kcal</span>
                  </div>
                  {group.meals.map((m, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 5px 8px", borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 13 }}>
                      <div><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(m.hour || 0).padStart(2, "0")}시</span>{m.n}{m.serving !== 1 && <span style={{ color: "#707070", marginLeft: 4 }}>×{m.serving}</span>}</div>
                      <span style={{ color: "#707070", fontFamily: "monospace", fontSize: 12 }}>{Math.round(m.k * m.serving)}kcal</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={cs}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 10 }}>오늘 운동 ({exercises.length}건)</div>
            {!exercises.length && <div style={{ fontSize: 13, color: "#4a4a4a", textAlign: "center", padding: 16 }}>운동 탭에서 기록 추가</div>}
            {groupExercisesByTime(exercises).map((group) => {
              const gKcal = Math.round(group.items.reduce((s, e) => s + (e.kcal || 0), 0));
              const gMin = group.items.reduce((s, e) => s + (e.duration || 0), 0);
              return (
                <div key={group.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.items.length}건)</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "#707070" }}>{gMin}분 · -{gKcal}kcal</span>
                  </div>
                  {group.items.map((e, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 5px 8px", borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 13 }}>
                      <div><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(e.hour || 0).padStart(2, "0")}시</span>{e.n} · {e.duration}분</div>
                      <span style={{ color: "#4a8fc9", fontFamily: "monospace", fontSize: 12 }}>-{e.kcal}kcal</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>)}

        {/* DIET */}
        {tab === "diet" && (<>
          {/* 시간 선택 (먼저) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: "#1e1e1e", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 13, color: "#707070" }}>식사 시간</span>
            <select value={mealHour} onChange={e => setMealHour(parseInt(e.target.value))}
              style={{ flex: 1, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, fontFamily: "monospace" }}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {h < 4 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁"}</option>
              ))}
            </select>
            <button onClick={() => setMealHour(nowHour())} style={{ padding: "6px 10px", background: "#2a2a2a", border: "none", borderRadius: 6, color: "#8a8a8a", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>지금</button>
          </div>

          {/* 어제 식단 빠른 복사 */}
          {yesterdayData.meals.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#707070", marginBottom: 8 }}>어제 먹은 것</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {[...new Map(yesterdayData.meals.map(m => [m.n + "_" + m.serving, m])).values()].map((m, i) => (
                  <div key={i} onClick={() => copyMealFromYesterday(m)}
                    style={{ background: "#252525", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 20, padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#f5f5f0" }}>
                    <span>{m.n}{m.serving !== 1 ? ` ×${m.serving}` : ""}</span>
                    <span style={{ color: "#4a8fc9", fontSize: 14 }}>+</span>
                  </div>
                ))}
              </div>
              <div onClick={copyAllMealsFromYesterday}
                style={{ background: "rgba(74,143,201,0.08)", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 16, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#4a8fc9", fontWeight: 500 }}>어제 식단 전체 복사</div>
                  <div style={{ fontSize: 11, color: "#707070", marginTop: 2 }}>{yesterdayData.meals.length}건 · {Math.round(yesterdayData.meals.reduce((s, m) => s + m.k * m.serving, 0)).toLocaleString()} kcal</div>
                </div>
                <div style={{ color: "#4a8fc9", fontSize: 18 }}>↓</div>
              </div>
            </div>
          )}

          {/* 검색 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="text" placeholder="음식 검색... (예: 앤티앤스 프레즐 1개)" value={search} onChange={e => { setSearch(e.target.value); setAiResult(null); setAiError(""); }} style={{ flex: 1, padding: "10px 12px", background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box" }} />
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto", marginBottom: 16 }}>
            {/* 1단계: 로컬 DB */}
            {filteredFoods.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#707070", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#5a9e6f" }}></span> 내 DB ({filteredFoods.length})
                </div>
                {filteredFoods.map((f, i) => (
                  <div key={"l"+i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{f.n}</div>
                      <div style={{ fontSize: 11, color: "#707070", fontFamily: "monospace", marginTop: 2 }}>P{f.p} · C{f.c} · F{f.f} · {f.k}kcal</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" step="0.1" min="0.1" placeholder="1" value={qty[i] || ""} onChange={e => setQty({ ...qty, [i]: e.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <button onClick={() => addMeal(f, qty[i] || "1")} style={{ padding: "6px 14px", background: "#4a8fc9", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 2단계: 공용 DB */}
            {filteredShared.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#707070", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#d4af37" }}></span> 공용 DB ({filteredShared.length})
                </div>
                {filteredShared.map((f, i) => (
                  <div key={"s"+i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{f.n} {f.source === "ai" && <span style={{ fontSize: 9, color: "#d4af37", background: "rgba(212,175,55,0.12)", padding: "1px 5px", borderRadius: 4, marginLeft: 4 }}>AI</span>}</div>
                      <div style={{ fontSize: 11, color: "#707070", fontFamily: "monospace", marginTop: 2 }}>P{f.p} · C{f.c} · F{f.f} · {f.k}kcal</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" step="0.1" min="0.1" placeholder="1" value={qty["s"+i] || ""} onChange={e => setQty({ ...qty, ["s"+i]: e.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <button onClick={() => addMeal(f, qty["s"+i] || "1")} style={{ padding: "6px 14px", background: "#d4af37", border: "none", borderRadius: 6, color: "#141414", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 3단계: AI 분석 */}
            {search.trim() && filteredFoods.length === 0 && filteredShared.length === 0 && !aiResult && (
              <div style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 13, color: "#4a4a4a", marginBottom: 12 }}>DB에서 찾을 수 없습니다</div>
                <button
                  onClick={() => analyzeFood(search.trim())}
                  disabled={aiLoading}
                  className="dbp-btn"
                  style={{ padding: "10px 20px", background: aiLoading ? "#252525" : "rgba(212,175,55,0.15)", border: "1px solid rgba(212,175,55,0.3)", borderRadius: 10, color: aiLoading ? "#707070" : "#d4af37", fontSize: 13, fontWeight: 500, cursor: aiLoading ? "wait" : "pointer", marginBottom: 8 }}>
                  {aiLoading ? "AI 분석 중..." : `"${search.trim()}" AI 분석`}
                </button>
                {aiError && <div style={{ fontSize: 12, color: "#e05252", marginTop: 8 }}>{aiError}</div>}
              </div>
            )}

            {/* 검색 결과 있지만 원하는 게 없을 때도 AI 분석 가능 */}
            {search.trim() && (filteredFoods.length > 0 || filteredShared.length > 0) && !aiResult && (
              <div style={{ textAlign: "center", padding: 8 }}>
                <button
                  onClick={() => analyzeFood(search.trim())}
                  disabled={aiLoading}
                  style={{ padding: "6px 14px", background: "transparent", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 8, color: "#d4af37", fontSize: 11, cursor: aiLoading ? "wait" : "pointer" }}>
                  {aiLoading ? "분석 중..." : "원하는 음식이 없나요? AI 분석"}
                </button>
              </div>
            )}

            {/* AI 분석 결과 */}
            {aiResult && (
              <div style={{ background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 16, padding: 16, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#d4af37", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#d4af37" }}></span> AI 분석 결과
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{aiResult.n}</div>
                    <div style={{ fontSize: 12, color: "#707070", fontFamily: "monospace", marginTop: 4 }}>
                      P{aiResult.p} · C{aiResult.c} · F{aiResult.f} · {aiResult.k}kcal
                    </div>
                    <div style={{ fontSize: 10, color: "#4a4a4a", marginTop: 4 }}>공용 DB에 자동 저장됩니다</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" step="0.1" min="0.1" placeholder="1" value={qty["ai"] || ""} onChange={e => setQty({ ...qty, ai: e.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                    <button onClick={() => addMealFromAI(aiResult, qty["ai"] || "1")} style={{ padding: "6px 14px", background: "#d4af37", border: "none", borderRadius: 6, color: "#141414", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                  </div>
                </div>
              </div>
            )}

            {/* 직접 추가 안내 */}
            {search.trim() && !aiLoading && (
              <div style={{ textAlign: "center", padding: 8 }}>
                <button onClick={() => setShowAddFood(true)} style={{ padding: "8px 16px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#707070", fontSize: 12, cursor: "pointer" }}>
                  직접 입력하기
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#707070" }}>오늘 기록 ({meals.length}건)</span>
            {meals.length > 0 && <span style={{ fontSize: 10, color: "#4a4a4a" }}>꾹 눌러서 수정/삭제</span>}
          </div>
          {groupMealsByTime(meals).map((group) => {
            const gP = Math.round(group.meals.reduce((s, m) => s + m.p * m.serving, 0));
            const gC = Math.round(group.meals.reduce((s, m) => s + m.c * m.serving, 0));
            const gF = Math.round(group.meals.reduce((s, m) => s + m.f * m.serving, 0));
            const gK = Math.round(group.meals.reduce((s, m) => s + m.k * m.serving, 0));
            return (
              <div key={group.key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.meals.length}건)</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "#707070" }}>P{gP} C{gC} F{gF} · {gK}kcal</span>
                </div>
                {group.meals.map((m) => (
                  <div key={m._idx}>
                    <div className={`dbp-lp-item ${lpMeal.selectedIdx === m._idx ? "dbp-lp-selected" : ""}`} {...lpMeal.bind(m._idx)} onClick={() => { if (!lpMeal.wasLongPress()) setEditMealIdx(m._idx); }} style={{ ...cs, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: lpMeal.selectedIdx === m._idx ? 0 : 12, borderRadius: lpMeal.selectedIdx === m._idx ? "16px 16px 0 0" : 16, borderBottom: lpMeal.selectedIdx === m._idx ? "none" : cs.border }}>
                      <div style={{ flex: 1 }}><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(m.hour || 0).padStart(2, "0")}시</span><span style={{ fontSize: 13 }}>{m.n}</span><span style={{ color: "#707070", fontSize: 12, marginLeft: 4 }}>×{m.serving}</span><div style={{ fontSize: 11, color: "#4a4a4a", fontFamily: "monospace" }}>P{Math.round(m.p * m.serving)} C{Math.round(m.c * m.serving)} F{Math.round(m.f * m.serving)} · {Math.round(m.k * m.serving)}kcal</div></div>
                      <div style={{ fontSize: 13, color: "#d4af37", fontFamily: "monospace", fontWeight: 500 }}>{Math.round(m.k * m.serving)}</div>
                    </div>
                    {lpMeal.selectedIdx === m._idx && (
                      <div style={{ ...cs, padding: 0, marginTop: 0, borderRadius: "0 0 16px 16px", overflow: "hidden", borderTop: "none" }}>
                        <LongPressActionBar onEdit={() => { lpMeal.clear(); setEditMealIdx(m._idx); }} onDelete={() => { lpMeal.clear(); removeMeal(m._idx); }} onCancel={lpMeal.clear} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </>)}

        {/* EXERCISE */}
        {tab === "exercise" && (<>
          {/* 시간 선택 (먼저) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: "#1e1e1e", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 13, color: "#707070" }}>운동 시간</span>
            <select value={exHour} onChange={e => setExHour(parseInt(e.target.value))}
              style={{ flex: 1, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, fontFamily: "monospace" }}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {h < 4 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁"}</option>
              ))}
            </select>
            <button onClick={() => setExHour(nowHour())} style={{ padding: "6px 10px", background: "#2a2a2a", border: "none", borderRadius: 6, color: "#8a8a8a", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>지금</button>
          </div>

          {/* 어제 운동 빠른 복사 */}
          {yesterdayData.exercises.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#707070", marginBottom: 8 }}>어제 운동</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {yesterdayData.exercises.map((e, i) => (
                  <div key={i} onClick={() => copyExFromYesterday(e)}
                    style={{ background: "#252525", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 20, padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#f5f5f0" }}>
                    <span>{e.n} {e.duration}분</span>
                    <span style={{ color: "#5a9e6f", fontSize: 14 }}>+</span>
                  </div>
                ))}
              </div>
              <div onClick={copyAllExFromYesterday}
                style={{ background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 16, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#5a9e6f", fontWeight: 500 }}>어제 운동 전체 복사</div>
                  <div style={{ fontSize: 11, color: "#707070", marginTop: 2 }}>{yesterdayData.exercises.length}건 · {Math.round(yesterdayData.exercises.reduce((s, e) => s + (e.kcal || 0), 0)).toLocaleString()} kcal</div>
                </div>
                <div style={{ color: "#5a9e6f", fontSize: 18 }}>↓</div>
              </div>
            </div>
          )}

          {/* 검색 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="text" placeholder="운동 검색..." value={exSearch} onChange={e => setExSearch(e.target.value)} style={{ flex: 1, padding: "10px 12px", background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box" }} />
          </div>
          <div style={{ maxHeight: 400, overflowY: "auto", marginBottom: 16 }}>
            {/* 내 DB 결과 */}
            {filteredEx.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#5a9e6f", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#5a9e6f" }}></span> 내 DB ({filteredEx.length})
                </div>
                {filteredEx.map((e, i) => (
                  <div key={i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{e.n}</div>
                      <div style={{ fontSize: 11, color: "#707070" }}>MET {e.m} {e.memo && `· ${e.memo}`}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" min="5" step="5" placeholder="30" value={exMin["db_"+i] || ""} onChange={ev => setExMin({ ...exMin, ["db_"+i]: ev.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <span style={{ fontSize: 11, color: "#4a4a4a" }}>분</span>
                      <button onClick={() => addExercise(e, exMin["db_"+i] || "30")} style={{ padding: "6px 14px", background: "#5a9e6f", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 공용 DB 결과 */}
            {filteredSharedEx.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#4a8fc9", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#4a8fc9" }}></span> 공용 DB ({filteredSharedEx.length})
                </div>
                {filteredSharedEx.map((e, i) => (
                  <div key={i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{e.n} {e.source === "ai" && <span style={{ fontSize: 9, color: "#4a8fc9", background: "rgba(74,143,201,0.12)", padding: "1px 5px", borderRadius: 4, marginLeft: 4 }}>AI</span>}</div>
                      <div style={{ fontSize: 11, color: "#707070" }}>MET {e.m} {e.memo && `· ${e.memo}`}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" min="5" step="5" placeholder="30" value={exMin["sh_"+i] || ""} onChange={ev => setExMin({ ...exMin, ["sh_"+i]: ev.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <span style={{ fontSize: 11, color: "#4a4a4a" }}>분</span>
                      <button onClick={() => addExercise(e, exMin["sh_"+i] || "30")} style={{ padding: "6px 14px", background: "#5a9e6f", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* DB에 없을 때 AI 분석 버튼 */}
            {exSearch.trim() && filteredEx.length === 0 && filteredSharedEx.length === 0 && !aiExResults && (
              <div style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 13, color: "#4a4a4a", marginBottom: 12 }}>DB에서 찾을 수 없습니다</div>
                <button
                  onClick={() => analyzeExercise(exSearch.trim())}
                  disabled={aiExLoading}
                  className="dbp-btn"
                  style={{ padding: "10px 20px", background: aiExLoading ? "#252525" : "rgba(74,143,201,0.15)", border: "1px solid rgba(74,143,201,0.3)", borderRadius: 10, color: aiExLoading ? "#707070" : "#4a8fc9", fontSize: 13, fontWeight: 500, cursor: aiExLoading ? "wait" : "pointer", marginBottom: 8 }}>
                  {aiExLoading ? "AI 분석 중..." : `"${exSearch.trim()}" AI 분석`}
                </button>
                {aiExError && <div style={{ fontSize: 12, color: "#e05252", marginTop: 8 }}>{aiExError}</div>}
              </div>
            )}

            {/* 검색 결과 있지만 원하는 게 없을 때도 AI 분석 가능 */}
            {exSearch.trim() && (filteredEx.length > 0 || filteredSharedEx.length > 0) && !aiExResults && (
              <div style={{ textAlign: "center", padding: 8 }}>
                <button
                  onClick={() => analyzeExercise(exSearch.trim())}
                  disabled={aiExLoading}
                  style={{ padding: "6px 14px", background: "transparent", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 8, color: "#4a8fc9", fontSize: 11, cursor: aiExLoading ? "wait" : "pointer" }}>
                  {aiExLoading ? "분석 중..." : "원하는 운동이 없나요? AI 분석"}
                </button>
              </div>
            )}

            {/* AI 분석 결과 (복수 강도) */}
            {aiExResults && (
              <div style={{ background: "rgba(74,143,201,0.06)", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 16, padding: 16, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#4a8fc9", marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#4a8fc9" }}></span> AI 분석 결과 ({aiExResults.length}개 강도)
                </div>
                {aiExResults.map((ex, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < aiExResults.length - 1 ? "1px solid rgba(74,143,201,0.1)" : "none" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{ex.n}</div>
                      <div style={{ fontSize: 11, color: "#707070", fontFamily: "monospace", marginTop: 2 }}>
                        MET {ex.m} · 30분 시 약 {Math.round((ex.m * TARGETS.weight * 30) / 60)}kcal
                      </div>
                      {ex.memo && <div style={{ fontSize: 10, color: "#4a4a4a", marginTop: 2 }}>{ex.memo}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" min="5" step="5" placeholder="30" value={exMin["ai_"+i] || ""} onChange={ev => setExMin({ ...exMin, ["ai_"+i]: ev.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <span style={{ fontSize: 11, color: "#4a4a4a" }}>분</span>
                      <button onClick={() => { addExerciseFromAI(ex, exMin["ai_"+i] || "30"); setAiExResults(null); }} style={{ padding: "6px 14px", background: "#4a8fc9", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 10, color: "#4a4a4a", marginTop: 8 }}>선택한 운동이 공용 DB에 자동 저장됩니다</div>
              </div>
            )}

            {/* 직접 추가 */}
            {exSearch.trim() && !aiExLoading && (
              <div style={{ textAlign: "center", padding: 8 }}>
                <button onClick={() => setShowAddEx(true)} style={{ padding: "8px 16px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#707070", fontSize: 12, cursor: "pointer" }}>
                  직접 입력하기
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#707070" }}>오늘 운동 (소모: {exTotal}kcal)</span>
            {exercises.length > 0 && <span style={{ fontSize: 10, color: "#4a4a4a" }}>꾹 눌러서 수정/삭제</span>}
          </div>
          {groupExercisesByTime(exercises).map((group) => {
            const gKcal = Math.round(group.items.reduce((s, e) => s + (e.kcal || 0), 0));
            const gMin = group.items.reduce((s, e) => s + (e.duration || 0), 0);
            return (
              <div key={group.key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.items.length}건)</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "#707070" }}>{gMin}분 · -{gKcal}kcal</span>
                </div>
                {group.items.map((e) => (
                  <div key={e._idx}>
                    <div className={`dbp-lp-item ${lpEx.selectedIdx === e._idx ? "dbp-lp-selected" : ""}`} {...lpEx.bind(e._idx)} onClick={() => { if (!lpEx.wasLongPress()) setEditExIdx(e._idx); }} style={{ ...cs, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: lpEx.selectedIdx === e._idx ? 0 : 12, borderRadius: lpEx.selectedIdx === e._idx ? "16px 16px 0 0" : 16, borderBottom: lpEx.selectedIdx === e._idx ? "none" : cs.border }}>
                      <div style={{ flex: 1 }}><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(e.hour || 0).padStart(2, "0")}시</span><span style={{ fontSize: 13 }}>{e.n}</span><span style={{ color: "#707070", fontSize: 12, marginLeft: 4 }}>{e.duration}분</span><div style={{ fontSize: 11, color: "#4a8fc9", fontFamily: "monospace" }}>-{e.kcal} kcal</div></div>
                    </div>
                    {lpEx.selectedIdx === e._idx && (
                      <div style={{ ...cs, padding: 0, marginTop: 0, borderRadius: "0 0 16px 16px", overflow: "hidden", borderTop: "none" }}>
                        <LongPressActionBar onEdit={() => { lpEx.clear(); setEditExIdx(e._idx); }} onDelete={() => { lpEx.clear(); removeExercise(e._idx); }} onCancel={lpEx.clear} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </>)}

        {tab === "body" && <BodyTab bodyLog={bodyLog} addBody={addBody} date={date} onEditBody={editBody} onDeleteBody={deleteBody} user={user} goals={goals} onSaveGoals={saveGoals} allDays={allDays} />}
        {tab === "stats" && <StatsTab bodyLog={bodyLog} allDays={allDays} onBackup={doBackup} goals={goals} onSaveGoals={saveGoals} />}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "rgba(20,20,20,0.95)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderTop: `1px solid ${THEME.border}`, display: "flex", zIndex: 10 }}>
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
          <button onClick={() => setManageTab("food")} style={{ flex: 1, padding: 10, fontSize: 13, fontWeight: 500, background: manageTab === "food" ? "#d4af37" : "#2a2a2a", color: manageTab === "food" ? "#141414" : "#8a8a8a", border: "none", cursor: "pointer", borderRadius: "8px 0 0 8px" }}>음식 ({FOOD_DB.length})</button>
          <button onClick={() => setManageTab("ex")} style={{ flex: 1, padding: 10, fontSize: 13, fontWeight: 500, background: manageTab === "ex" ? "#d4af37" : "#2a2a2a", color: manageTab === "ex" ? "#141414" : "#8a8a8a", border: "none", cursor: "pointer", borderRadius: "0 8px 8px 0" }}>운동 ({EX_DB.length})</button>
        </div>
        {manageTab === "food" && (<>
          <button onClick={() => { setShowManage(false); setShowAddFood(true); }} style={{ width: "100%", padding: 10, background: "#d4af37", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer", marginBottom: 12 }}>+ 새 음식 추가</button>
          {customFoods.length > 0 && <div style={{ fontSize: 12, color: "#d4af37", marginBottom: 8 }}>직접 추가 ({customFoods.length}개)</div>}
          {customFoods.map((f, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
              <div><div style={{ fontWeight: 500 }}>{f.n}</div><div style={{ fontSize: 11, color: "#707070", fontFamily: "monospace" }}>P{f.p} C{f.c} F{f.f} · {f.k}kcal</div></div>
              <button onClick={() => deleteCustomFood(i)} style={{ padding: "4px 10px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 11, cursor: "pointer" }}>삭제</button>
            </div>
          ))}
          <div style={{ fontSize: 12, color: "#4a4a4a", marginTop: 12 }}>기본 DB ({DEFAULT_FOODS.length}개)는 삭제 불가</div>
        </>)}
        {manageTab === "ex" && (<>
          <button onClick={() => { setShowManage(false); setShowAddEx(true); }} style={{ width: "100%", padding: 10, background: "#d4af37", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer", marginBottom: 12 }}>+ 새 운동 추가</button>
          {customEx.length > 0 && <div style={{ fontSize: 12, color: "#d4af37", marginBottom: 8 }}>직접 추가 ({customEx.length}개)</div>}
          {customEx.map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
              <div><div style={{ fontWeight: 500 }}>{e.n}</div><div style={{ fontSize: 11, color: "#707070" }}>MET {e.m}</div></div>
              <button onClick={() => deleteCustomEx(i)} style={{ padding: "4px 10px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 11, cursor: "pointer" }}>삭제</button>
            </div>
          ))}
          <div style={{ fontSize: 12, color: "#4a4a4a", marginTop: 12 }}>기본 DB ({DEFAULT_EX.length}개)는 삭제 불가</div>
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
