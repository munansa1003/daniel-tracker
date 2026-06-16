import { exFeedback } from "../utils.js";

// 칼로리 카드 (신호등 + 진행막대) — 운동 되먹기를 '보정 섭취' 한 기준으로 일관 표시
// 판정/막대/신호등 모두 (섭취 − 운동되먹기) vs 휴식일 목표 로 통일하여 혼란을 제거한다.
// 되먹기 계수는 모드별(감량 0.5 / 유지 1.0). targetK(effectiveTargetK)와 같은 계수를 써야
// t = targetK − eatback 역산이 정확히 휴식일 목표(TARGETS.k)로 떨어진다.
export function NetCalCard({ intake, exercise, targetK, mode = "cut" }) {
  const fb = exFeedback(mode);
  const fbPct = Math.round(fb * 100);
  const intk = Math.round(intake);
  const ex = Math.round(exercise);
  const eatback = Math.round(ex * fb);         // 운동 되먹기 (모드별 계수)
  const adj = intk - eatback;                  // 보정 섭취 (이 값으로 모든 판정)
  const t = (targetK || 1800) - eatback;       // 휴식일 기본 목표 (effectiveTargetK에서 역산)
  const z1 = Math.round(t * 0.75), z2 = Math.round(t * 0.90);
  let status, color, emoji;
  if (adj < z1) { status = "너무 적음"; color = "#e05252"; emoji = "🔴"; }
  else if (adj < z2) { status = "공격적"; color = "#d4af37"; emoji = "🟡"; }
  else if (adj <= t) { status = "적정"; color = "#5a9e6f"; emoji = "🟢"; }
  else { status = "초과"; color = "#d4af37"; emoji = "🟠"; }

  const pct = Math.min((adj / t) * 100, 100);
  const over = adj > t;

  const zones = [
    { l: "위험", r: `~${z1.toLocaleString()}`, c: "#e05252", bg: "rgba(224,82,82,0.1)", active: adj < z1 },
    { l: "주의", r: `${z1.toLocaleString()}~${z2.toLocaleString()}`, c: "#d4af37", bg: "rgba(212,175,55,0.1)", active: adj >= z1 && adj < z2 },
    { l: "적정", r: `${z2.toLocaleString()}~${t.toLocaleString()}`, c: "#5a9e6f", bg: "rgba(90,158,111,0.1)", active: adj >= z2 && adj <= t },
    { l: "초과", r: `${t.toLocaleString()}~`, c: "#d4af37", bg: "rgba(212,175,55,0.1)", active: adj > t }
  ];

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ background: `${color}11`, border: `1px solid ${color}33`, borderRadius: 16, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "#707070", marginBottom: 2 }}>보정 섭취 {emoji} <span style={{ color }}>{status}</span></div>
            <div style={{ fontSize: 22, fontWeight: 500, fontFamily: "monospace", color }}>
              {adj.toLocaleString()} <span style={{ fontSize: 12, color: "#707070" }}>kcal</span>
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: "#707070", lineHeight: 1.5 }}>
            <div>섭취 {intk.toLocaleString()}</div>
            {ex > 0 && <div>− 운동{fbPct}% {eatback.toLocaleString()}</div>}
          </div>
        </div>
        {/* 진행 막대 (A안: 양 끝에 현재치 / 목표치) */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace", marginTop: 10, marginBottom: 4 }}>
          <span style={{ color, fontWeight: 600 }}>현재 {adj.toLocaleString()}</span>
          <span style={{ color: "#707070" }}>목표 {t.toLocaleString()}{over && <span style={{ color: "#e05252", marginLeft: 4 }}>(+{(adj - t).toLocaleString()})</span>}</span>
        </div>
        <div style={{ height: 10, background: "#2a2a2a", borderRadius: 5, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 5, transition: "width 0.4s" }} />
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
