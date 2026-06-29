import { useState, useMemo } from "react";
import { aggregateDay, isCalOk, periodStart, today } from "../utils.js";

const PERIODS = [["1w", "1주"], ["1m", "1달"], ["3m", "3개월"], ["all", "전체"]];

// 기간 내 일별 섭취 시리즈 + 그 날 모드 기준 적정/초과 판정. (순수·테스트 가능)
export function buildCalorieSeries(allDays, targetsByMode, mode, period, todayStr) {
  const start = periodStart(period, todayStr);
  const tCur = (targetsByMode && (targetsByMode[mode] || targetsByMode.cut)) || { k: 1546 };
  let entries = Object.keys(allDays || {})
    .filter((ds) => ds >= start && ds < todayStr)
    .sort()
    .map((ds) => ({ a: aggregateDay(allDays[ds]), m: (allDays[ds] && allDays[ds].mode) || "cut" }))
    .filter((x) => x.a.k > 0);
  const MAX = 30; // 점이 많으면 균등 샘플링
  if (entries.length > MAX) {
    const step = (entries.length - 1) / (MAX - 1);
    entries = Array.from({ length: MAX }, (_, i) => entries[Math.round(i * step)]);
  }
  const points = entries.map((x) => {
    const t = (targetsByMode && targetsByMode[x.m]) || tCur;
    return { k: Math.round(x.a.k), ok: isCalOk(x.a.k, x.a.ex, t.k, x.m) };
  });
  const ks = points.map((p) => p.k);
  const targetK = tCur.k;
  const min = Math.min(targetK, ...(ks.length ? ks : [targetK]));
  const max = Math.max(targetK, ...(ks.length ? ks : [targetK]));
  return { points, targetK, min, max, overCount: points.filter((p) => !p.ok).length, n: points.length };
}

// D1 · 칼로리 vs 목표 밴드 라인 — 일별 섭취선 + 목표선/적정밴드 + 초과일 빨간점 (기간 토글)
export function CalorieBandChart({ allDays, targetsByMode, mode }) {
  const [period, setPeriod] = useState("1m");
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  // allDays/모드/기간이 안 바뀌면 매 렌더(검색 타이핑 등)마다 전체 순회 재계산하지 않도록 메모이제이션
  const s = useMemo(() => buildCalorieSeries(allDays, targetsByMode, mode, period, today()), [allDays, targetsByMode, mode, period]);

  const pad = Math.max(60, (s.max - s.min) * 0.15);
  const lo = s.min - pad, hi = s.max + pad;
  const Y = (v) => 10 + ((hi - v) / (hi - lo)) * 70;
  const X = (i) => (s.n <= 1 ? 150 : 8 + (i / (s.n - 1)) * 284);
  const tY = Y(s.targetK);
  const linePts = s.points.map((p, i) => `${X(i)},${Y(p.k)}`).join(" ");

  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: "#707070", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "#f5f5f0", fontWeight: 500 }}>섭취 vs 목표 밴드</span>
        <span style={{ fontFamily: "monospace", color: s.overCount > 0 ? "#e05252" : "#5a9e6f" }}>초과 {s.overCount}일 / {s.n}일</span>
      </div>
      <div style={{ display: "flex", background: "#252525", borderRadius: 9, padding: 3, marginBottom: 14 }}>
        {PERIODS.map(([k, l]) => (
          <div key={k} onClick={() => setPeriod(k)} style={{ flex: 1, textAlign: "center", padding: "6px 0", fontSize: 11, borderRadius: 6, cursor: "pointer", background: period === k ? "#d4af37" : "transparent", color: period === k ? "#141414" : "#8a8a8a", fontWeight: period === k ? 600 : 400 }}>{l}</div>
        ))}
      </div>
      {s.n === 0 ? (
        <div style={{ fontSize: 12, color: "#4a4a4a", textAlign: "center", padding: "24px 0" }}>이 기간 식단 기록이 없어요</div>
      ) : (
        <svg width="100%" viewBox="0 0 300 90" preserveAspectRatio="none" style={{ display: "block" }}>
          <rect x="0" y={tY} width="300" height={Math.max(0, 80 - tY)} fill="#5a9e6f" opacity="0.1" />
          <line x1="0" y1={tY} x2="300" y2={tY} stroke="#5a9e6f" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
          <polyline fill="none" stroke="#8a8a8a" strokeWidth="2" strokeLinejoin="round" points={linePts} />
          {s.points.map((p, i) => (
            <circle key={i} cx={X(i)} cy={Y(p.k)} r={p.ok ? 2 : 3.2} fill={p.ok ? "#5a9e6f" : "#e05252"} />
          ))}
        </svg>
      )}
      {s.n > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace", marginTop: 6 }}>
          <span style={{ color: "#5a9e6f" }}>▬ 목표 {s.targetK.toLocaleString()} · 적정 밴드</span>
          <span style={{ color: "#e05252" }}>● 초과일</span>
        </div>
      )}
    </div>
  );
}
