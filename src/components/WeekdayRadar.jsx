import { useState } from "react";
import { aggregateDay, periodStart, today } from "../utils.js";

const PERIODS = [["1w", "1주"], ["1m", "1달"], ["3m", "3개월"], ["all", "전체"]];
const LABELS = ["월", "화", "수", "목", "금", "토", "일"];

// 기간 내 요일별(월~일) 운동 소모 kcal 합계. (순수·테스트 가능)
export function buildWeekdayTotals(allDays, period, todayStr) {
  const start = periodStart(period, todayStr);
  const totals = [0, 0, 0, 0, 0, 0, 0];
  Object.keys(allDays || {}).forEach((ds) => {
    if (ds < start || ds >= todayStr) return;
    const a = aggregateDay(allDays[ds]);
    if (a.ex <= 0) return;
    const wd = (new Date(ds + "T12:00:00").getDay() + 6) % 7; // 월=0 … 일=6
    totals[wd] += a.ex;
  });
  return totals;
}

// E9 · 요일 레이더 — 7각형으로 요일별 운동량 밸런스 (기간 토글)
export function WeekdayRadar({ allDays }) {
  const [period, setPeriod] = useState("1m");
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  const totals = buildWeekdayTotals(allDays, period, today());
  const sum = totals.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...totals);
  const cx = 80, cy = 80, R = 56;
  const ang = (i) => (-90 + i * (360 / 7)) * Math.PI / 180;
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const poly = (r) => LABELS.map((_, i) => pt(i, r).map((v) => Math.round(v * 10) / 10).join(",")).join(" ");
  const dataPoly = totals.map((v, i) => pt(i, (v / max) * R).map((x) => Math.round(x * 10) / 10).join(",")).join(" ");
  // 주말(토=5, 일=6) 비중
  const weekend = totals[5] + totals[6];
  const wkPct = sum > 0 ? Math.round((weekend / sum) * 100) : 0;

  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: "#707070", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "#f5f5f0", fontWeight: 500 }}>요일별 운동 밸런스</span>
        <span style={{ fontFamily: "monospace", color: "#4a4a4a" }}>소모 기준</span>
      </div>
      <div style={{ display: "flex", background: "#252525", borderRadius: 9, padding: 3, marginBottom: 8 }}>
        {PERIODS.map(([k, l]) => (
          <div key={k} onClick={() => setPeriod(k)} style={{ flex: 1, textAlign: "center", padding: "6px 0", fontSize: 11, borderRadius: 6, cursor: "pointer", background: period === k ? "#d4af37" : "transparent", color: period === k ? "#141414" : "#8a8a8a", fontWeight: period === k ? 600 : 400 }}>{l}</div>
        ))}
      </div>
      {sum === 0 ? (
        <div style={{ fontSize: 12, color: "#4a4a4a", textAlign: "center", padding: "24px 0" }}>이 기간 운동 기록이 없어요</div>
      ) : (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <svg width="170" height="165" viewBox="0 0 160 165">
            <polygon points={poly(R)} fill="none" stroke="#2f2f2f" strokeWidth="1" />
            <polygon points={poly(R * 0.5)} fill="none" stroke="#262626" strokeWidth="1" />
            <polygon points={dataPoly} fill="rgba(74,143,201,0.28)" stroke="#4a8fc9" strokeWidth="2" />
            {LABELS.map((l, i) => {
              const [x, y] = pt(i, R + 12);
              return <text key={l} x={x} y={y + 3} textAnchor="middle" fontSize="9" fontFamily="monospace" fill={i >= 5 ? "#e05252" : "#707070"}>{l}</text>;
            })}
          </svg>
        </div>
      )}
      {sum > 0 && (
        <div style={{ fontSize: 10, color: "#707070", marginTop: 4, textAlign: "center" }}>
          주말 운동 비중 {wkPct}%{wkPct < 20 && <span style={{ color: "#e05252" }}> · 주말 보강 여지</span>}
        </div>
      )}
    </div>
  );
}
