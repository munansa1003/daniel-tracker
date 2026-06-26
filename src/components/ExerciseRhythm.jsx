import { TIME_PERIODS, periodOf } from "../utils.js";

// 오늘 운동 시간대 분포 — 5시간대(새벽~야간)별 소모 kcal 막대 + 분 라벨.
// 식단 IntakeRhythm의 운동판(언제 운동이 몰렸는지 입력 직후 한눈에). 기록 0이면 숨김.
export function ExerciseRhythm({ exercises }) {
  if (!exercises || exercises.length === 0) return null;
  const rows = TIME_PERIODS.map((per) => {
    let kcal = 0, min = 0;
    exercises.forEach((e) => {
      if (periodOf(e.hour).key === per.key) { kcal += e.kcal || 0; min += e.duration || 0; }
    });
    return { name: per.name, emoji: per.emoji, kcal: Math.round(kcal), min };
  });
  const max = Math.max(1, ...rows.map((r) => r.kcal));
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>오늘 운동 시간대 분포</div>
      {rows.map((r) => {
        const has = r.kcal > 0;
        return (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <span style={{ width: 46, fontSize: 11, color: has ? "#8a8a8a" : "#4a4a4a" }}>{r.emoji} {r.name}</span>
            <div style={{ flex: 1, height: 12, background: "#232323", borderRadius: 4, overflow: "hidden" }}>
              {has && <div style={{ width: (r.kcal / max * 100) + "%", height: "100%", background: "#4a8fc9", borderRadius: 4 }} />}
            </div>
            <span style={{ width: 84, textAlign: "right", fontSize: 11, fontFamily: "monospace", color: has ? "#707070" : "#4a4a4a" }}>{has ? `-${r.kcal} · ${r.min}분` : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}
