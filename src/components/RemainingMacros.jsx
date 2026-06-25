import { COLORS } from "../data.js";

// 남은 매크로 & Net 한 줄 — 기록 직후 "지금 뭘 얼마나 더 먹지"를 즉답.
// 운동 되먹기가 반영된 목표를 받는다: tC=adjustedC(탄수보충 포함), tK=effectiveTargetK.
// 값은 (목표 − 섭취). 양수 = 남음, 음수 = 초과. 판정·표시 모두 반올림(전 화면 통일).
export function RemainingMacros({ totals, tP, tC, tF, tK, exTotal }) {
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  const fmt = (v) => (v >= 0 ? "+" + v : "" + v);
  const protRem = Math.round(tP - totals.p);
  const over = protRem < 0;
  const sub = [
    { l: "탄수", v: Math.round(tC - totals.c), c: COLORS.c, unit: "g" },
    { l: "지방", v: Math.round(tF - totals.f), c: COLORS.f, unit: "g" },
    { l: "칼로리", v: Math.round(tK - totals.k), c: COLORS.k, unit: "" },
  ];
  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>남은 목표</div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <div style={{ flex: 1.3, background: "rgba(74,143,201,0.08)", border: "1px solid rgba(74,143,201,0.25)", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
          <div style={{ fontSize: 10, color: COLORS.p }}>단백질 {over ? "초과" : "남음"}</div>
          <div style={{ fontSize: 19, fontWeight: 600, fontFamily: "monospace", color: COLORS.p }}>{fmt(protRem)}<span style={{ fontSize: 11 }}>g</span></div>
        </div>
        {sub.map((x) => (
          <div key={x.l} style={{ flex: x.l === "칼로리" ? 1.1 : 1, background: "#252525", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#707070" }}>{x.l}</div>
            <div style={{ fontSize: 16, fontWeight: 500, fontFamily: "monospace", color: x.c }}>{fmt(x.v)}<span style={{ fontSize: 10 }}>{x.unit}</span></div>
          </div>
        ))}
      </div>
      {exTotal > 0 && (
        <div style={{ fontSize: 10, color: "#707070", marginTop: 8 }}>
          운동 {Math.round(exTotal).toLocaleString()}kcal 되먹기 반영 · 오늘 목표 {Math.round(tK).toLocaleString()}kcal · 탄수 {Math.round(tC)}g
        </div>
      )}
    </div>
  );
}
