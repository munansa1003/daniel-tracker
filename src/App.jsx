import { useState, useEffect, useCallback, useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar, ComposedChart, Legend } from "recharts";
import store, { getCurrentUserId, setUserId } from "./store.js";
import { DEFAULT_FOODS, DEFAULT_EX, TARGETS as DEFAULT_TARGETS, COLORS } from "./data.js";

const today = () => new Date().toISOString().slice(0, 10);
const nowHour = () => new Date().getHours();

// 체중 기반 목표 단탄지 계산 (Mifflin-St Jeor, 활동계수 1.55, 20% 적자)
function calcTargets(weight) {
  const bmr = 10 * weight + 6.25 * 175 - 5 * 35 + 5;
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
function StatsTab({ bodyLog, allDays }) {
  const [period, setPeriod] = useState("week");

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

  const exportCSV = useCallback(() => {
    const rows = [];
    rows.push(["=== 일별 요약 ==="]); rows.push(["날짜", "P(g)", "C(g)", "F(g)", "K(kcal)", "운동(kcal)", "Net(kcal)"]);
    Object.entries(allDays).sort().forEach(([d, data]) => { const a = aggregateDay(data); rows.push([d, Math.round(a.p), Math.round(a.c), Math.round(a.f), Math.round(a.k), Math.round(a.ex), Math.round(a.net)]); });
    rows.push([]); rows.push(["=== 식단 상세 ==="]); rows.push(["날짜", "시간", "음식", "수량", "P(g)", "C(g)", "F(g)", "K(kcal)"]);
    Object.entries(allDays).sort().forEach(([d, data]) => (data.meals || []).forEach(m => rows.push([d, `${String(m.hour || 0).padStart(2, "0")}:00`, m.n, m.serving, (m.p * m.serving).toFixed(1), (m.c * m.serving).toFixed(1), (m.f * m.serving).toFixed(1), Math.round(m.k * m.serving)])));
    rows.push([]); rows.push(["=== 운동 상세 ==="]); rows.push(["날짜", "시간", "운동", "시간(분)", "소모(kcal)", "MET"]);
    Object.entries(allDays).sort().forEach(([d, data]) => (data.exercises || []).forEach(e => rows.push([d, `${String(e.hour || 0).padStart(2, "0")}:00`, e.n, e.duration, e.kcal, e.m])));
    rows.push([]); rows.push(["=== 체성분 ==="]); rows.push(["날짜", "체중(kg)", "골격근량(kg)", "체지방률(%)"]);
    bodyLog.forEach(b => rows.push([b.date, b.weight, b.muscle, b.fatPct]));
    const csv = "\uFEFF" + rows.map(r => r.map(v => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `daniel_tracker_${today()}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [allDays, bodyLog]);

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
        <button onClick={() => setPeriod("hourly")} style={{ ...pBtn("hourly"), borderRadius: "0 8px 8px 0" }}>시간대</button>
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

      {period !== "hourly" && periodData.length > 0 && (<>
        <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>{period === "week" ? "주간" : period === "month" ? "월간" : "연간"} 칼로리 & Net</div>
          <div style={{ height: 200 }}><ResponsiveContainer><ComposedChart data={periodData}><XAxis dataKey="key" tick={{ fill: "#787570", fontSize: 10 }} tickFormatter={k => k.split("-").slice(-1)[0]} /><YAxis tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="kAvg" fill="#5a9e6f" name="섭취" radius={[3, 3, 0, 0]} /><Bar dataKey="exAvg" fill="#4a8fc9" name="운동" radius={[3, 3, 0, 0]} /><Line type="monotone" dataKey="netAvg" stroke="#e05252" strokeWidth={2} name="Net" dot={{ r: 3 }} /></ComposedChart></ResponsiveContainer></div>
        </div>
        <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>영양소 평균</div>
          <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={periodData}><XAxis dataKey="key" tick={{ fill: "#787570", fontSize: 10 }} tickFormatter={k => k.split("-").slice(-1)[0]} /><YAxis tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="pAvg" fill={COLORS.p} name="단백질" radius={[2, 2, 0, 0]} /><Bar dataKey="cAvg" fill={COLORS.c} name="탄수" radius={[2, 2, 0, 0]} /><Bar dataKey="fAvg" fill={COLORS.f} name="지방" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </div>
      </>)}

      {bodyLog.length >= 2 && (
        <div style={{ background: "#191919", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 12 }}>체중 & 체지방 추이</div>
          <div style={{ height: 200 }}><ResponsiveContainer><LineChart data={bodyLog.slice(-30).map(b => ({ d: b.date.slice(5), weight: b.weight, fat: b.fatPct }))}><XAxis dataKey="d" tick={{ fill: "#787570", fontSize: 10 }} /><YAxis yAxisId="l" tick={{ fill: "#787570", fontSize: 10 }} /><YAxis yAxisId="r" orientation="right" tick={{ fill: "#787570", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#222", border: "1px solid #333", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line yAxisId="l" type="monotone" dataKey="weight" stroke="#4a8fc9" strokeWidth={2} dot={{ r: 2 }} name="체중(kg)" /><Line yAxisId="r" type="monotone" dataKey="fat" stroke="#e05252" strokeWidth={2} dot={{ r: 2 }} name="체지방(%)" /></LineChart></ResponsiveContainer></div>
        </div>
      )}

      <button onClick={exportCSV} disabled={totalDays === 0}
        style={{ width: "100%", padding: 14, background: totalDays === 0 ? "#333" : "#5a9e6f", border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 500, cursor: totalDays === 0 ? "not-allowed" : "pointer", marginTop: 8 }}>
        {totalDays === 0 ? "데이터 없음" : "📥 CSV로 내보내기 (엑셀 호환)"}
      </button>
    </>
  );
}

/* ═══════════════════════════════════════════════ */
/*                    MAIN APP                     */
/* ═══════════════════════════════════════════════ */
export default function App() {
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
  const [showSync, setShowSync] = useState(false);
  const [syncId, setSyncId] = useState("");
  const [editMealIdx, setEditMealIdx] = useState(null);
  const [editExIdx, setEditExIdx] = useState(null);
  const [showManage, setShowManage] = useState(false);
  const [manageTab, setManageTab] = useState("food");

  const FOOD_DB = useMemo(() => [...DEFAULT_FOODS, ...customFoods], [customFoods]);
  const EX_DB = useMemo(() => [...DEFAULT_EX, ...customEx], [customEx]);

  // 초기 로드 (Firebase 비동기)
  useEffect(() => {
    async function loadAll() {
      try {
        const cf = await store.get("custom-foods");
        if (cf) setCustomFoods(cf);
        const ce = await store.get("custom-exercises");
        if (ce) setCustomEx(ce);
        const body = await store.get("bodylog");
        if (body) setBodyLog(body);

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

  // 날짜 변경 시 해당 날 데이터 로드
  useEffect(() => {
    async function loadDay() {
      try {
        const data = await store.get(`day:${date}`);
        if (data) { setMeals(data.meals || []); setExercises(data.exercises || []); }
        else { setMeals([]); setExercises([]); }
      } catch { setMeals([]); setExercises([]); }
    }
    if (loaded) loadDay();
  }, [date, loaded]);

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
    const nl = bodyLog.map((b, i) => i === idx ? { ...b, ...updated } : b);
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

  // 동기화 ID 적용
  const applySyncId = () => {
    if (syncId.trim()) {
      setUserId(syncId.trim());
      window.location.reload();
    }
  };

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
    return calcTargets(avgWeight);
  }, [bodyLog, date]);

  const totals = useMemo(() => {
    let p = 0, c = 0, f = 0, k = 0;
    meals.forEach(m => { const s = m.serving; p += m.p * s; c += m.c * s; f += m.f * s; k += m.k * s; });
    return { p: Math.round(p), c: Math.round(c), f: Math.round(f), k: Math.round(k) };
  }, [meals]);
  const exTotal = useMemo(() => exercises.reduce((s, e) => s + (e.kcal || 0), 0), [exercises]);
  const netKcal = totals.k - exTotal;

  const filteredFoods = useMemo(() => {
    if (!search.trim()) return FOOD_DB.slice(0, 25);
    return FOOD_DB.filter(f => f.n.toLowerCase().includes(search.toLowerCase()));
  }, [search, FOOD_DB]);
  const filteredEx = useMemo(() => {
    if (!exSearch.trim()) return EX_DB;
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
          <div style={{ fontSize: 18, fontWeight: 600 }}>Daniel Tracker</div>
          <div style={{ fontSize: 11, color: "#787570", fontFamily: "monospace" }}>목표 체지방 15% · 기준 {TARGETS.weight}kg ({date.slice(0, 7)}월 평균)</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => setShowSync(true)} style={{ background: "#222", border: "1px solid rgba(90,158,111,0.3)", borderRadius: 6, color: "#5a9e6f", padding: "6px 10px", fontSize: 11, cursor: "pointer" }}>동기화</button>
          <button onClick={() => setShowManage(true)} style={{ background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#aaa", padding: "6px 10px", fontSize: 11, cursor: "pointer" }}>DB관리</button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", padding: "6px 10px", fontSize: 12, fontFamily: "monospace" }} />
        </div>
      </div>

      <div style={{ padding: "16px 20px 80px" }}>
        {/* HOME */}
        {tab === "home" && (<>
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
          </div>
          <div style={cs}>
            <div style={{ fontSize: 13, color: "#787570", marginBottom: 10 }}>오늘 먹은 것 ({meals.length}건)</div>
            {!meals.length && <div style={{ fontSize: 13, color: "#555", textAlign: "center", padding: 16 }}>식단 탭에서 기록 추가</div>}
            {meals.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
                <div><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(m.hour || 0).padStart(2, "0")}시</span>{m.n}{m.serving !== 1 && <span style={{ color: "#787570", marginLeft: 4 }}>×{m.serving}</span>}</div>
                <span style={{ color: "#787570", fontFamily: "monospace", fontSize: 12 }}>{Math.round(m.k * m.serving)}kcal</span>
              </div>
            ))}
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
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="text" placeholder="음식 검색..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, padding: "10px 12px", background: "#191919", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#e8e4dc", fontSize: 14, boxSizing: "border-box" }} />
            <button onClick={() => setShowAddFood(true)} style={{ padding: "10px 16px", background: "#d4943a", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ 새 음식</button>
          </div>
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
          <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: 16 }}>
            {filteredFoods.map((f, i) => (
              <div key={i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{f.n}{f.custom && <span style={{ marginLeft: 6, fontSize: 10, color: "#d4943a", background: "rgba(212,148,58,0.12)", padding: "1px 6px", borderRadius: 4 }}>직접추가</span>}</div>
                  <div style={{ fontSize: 11, color: "#787570", fontFamily: "monospace", marginTop: 2 }}>P{f.p} · C{f.c} · F{f.f} · {f.k}kcal</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" step="0.1" min="0.1" placeholder="1" value={qty[i] || ""} onChange={e => setQty({ ...qty, [i]: e.target.value })} style={{ width: 50, padding: "6px 8px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 13, textAlign: "center" }} />
                  <button onClick={() => addMeal(f, qty[i] || "1")} style={{ padding: "6px 14px", background: "#4a8fc9", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                </div>
              </div>
            ))}
            {!filteredFoods.length && <div style={{ textAlign: "center", padding: 24, color: "#555", fontSize: 13 }}>검색 결과 없음<br /><button onClick={() => setShowAddFood(true)} style={{ marginTop: 8, padding: "8px 16px", background: "#d4943a", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, cursor: "pointer" }}>직접 추가</button></div>}
          </div>
          <div style={{ fontSize: 13, color: "#787570", marginBottom: 8 }}>오늘 기록 ({meals.length}건)</div>
          {meals.map((m, i) => (
            <div key={i} style={{ ...cs, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setEditMealIdx(i)}><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(m.hour || 0).padStart(2, "0")}시</span><span style={{ fontSize: 13 }}>{m.n}</span><span style={{ color: "#787570", fontSize: 12, marginLeft: 4 }}>×{m.serving}</span><div style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>P{Math.round(m.p * m.serving)} C{Math.round(m.c * m.serving)} F{Math.round(m.f * m.serving)} · {Math.round(m.k * m.serving)}kcal</div></div>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setEditMealIdx(i)} style={{ padding: "4px 10px", background: "rgba(74,143,201,0.15)", border: "1px solid rgba(74,143,201,0.3)", borderRadius: 6, color: "#4a8fc9", fontSize: 12, cursor: "pointer" }}>수정</button>
                <button onClick={() => removeMeal(i)} style={{ padding: "4px 10px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 12, cursor: "pointer" }}>삭제</button>
              </div>
            </div>
          ))}
        </>)}

        {/* EXERCISE */}
        {tab === "exercise" && (<>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="text" placeholder="운동 검색..." value={exSearch} onChange={e => setExSearch(e.target.value)} style={{ flex: 1, padding: "10px 12px", background: "#191919", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#e8e4dc", fontSize: 14, boxSizing: "border-box" }} />
            <button onClick={() => setShowAddEx(true)} style={{ padding: "10px 16px", background: "#d4943a", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ 새 운동</button>
          </div>
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
          <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: 16 }}>
            {filteredEx.map((e, i) => (
              <div key={i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{e.n}{e.custom && <span style={{ marginLeft: 6, fontSize: 10, color: "#d4943a", background: "rgba(212,148,58,0.12)", padding: "1px 6px", borderRadius: 4 }}>직접추가</span>}</div>
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
        {tab === "stats" && <StatsTab bodyLog={bodyLog} allDays={allDays} />}
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

      {/* Sync Modal */}
      <Modal open={showSync} onClose={() => setShowSync(false)} title="기기 간 동기화">
        <div style={{ background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 8, padding: 14, marginBottom: 16, fontSize: 13, lineHeight: 1.7, color: "#e8e4dc" }}>
          데이터는 Firebase 클라우드에 자동 저장됩니다.<br/>
          다른 기기에서 같은 데이터를 보려면 아래 동기화 ID를 복사해서 다른 기기에 입력하세요.
        </div>

        <div style={{ fontSize: 12, color: "#787570", marginBottom: 6 }}>나의 동기화 ID</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input readOnly value={getCurrentUserId()} style={{ flex: 1, padding: "10px 12px", background: "#222", border: "1px solid rgba(90,158,111,0.3)", borderRadius: 6, color: "#5a9e6f", fontSize: 14, fontFamily: "monospace", boxSizing: "border-box" }} />
          <button onClick={() => { navigator.clipboard.writeText(getCurrentUserId()); alert("복사됨!"); }}
            style={{ padding: "10px 16px", background: "#5a9e6f", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>복사</button>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: "#787570", marginBottom: 6 }}>다른 기기의 ID 입력 (데이터 가져오기)</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input value={syncId} onChange={e => setSyncId(e.target.value)} placeholder="예: user_a1b2c3d4"
              style={{ flex: 1, padding: "10px 12px", background: "#222", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "#e8e4dc", fontSize: 14, fontFamily: "monospace", boxSizing: "border-box" }} />
            <button onClick={applySyncId} disabled={!syncId.trim()}
              style={{ padding: "10px 16px", background: syncId.trim() ? "#4a8fc9" : "#333", border: "none", borderRadius: 6, color: syncId.trim() ? "#fff" : "#666", fontSize: 13, fontWeight: 500, cursor: syncId.trim() ? "pointer" : "not-allowed" }}>적용</button>
          </div>
          <div style={{ fontSize: 11, color: "#e05252", lineHeight: 1.6 }}>
            ⚠ ID를 적용하면 페이지가 새로고침되며, 해당 ID의 데이터로 전환됩니다.
          </div>
        </div>
      </Modal>
    </div>
  );
}
