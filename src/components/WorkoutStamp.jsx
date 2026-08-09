// 오늘 운동 도장 & 스트릭 — 운동 탭 진입 즉시 '오늘 했나' + 연속일을 보여주고,
// 미기록이면 손실회피(연속 끊김) 경고로 기록을 유도. 부위 데이터가 없어 MET/분/소모로만 요약.
// date=선택일, exercises=그 날 라이브 배열, exTotal=그 날 소모, allDays=전체, todayStr=today().
import { isRestStamp } from "../utils.js";

const prevDay = (ds) => {
  const d = new Date(ds + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

export function WorkoutStamp({ date, exercises, exTotal, allDays, todayStr }) {
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  const dayHasEx = (ds) => { const d = allDays && allDays[ds]; return !!(d && d.exercises && d.exercises.length); };
  // 쉬기로 "도장을 찍은" 날은 계획의 일부다 — 실패가 아니다. 옛 동작은 이 날을 끊김으로 세서
  // 계획대로 쉰 사용자에게 "연속 끊김" 경고를 띄웠다(감사 R-20). 휴식일은 연속을 **잇되,
  // 스스로 운동일로 세지는 않는다** — 이어주기만 하고 숫자를 부풀리지 않는 것이 정직하다.
  const dayIsRest = (ds) => isRestStamp(allDays && allDays[ds]) && !dayHasEx(ds);
  const dayKeeps = (ds) => dayHasEx(ds) || dayIsRest(ds);
  const recorded = (exercises || []).length > 0;

  // 현재 연속일(선택일 포함, 과거로) / 선택일 직전까지의 연속일(끊김 경고용)
  let cur = 0, c = date;
  while (dayKeeps(c)) { if (dayHasEx(c)) cur++; c = prevDay(c); }
  let prevS = 0, pc = prevDay(date);
  while (dayKeeps(pc)) { if (dayHasEx(pc)) prevS++; pc = prevDay(pc); }

  // 최장 연속일(전체 기록 기준) — 휴식 도장이 사이에 있어도 이어진 것으로 본다
  const keptDays = Object.keys(allDays || {}).filter(dayKeeps).sort();
  let longest = 0, run = 0, prev = null;
  for (const ds of keptDays) {
    run = (prev && prevDay(ds) === prev) ? run + (dayHasEx(ds) ? 1 : 0) : (dayHasEx(ds) ? 1 : 0);
    if (run > longest) longest = run;
    prev = ds;
  }
  if (cur > longest) longest = cur;

  // 최근 7칸(선택일에서 과거로)
  // "운동함 / 쉬기로 함 / 아무것도 없음" 3상태 — 계획된 휴식을 빈칸과 같게 그리면
  // 연속이 끊겨 보인다(실제로는 안 끊긴다).
  const dots = [];
  let d7 = date;
  for (let i = 0; i < 7; i++) { dots.unshift(dayHasEx(d7) ? "ex" : dayIsRest(d7) ? "rest" : "none"); d7 = prevDay(d7); }

  const mins = (exercises || []).reduce((s, e) => s + (e.duration || 0), 0);
  const metW = (exercises || []).reduce((s, e) => s + (e.m || 0) * (e.duration || 0), 0);
  const avgMET = mins > 0 ? metW / mins : 0;
  const isToday = date === todayStr;
  const todayIsRest = dayIsRest(date);

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
        {dots.map((s, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: s === "ex" ? "#5a9e6f" : s === "rest" ? "#3c5273" : "#2a2a2a" }} />
        ))}
      </div>
      {/* 쉬기로 도장을 찍은 날에 "안 하면 끊김"은 틀린 독촉이다 — 계획대로 쉬는 중이다(감사 R-20) */}
      {!recorded && isToday && todayIsRest && (
        <div style={{ marginTop: 12, padding: "9px 10px", border: "1px dashed #3c5273", borderRadius: 10, fontSize: 11, color: "#6a8fc9" }}>
          😴 오늘은 휴식일 · 연속은 유지돼요{cur > 0 && <span style={{ color: "#707070" }}> (🔥{cur}일)</span>}
        </div>
      )}
      {!recorded && isToday && !todayIsRest && (
        <div style={{ marginTop: 12, padding: "9px 10px", border: "1px dashed #4a4a4a", borderRadius: 10, fontSize: 11, color: "#707070" }}>
          오늘 운동 미기록 · 1건만 기록해요!{prevS > 0 && <span style={{ color: "#e05252" }}> 안 하면 🔥{prevS}일 끊김</span>}
        </div>
      )}
    </div>
  );
}
