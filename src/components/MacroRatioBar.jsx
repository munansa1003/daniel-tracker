import { COLORS } from "../data.js";

// 오늘 매크로 구성비 — 섭취 P/C/F의 '칼로리 기여 비율'(P×4·C×4·F×9 ÷ 총)을 스택바로.
// 헤더의 g 진행률과 시야가 분리됨("얼마나 먹었나" vs "구성이 어떤가"). 목표 비율선과 대조.
export function MacroRatioBar({ totals, targets }) {
  const pc = totals.p * 4, cc = totals.c * 4, fc = totals.f * 9;
  const sum = pc + cc + fc;
  if (sum <= 0) return null; // 아직 먹은 게 없으면 숨김
  const pPct = Math.round((pc / sum) * 100);
  const cPct = Math.round((cc / sum) * 100);
  const fPct = 100 - pPct - cPct;
  const tsum = targets.p * 4 + targets.c * 4 + targets.f * 9;
  const tP = Math.round((targets.p * 4 / tsum) * 100);
  const tC = Math.round((targets.c * 4 / tsum) * 100);
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  const seg = (w, bg, tc) => (
    <div style={{ width: w + "%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: tc, fontWeight: 600 }}>{w >= 10 ? w + "%" : ""}</div>
  );
  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>오늘 매크로 구성 <span style={{ color: "#4a4a4a", fontFamily: "monospace", fontSize: 11 }}>(목표선 ▏대조)</span></div>
      <div style={{ position: "relative" }}>
        <div style={{ height: 22, background: "#252525", borderRadius: 5, overflow: "hidden", display: "flex" }}>
          {seg(pPct, COLORS.p, "#0d1b2a")}
          {seg(cPct, COLORS.c, "#3a2e00")}
          {seg(fPct, COLORS.f, "#3a0d0d")}
        </div>
        <div style={{ position: "absolute", top: -3, bottom: -3, left: tP + "%", width: 2, background: "#f5f5f0", opacity: 0.5 }} />
        <div style={{ position: "absolute", top: -3, bottom: -3, left: (tP + tC) + "%", width: 2, background: "#f5f5f0", opacity: 0.5 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 11, fontFamily: "monospace" }}>
        <span style={{ color: COLORS.p }}>단백질 {pPct}% <span style={{ color: "#4a4a4a" }}>/목표{tP}</span></span>
        <span style={{ color: COLORS.c }}>탄수 {cPct}% <span style={{ color: "#4a4a4a" }}>/{tC}</span></span>
        <span style={{ color: COLORS.f }}>지방 {fPct}% <span style={{ color: "#4a4a4a" }}>/{100 - tP - tC}</span></span>
      </div>
    </div>
  );
}
