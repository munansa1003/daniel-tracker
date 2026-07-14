import { useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import store, { getCurrentUserId } from "../store.js";
import { isCompletedDay } from "../utils.js";
import { bodyMetrics } from "../bodyMetrics.js";
import { useLongPress } from "../hooks/useLongPress.js";
import { useOrientation } from "../hooks/useOrientation.js";
import { LongPressActionBar } from "./LongPressActionBar.jsx";
import { ProgressPhotos } from "./ProgressPhotos.jsx";

export function BodyTab({ bodyLog, addBody, date, onEditBody, onDeleteBody, user, goals, onSaveGoals, allDays }) {
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
  const _cachedCoach = useMemo(() => {
    try { const uid = getCurrentUserId(); return JSON.parse(localStorage.getItem("dt_" + uid + "_body-coaching") || "null"); } catch { return null; }
  }, []);
  const [coaching, setCoaching] = useState(_cachedCoach?.text || "");
  const [coachDate, setCoachDate] = useState(_cachedCoach?.latestDate || "");
  const [coachLoading, setCoachLoading] = useState(false);
  const [showCoachToast, setShowCoachToast] = useState(false);
  const [toastChanges, setToastChanges] = useState(null);
  const [chartTab, setChartTab] = useState("weight");
  const [chartPeriod, setChartPeriod] = useState(30); // 7 | 30 | 90 | 9999(전체) — 날짜(일) 기준
  const [showAllHistory, setShowAllHistory] = useState(false);
  const lpBody = useLongPress(400);
  const landscape = useOrientation();

  // 변화 감지 시 토스트 표시 (자동 AI 호출 대신)
  const checkAndShowToast = (newBodyLog) => {
    if (newBodyLog.length < 10) return;
    const sorted = [...newBodyLog].sort((a, b) => a.date.localeCompare(b.date));
    const recent7 = sorted.slice(-7);
    const prev7 = sorted.slice(-14, -7);
    if (prev7.length < 5 || recent7.length < 5) return;

    const avg = (arr, key) => arr.reduce((s, v) => s + (v[key] || 0), 0) / arr.length;
    const rW = avg(recent7, "weight"), pW = avg(prev7, "weight");
    const rM = avg(recent7, "muscle"), pM = avg(prev7, "muscle");
    const rF = avg(recent7, "fatPct"), pF = avg(prev7, "fatPct");

    const dW = Math.round((rW - pW) * 10) / 10;
    const dM = Math.round((rM - pM) * 10) / 10;
    const dF = Math.round((rF - pF) * 10) / 10;

    const thresholds = { weight: 0.5, muscle: 0.3, fatPct: 0.7 };
    const changes = [];
    if (Math.abs(dW) >= thresholds.weight) changes.push({ label: "체중", val: dW, unit: "kg" });
    if (Math.abs(dM) >= thresholds.muscle) changes.push({ label: "골격근", val: dM, unit: "kg" });
    if (Math.abs(dF) >= thresholds.fatPct) changes.push({ label: "체지방률", val: dF, unit: "%" });

    if (changes.length > 0) {
      setToastChanges(changes);
      setShowCoachToast(true);
    }
  };

  const existing = bodyLog.find(b => b.date === date);
  const latest = bodyLog[bodyLog.length - 1];
  const prev = bodyLog.length >= 2 ? bodyLog[bodyLog.length - 2] : null;
  const ht = user?.height || 175;
  const age = user?.age || 35;
  const is = { width: "100%", padding: "10px 12px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box", marginBottom: 8 };

  // 체성분 파생 지표 — 순수 함수로 추출됨(bodyMetrics.js), 골든셋이 값을 고정
  const { bmi, bmr, fatMass, leanMass, weightAdj, stdWeight, stdMuscle, stdFatPct, dW, dM, dF, dS } =
    bodyMetrics(latest, prev, { height: ht, age });

  // 차트 데이터 — 기간(일) 기준 필터 + 날짜 비례 X축(ts: epoch ms)
  const chartData = useMemo(() => {
    let rows = bodyLog;
    if (chartPeriod < 9999 && bodyLog.length > 0) {
      const lastDate = bodyLog[bodyLog.length - 1].date;
      const from = new Date(lastDate);
      from.setDate(from.getDate() - chartPeriod);
      const fromStr = from.toISOString().slice(0, 10);
      rows = bodyLog.filter(b => b.date >= fromStr);
    }
    return rows.map(b => ({
      d: b.date.slice(5),
      ts: new Date(b.date).getTime(),
      weight: b.weight,
      muscle: b.muscle,
      fatPct: b.fatPct,
      score: b.score || 0
    }));
  }, [bodyLog, chartPeriod]);

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
  // 오늘 체성분을 측정한 경우(latest.date===오늘) 오늘 partial 데이터가 평균을 왜곡하므로 제외
  // 이 요약은 AI 체성분 코칭 API 입력으로도 사용되므로 정확도/비용 모두 영향
  const periodSummary = useMemo(() => {
    if (!prev || !latest || !allDays) return null;
    const entries = Object.entries(allDays).filter(([d]) => d > prev.date && d <= latest.date && isCompletedDay(d));
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
    const entry = { date, weight: parseFloat(w), muscle: parseFloat(m) || 0, fatPct: parseFloat(fp) || 0, score: parseInt(sc) || 0 };
    const newLog = [...bodyLog.filter(b => b.date !== date), entry].sort((a, b) => a.date.localeCompare(b.date));
    addBody(w, m, fp, sc);
    setW(""); setM(""); setFp(""); setSc(""); setShowForm(false);
    // 저장 후 변화 감지 → 토스트 표시
    setTimeout(() => checkAndShowToast(newLog), 300);
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
  const adjustGoal = (key, delta) => { if (onSaveGoals && goals) { const v = Math.round(((goals[key] || 0) + delta) * 10) / 10; if (v > 0) onSaveGoals({ ...goals, [key]: v }); } };

  const displayHistory = showAllHistory ? bodyLog.slice(-30).reverse() : bodyLog.slice(-3).reverse();

  // ── 카드 JSX 추출 (가로/세로 재배치용 — 카드 내부 코드·조건부 렌더 조건 무변경) ──

  // 전용 버튼 제거 — 기록/수정은 아래 최신 카드에 녹임. 단, 기록이 0건일 때만 시작 버튼
  const startButton = !showForm && !latest && (
    <div style={{ marginBottom: 10 }}>
      <button onClick={() => setShowForm(true)}
        style={{ width: "100%", padding: 12, background: "#4a8fc9", border: "none", borderRadius: 12, color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
        ＋ 체성분 기록 시작
      </button>
    </div>
  );

  const formCard = showForm && (
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
        <button onClick={handleSave} disabled={!w} style={{ flex: 2, padding: 10, background: w ? "#4a8fc9" : "#2a2a2a", border: "none", borderRadius: 8, color: w ? "#fff" : "#666", fontSize: 13, fontWeight: 500, cursor: w ? "pointer" : "not-allowed" }}>저장</button>
      </div>
    </div>
  );

  // 변화 감지 토스트
  const toastCard = showCoachToast && toastChanges && (
    <div style={{ background: "rgba(212,175,55,0.1)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 12, padding: 12, marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(212,175,55,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 14 }}>✦</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: "#d4af37", fontWeight: 500 }}>유의미한 변화 감지!</div>
        <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>{toastChanges.map(c => `${c.label} ${c.val > 0 ? "+" : ""}${c.val}${c.unit}`).join(", ")} (7일 기준)</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        <span onClick={() => { if (latest) { fetchCoaching(latest, prev); setShowCoachToast(false); } }}
          style={{ background: "#d4af37", color: "#141414", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 10, fontWeight: 500, cursor: "pointer", textAlign: "center" }}>코칭 받기</span>
        <span onClick={() => setShowCoachToast(false)}
          style={{ fontSize: 9, color: "#555", cursor: "pointer", textAlign: "center" }}>닫기</span>
      </div>
    </div>
  );

  // 점수 + BMI/BMR + 막대그래프
  const summaryCard = latest && (
    <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 10 }}>
      {!existing && !showForm && (
        <div onClick={() => setShowForm(true)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: "rgba(74,143,201,0.08)", borderBottom: "1px solid rgba(74,143,201,0.15)", borderRadius: "16px 16px 0 0", margin: "-16px -16px 12px", fontSize: 12.5, color: "#4a8fc9", fontWeight: 500, cursor: "pointer" }}>
          <span>＋ {date} 체성분 기록</span><span>›</span>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 10, color: "#707070" }}>{latest.date}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 28, fontWeight: 500, color: "#d4af37" }}>{latest.score || "—"}</span>
            <span style={{ fontSize: 11, color: "#707070" }}>점</span>
            {dS !== null && dS !== 0 && <span style={{ background: dS > 0 ? "rgba(90,158,111,0.15)" : "rgba(224,82,82,0.15)", color: dS > 0 ? "#5a9e6f" : "#e05252", fontSize: 10, padding: "1px 6px", borderRadius: 4 }}>{chgSign(dS)}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {existing && !showForm && <div onClick={() => setShowForm(true)} style={{ width: 28, height: 28, borderRadius: 8, background: "#252525", border: "1px solid rgba(74,143,201,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#4a8fc9", cursor: "pointer", marginRight: 2 }}>✎</div>}
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
  );

  // 추이 차트 (탭 전환 + 기간 선택 + 날짜 비례 X축) — 가로모드에서는 높이만 130→200
  const chartCard = latest && bodyLog.length >= 2 && (
    <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {Object.entries(chartConfig).map(([key, cfg]) => (
          <div key={key} onClick={() => setChartTab(key)}
            style={{ flex: 1, textAlign: "center", padding: 6, background: chartTab === key ? cfg.color : "#252525", borderRadius: 6, fontSize: 11, fontWeight: chartTab === key ? 500 : 400, color: chartTab === key ? "#fff" : "#707070", cursor: "pointer", transition: "all 0.2s" }}>
            {cfg.label}
          </div>
        ))}
      </div>
      {/* 기간 선택 */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {[{ v: 7, l: "1주" }, { v: 30, l: "1개월" }, { v: 90, l: "3개월" }, { v: 9999, l: "전체" }].map(p => (
          <div key={p.v} onClick={() => setChartPeriod(p.v)}
            style={{ flex: 1, textAlign: "center", padding: 5, background: chartPeriod === p.v ? "rgba(255,255,255,0.08)" : "transparent", border: `1px solid ${chartPeriod === p.v ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.04)"}`, borderRadius: 6, fontSize: 10, fontWeight: chartPeriod === p.v ? 500 : 400, color: chartPeriod === p.v ? "#f5f5f0" : "#707070", cursor: "pointer", transition: "all 0.2s" }}>
            {p.l}
          </div>
        ))}
      </div>
      {chartData.length >= 2 ? (
        <ResponsiveContainer width="100%" height={landscape ? 200 : 130}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]}
              tickFormatter={(t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; }}
              tick={{ fill: "#4a4a4a", fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "#4a4a4a", fontSize: 9 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#252525", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, color: "#f5f5f0" }} formatter={(v) => [v + cc.unit, cc.label]} labelFormatter={(t) => new Date(t).toISOString().slice(0, 10)} labelStyle={{ color: "#707070" }} />
            <Line type="monotone" dataKey={cc.key} stroke={cc.color} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: cc.color }} />
            {cc.target && <ReferenceLine y={cc.target} stroke="#d4af37" strokeDasharray="4 3" strokeWidth={1} label={{ value: `목표 ${cc.target}`, fill: "#d4af37", fontSize: 9, position: "insideTopRight" }} />}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height: landscape ? 200 : 130, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#4a4a4a" }}>이 기간에는 측정 기록이 부족합니다</div>
      )}
      {chartStats && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#4a4a4a", marginTop: 4 }}>
          <span>최고 {chartStats.max} · 최저 {chartStats.min}</span>
          <span>평균 {chartStats.avg}{cc.unit}</span>
        </div>
      )}
    </div>
  );

  // 목표 설정 + 레인지 바
  const goalCard = latest && goals && (
    <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#707070", marginBottom: 12 }}>목표 설정</div>
      {[
        { key: "weight", label: "체중", color: "#4a8fc9", unit: "kg", step: 0.5, min: 55, max: 100, zones: [{ to: 40, color: "#5a9e6f", label: "정상" }, { to: 75, color: "#d4af37", label: "과체중" }, { to: 100, color: "#e05252", label: "비만" }], dir: "down" },
        { key: "fatPct", label: "체지방", color: "#e05252", unit: "%", step: 0.5, min: 5, max: 35, zones: [{ to: 45, color: "#5a9e6f", label: "적정" }, { to: 70, color: "#d4af37", label: "경계" }, { to: 100, color: "#e05252", label: "과다" }], dir: "down" },
        { key: "muscle", label: "골격근", color: "#5a9e6f", unit: "kg", step: 0.5, min: 25, max: 45, zones: [{ to: 30, color: "#e05252", label: "부족" }, { to: 55, color: "#d4af37", label: "보통" }, { to: 100, color: "#5a9e6f", label: "우수" }], dir: "up" }
      ].map((g, gi) => {
        const cur = latest[g.key === "fatPct" ? "fatPct" : g.key] || 0;
        const tgt = goals[g.key] || 0;
        const pctPos = (v) => Math.min(Math.max(((v - g.min) / (g.max - g.min)) * 100, 2), 98);
        const curPos = pctPos(cur);
        const tgtPos = pctPos(tgt);
        const gap = g.dir === "down" ? Math.round((cur - tgt) * 10) / 10 : Math.round((tgt - cur) * 10) / 10;
        const gapColor = gap <= 0 ? "#5a9e6f" : gap <= (g.dir === "down" ? 3 : 2) ? "#d4af37" : "#e05252";
        const reached = gap <= 0;
        return (
          <div key={g.key} style={{ marginBottom: gi < 2 ? 14 : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 10, color: g.color }}>{g.label}</span>
                <span style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace", color: "#f5f5f0" }}>{cur}<span style={{ fontSize: 10, color: "#4a4a4a" }}>{g.unit}</span></span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span onClick={() => adjustGoal(g.key, -g.step)} style={{ fontSize: 13, color: "#4a4a4a", cursor: "pointer", padding: "0 4px", userSelect: "none" }}>−</span>
                <span style={{ fontSize: 11, color: "#707070" }}>목표</span>
                <span style={{ fontSize: 12, fontWeight: 500, fontFamily: "monospace", color: g.color }}>{tgt}</span>
                <span onClick={() => adjustGoal(g.key, g.step)} style={{ fontSize: 13, color: "#4a4a4a", cursor: "pointer", padding: "0 4px", userSelect: "none" }}>+</span>
              </div>
            </div>
            <div style={{ position: "relative", height: 10, borderRadius: 5, overflow: "visible" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, borderRadius: 5, display: "flex", overflow: "hidden", opacity: 0.2 }}>
                {g.zones.map((z, zi) => <div key={zi} style={{ width: z.to + "%", background: z.color }} />)}
              </div>
              <div style={{ position: "absolute", left: tgtPos + "%", top: -1, transform: "translateX(-50%)", width: 2, height: 12, background: g.color, borderRadius: 1, zIndex: 2 }} />
              <div style={{ position: "absolute", left: curPos + "%", top: -3, transform: "translateX(-50%)", width: 14, height: 14, borderRadius: "50%", background: gapColor, border: "2px solid #1e1e1e", zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#1e1e1e" }} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              <div style={{ display: "flex", gap: 8 }}>
                {g.zones.map((z, zi) => <span key={zi} style={{ fontSize: 8, color: z.color }}>{z.label}</span>)}
              </div>
              <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 500, color: gapColor }}>
                {reached ? "✓ 달성!" : `${g.dir === "down" ? "-" : "+"}${gap}${g.unit} 남음`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );

  // AI 코칭
  const coachCard = latest && (
    <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: 3, background: "#d4af37" }}></div>
        <span style={{ fontSize: 10, color: "#d4af37" }}>AI 코칭</span>
        {coachDate && <span style={{ fontSize: 9, color: "#4a4a4a", marginLeft: 4 }}>{coachDate} 기준</span>}
        {!coachLoading && (
          <span onClick={() => { if (latest) fetchCoaching(latest, prev); }}
            style={{ fontSize: 10, color: "#555", cursor: "pointer", marginLeft: "auto" }}>
            다시 분석
          </span>
        )}
      </div>
      {coachLoading
        ? <div style={{ fontSize: 12, color: "#707070" }}>분석 중...</div>
        : coaching
          ? <div style={{ fontSize: 12, color: "#c0b896", lineHeight: 1.5 }}>{coaching}</div>
          : <div style={{ textAlign: "center", padding: "8px 0" }}>
              <span onClick={() => { if (latest) fetchCoaching(latest, prev); }}
                style={{ fontSize: 11, color: "#4a8fc9", cursor: "pointer", padding: "6px 16px", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 8, display: "inline-block" }}>
                AI 체성분 분석
              </span>
            </div>
      }
    </div>
  );

  // 측정 사이 식단/운동 요약
  const periodCard = latest && periodSummary && (
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
  );

  // 진행 사진 타임라인 (접힘, 펼칠 때 로드)
  const photosCard = <ProgressPhotos date={date} bodyLog={bodyLog} />;

  // 히스토리 (3건 + 전체보기)
  const historyCard = (
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
  );

  // 가로: 전폭(버튼/폼/토스트) → 전폭 히어로 차트 → 2컬럼 그리드 / 세로: 기존 순서 그대로
  return landscape ? (
    <>
      {startButton}
      {formCard}
      {toastCard}
      {chartCard}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
        <div>
          {summaryCard}
          {coachCard}
          {photosCard}
        </div>
        <div>
          {goalCard}
          {periodCard}
          {historyCard}
        </div>
      </div>
    </>
  ) : (
    <>
      {startButton}
      {formCard}
      {toastCard}
      {summaryCard}
      {chartCard}
      {goalCard}
      {coachCard}
      {periodCard}
      {photosCard}
      {historyCard}
    </>
  );
}
