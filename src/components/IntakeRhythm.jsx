import { TIME_PERIODS, periodOf } from "../utils.js";
import { COLORS } from "../data.js";

// 오늘 시간대 섭취 리듬 — 5시간대(새벽~야간)별 칼로리 막대 + 단백질(파랑) 오버레이.
// 하루 칼로리가 어디 몰렸는지(저녁/야식 편중)와 끼니별 단백질 분산을 입력 직후 한눈에.
export function IntakeRhythm({ meals }) {
  if (!meals || meals.length === 0) return null;
  const rows = TIME_PERIODS.map((per) => {
    let k = 0, p = 0;
    meals.forEach((m) => {
      if (periodOf(m.hour).key === per.key) { k += m.k * m.serving; p += m.p * m.serving; }
    });
    return { name: per.name, emoji: per.emoji, k: Math.round(k), p: Math.round(p) };
  });
  const max = Math.max(1, ...rows.map((r) => r.k));
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>오늘 시간대 분포</div>
      {rows.map((r) => {
        const has = r.k > 0;
        return (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <span style={{ width: 46, fontSize: 11, color: has ? "#8a8a8a" : "#4a4a4a" }}>{r.emoji} {r.name}</span>
            <div style={{ flex: 1, height: 12, background: "#232323", borderRadius: 4, overflow: "hidden", position: "relative" }}>
              {has && <div style={{ width: (r.k / max * 100) + "%", height: "100%", background: "#3a3320", borderRadius: 4 }} />}
              {has && <div style={{ width: (Math.min(r.p * 4, r.k) / max * 100) + "%", height: "100%", background: COLORS.p, borderRadius: 4, position: "absolute", top: 0, left: 0 }} />}
            </div>
            <span style={{ width: 84, textAlign: "right", fontSize: 11, fontFamily: "monospace", color: has ? "#707070" : "#4a4a4a" }}>{has ? `${r.k} · P${r.p}` : "—"}</span>
          </div>
        );
      })}
      <div style={{ fontSize: 10, color: "#707070", marginTop: 8 }}>파랑 = 단백질 환산(g×4)</div>
    </div>
  );
}
