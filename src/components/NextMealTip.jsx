import { periodOf, TIME_PERIODS } from "../utils.js";
import { COLORS } from "../data.js";

// 다음 끼니 한 입 — 남은 매크로를 '남은 끼니 수'로 나눠 다음 한 끼 타깃을 즉시 제시.
// tC=adjustedC(운동 보충 포함), tK=effectiveTargetK(되먹기 반영). nowHour는 호출부에서 주입(테스트 용이).
// 남은 끼니 = 현재 시간대부터 아직 기록 없는 시간대 수(최소 1).
export function NextMealTip({ totals, meals, nowHour, tP, tC, tK }) {
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  const remK = Math.round(tK - totals.k);
  if (remK <= 0) {
    return (
      <div style={card}>
        <div style={{ fontSize: 13, color: "#707070", marginBottom: 6 }}>다음 끼니 권장</div>
        <div style={{ fontSize: 14, color: "#5a9e6f" }}>오늘 목표 다 채웠어요 ✓</div>
      </div>
    );
  }
  const curIdx = TIME_PERIODS.findIndex((p) => nowHour >= p.start && nowHour <= p.end);
  const eaten = new Set((meals || []).map((m) => periodOf(m.hour).key));
  const future = TIME_PERIODS.slice(curIdx < 0 ? 0 : curIdx);
  const remainingMeals = Math.max(1, future.filter((p) => !eaten.has(p.key)).length);
  const per = (t, v) => Math.max(0, Math.round((t - v) / remainingMeals));
  const pPer = per(tP, totals.p);
  const cPer = per(tC, totals.c);
  const kPer = Math.max(0, Math.round(remK / remainingMeals));
  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>다음 끼니 권장</div>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
        <span style={{ fontSize: 20, fontWeight: 600, fontFamily: "monospace", color: COLORS.p }}>P{pPer}</span>
        <span style={{ fontSize: 20, fontWeight: 600, fontFamily: "monospace", color: COLORS.c }}>C{cPer}</span>
        <span style={{ fontSize: 20, fontWeight: 600, fontFamily: "monospace", color: COLORS.k }}>{kPer}<span style={{ fontSize: 11, color: "#707070" }}>kcal</span></span>
      </div>
      <div style={{ fontSize: 10, color: "#707070", marginTop: 8 }}>
        남은 목표(P{Math.max(0, Math.round(tP - totals.p))}·{remK.toLocaleString()}kcal) ÷ 남은 끼니 {remainingMeals}
      </div>
    </div>
  );
}
