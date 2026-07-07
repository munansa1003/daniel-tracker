// 건강 이벤트(부상·질병·휴식·기타) — 순수 로직. 활성 이벤트 조회 + 계산 제외 판정.
// 저장은 goals.healthEvents 배열. 이벤트: { id, type, label, start, end|null, note, exclude }
//   end=null 이면 '진행중'(열린 구간). exclude=true 면 적응형 TDEE 계산에서 그 기간 제외.
export const HEALTH_TYPES = [
  { key: "injury", ico: "🤕", name: "부상", color: "#e0894a" },
  { key: "illness", ico: "🤢", name: "질병", color: "#cf6a6a" },
  { key: "rest", ico: "😴", name: "휴식", color: "#6a8fc9" },
  { key: "other", ico: "🩹", name: "기타", color: "#8a8a8a" },
];

export function typeMeta(key) {
  return HEALTH_TYPES.find((t) => t.key === key) || HEALTH_TYPES[HEALTH_TYPES.length - 1];
}

// ds(YYYY-MM-DD)가 이벤트 기간에 포함되는가. end 없으면 진행중(열린 구간).
export function dateInEvent(ds, ev) {
  if (!ev || !ev.start || !ds) return false;
  if (ds < ev.start) return false;
  if (ev.end && ds > ev.end) return false;
  return true;
}

// 특정 날짜에 걸린 이벤트들
export function eventsForDate(events, ds) {
  return (events || []).filter((ev) => dateInEvent(ds, ev));
}

// 진행중(활성) 이벤트 = 종료일 없음 + 이미 시작함. 시작 최신순.
// (회복 처리 = end 지정. 회복하면 진행중에서 빠짐.)
export function activeEvents(events, todayStr) {
  return (events || [])
    .filter((ev) => !ev.end && ev.start && ev.start <= todayStr)
    .sort((a, b) => (b.start || "").localeCompare(a.start || ""));
}

// 계산 제외 판정: exclude=true 이벤트 기간에 ds가 포함되면 true
export function isExcludedDate(events, ds) {
  return (events || []).some((ev) => ev.exclude && dateInEvent(ds, ev));
}

// 이벤트 포함 일수 (start~end, 진행중이면 start~today). 최소 1.
export function eventDays(ev, todayStr) {
  if (!ev || !ev.start) return 0;
  const endStr = ev.end || todayStr;
  if (endStr < ev.start) return 1;
  const d = Math.round((new Date(endStr + "T12:00:00") - new Date(ev.start + "T12:00:00")) / 86400000);
  return d + 1;
}
