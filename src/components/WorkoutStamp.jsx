// 오늘 운동 도장 & 스트릭 — 운동 탭 진입 즉시 '오늘 했나' + 연속일을 보여주고,
// 미기록이면 손실회피(연속 끊김) 경고로 기록을 유도. 부위 데이터가 없어 MET/분/소모로만 요약.
// date=선택일, exercises=그 날 라이브 배열, exTotal=그 날 소모, allDays=전체, todayStr=today().
const prevDay = (ds) => {
  const d = new Date(ds + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

export function WorkoutStamp({ date, exercises, exTotal, allDays, todayStr }) {
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  const dayHasEx = (ds) => { const d = allDays && allDays[ds]; return !!(d && d.exercises && d.exercises.length); };
  const recorded = (exercises || []).length > 0;

  // 현재 연속일(선택일 포함, 과거로) / 선택일 직전까지의 연속일(끊김 경고용)
  let cur = 0, c = date;
  while (dayHasEx(c)) { cur++; c = prevDay(c); }
  let prevS = 0, pc = prevDay(date);
  while (dayHasEx(pc)) { prevS++; pc = prevDay(pc); }

  // 최장 연속일(전체 기록 기준)
  const exDays = Object.keys(allDays || {}).filter(dayHasEx).sort();
  let longest = 0, run = 0, prev = null;
  for (const ds of exDays) { run = (prev && prevDay(ds) === prev) ? run + 1 : 1; if (run > longest) longest = run; prev = ds; }
  if (cur > longest) longest = cur;

  // 최근 7칸(선택일에서 과거로)
  const dots = [];
  let d7 = date;
  for (let i = 0; i < 7; i++) { dots.unshift(dayHasEx(d7)); d7 = prevDay(d7); }

  const mins = (exercises || []).reduce((s, e) => s + (e.duration || 0), 0);
  const metW = (exercises || []).reduce((s, e) => s + (e.m || 0) * (e.duration || 0), 0);
  const avgMET = mins > 0 ? metW / mins : 0;
  const isToday = date === todayStr;

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {recorded ? (
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "monospace", color: "#5a9e6f" }}>✅ {mins}분 · 평균 MET {avgMET.toFixed(1)}</div>
            <div style={{ fontSize: 12, fontFamily: "monospace", color: "#4a8fc9", marginTop: 3 }}>-{Math.round(exTotal).toLocaleString()} kcal</div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#707070" }}>{isToday ? "오늘" : date.slice(5)} 운동 기록</div>
        )}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "monospace", color: cur > 0 ? "#f5f5f0" : "#4a4a4a" }}>🔥 {cur}일</div>
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "#707070" }}>최장 {longest}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 5, marginTop: 12 }}>
        {dots.map((on, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: on ? "#5a9e6f" : "#2a2a2a" }} />
        ))}
      </div>
      {!recorded && isToday && (
        <div style={{ marginTop: 12, padding: "9px 10px", border: "1px dashed #4a4a4a", borderRadius: 10, fontSize: 11, color: "#707070" }}>
          오늘 운동 미기록 · 1건만 기록해요!{prevS > 0 && <span style={{ color: "#e05252" }}> 안 하면 🔥{prevS}일 끊김</span>}
        </div>
      )}
    </div>
  );
}
