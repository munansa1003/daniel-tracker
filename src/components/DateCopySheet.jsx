import { groupMealsByTime, groupExercisesByTime, aggregateDay } from "../utils.js";

const WD = ["일", "월", "화", "수", "목", "금", "토"];

// 복사 소스로 쓸 '최근 기록일' 목록(오늘 제외, 해당 타입 데이터 있는 날만, 최신순). (순수)
export function recentCopyDays(allDays, type, todayStr, limit = 21) {
  return Object.keys(allDays || {})
    .filter((ds) => ds < todayStr)
    .map((ds) => {
      const d = allDays[ds];
      const arr = type === "diet" ? (d && d.meals) || [] : (d && d.exercises) || [];
      return { ds, arr };
    })
    .filter((x) => x.arr.length > 0)
    .sort((a, b) => (a.ds < b.ds ? 1 : -1))
    .slice(0, limit)
    .map(({ ds, arr }) => {
      const a = aggregateDay(allDays[ds]);
      const w = WD[new Date(ds + "T12:00:00").getDay()];
      return { ds, label: `${ds.slice(5).replace("-", ".")} (${w})`, kcal: Math.round(type === "diet" ? a.k : a.ex), count: arr.length };
    });
}

// 오늘 배열에 이미 같은 항목이 몇 건 있는지(중복) — 식단 n+serving / 운동 n+duration 기준. (순수)
export function copyDupCount(existing, items, type) {
  const keyOf = type === "diet" ? (x) => x.n + "_" + x.serving : (x) => x.n + "_" + x.duration;
  const set = new Set((existing || []).map(keyOf));
  return (items || []).filter((it) => set.has(keyOf(it))).length;
}

// 컨셉 3 · 끼니 미리보기 시트 — 소스 날짜 칩 선택 + 끼니별(그날 전체/끼니 묶음/개별) 담기.
export function DateCopySheet({ type, allDays, todayStr, srcDate, onPickDate, onCopyItem, onCopyGroup, onCopyAll }) {
  const days = recentCopyDays(allDays, type, todayStr);
  const src = allDays[srcDate] || {};
  const items = type === "diet" ? src.meals || [] : src.exercises || [];
  const groups = type === "diet" ? groupMealsByTime(items) : groupExercisesByTime(items);
  const color = type === "diet" ? "#4a8fc9" : "#5a9e6f";
  const a = aggregateDay(src);
  const totalK = Math.round(type === "diet" ? a.k : a.ex);

  return (
    <div>
      {/* 소스 날짜 칩 (최근 기록일) */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 14 }}>
        {days.map((d) => {
          const on = d.ds === srcDate;
          return (
            <div key={d.ds} onClick={() => onPickDate(d.ds)} style={{ flexShrink: 0, background: on ? "rgba(212,175,55,0.15)" : "#252525", border: `1px solid ${on ? "#d4af37" : "rgba(255,255,255,0.08)"}`, borderRadius: 20, padding: "6px 11px", fontSize: 12, color: on ? "#d4af37" : "#f5f5f0", cursor: "pointer", whiteSpace: "nowrap", fontWeight: on ? 600 : 400 }}>
              {d.label} <span style={{ fontFamily: "monospace", color: on ? "#d4af37" : "#707070" }}>{d.kcal.toLocaleString()}</span>
            </div>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: "#4a4a4a", textAlign: "center", padding: "24px 0" }}>이 날짜엔 기록이 없어요</div>
      ) : (
        <>
          <div onClick={() => onCopyAll(items)} style={{ background: `${color}14`, border: `1px solid ${color}33`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
            <span style={{ fontSize: 13, color, fontWeight: 600 }}>그날 전체 복사</span>
            <span style={{ fontSize: 11, color: "#707070", fontFamily: "monospace" }}>{items.length}건 · {totalK.toLocaleString()}kcal</span>
          </div>
          {groups.map((g) => {
            const gItems = type === "diet" ? g.meals : g.items;
            const short = g.label.split(" ")[1] || "끼니";
            return (
              <div key={g.key} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{g.label}</span>
                  <span onClick={() => onCopyGroup(gItems)} style={{ fontSize: 11, color: "#fff", background: color, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>{short} 전체 +</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {gItems.map((it, i) => (
                    <div key={i} onClick={() => onCopyItem(it)} style={{ background: "#252525", border: `1px solid ${color}33`, borderRadius: 20, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#f5f5f0", display: "flex", gap: 4, alignItems: "center" }}>
                      <span>{type === "diet" ? `${it.n}${it.serving !== 1 ? ` ×${it.serving}` : ""}` : `${it.n} ${it.duration}분`}</span>
                      <span style={{ color }}>+</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
