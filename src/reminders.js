// 리마인더 판단(순수). 인앱 배너(앱 열 때)와 백그라운드 푸시(매일 밤 크론) 양쪽에서 공용으로 쓴다.
export const REMINDER_DEFAULTS = { record: true, weight: true, backup: true };

export function daysBetween(aStr, bStr) {
  return Math.round((new Date(bStr + "T12:00:00") - new Date(aStr + "T12:00:00")) / 86400000);
}

// 켜진 리마인더 중 지금 조건이 맞는 것만 반환. [{ key, days? }]
//  record: 오늘(todayStr) 식단·운동 기록 없음
//  weight: 마지막 체중 측정이 7일 이상 전(또는 아예 없음)
//  backup: 계정 성숙 + 마지막 백업 15일 이상 전
export function pendingReminders({ reminders, recordedToday, lastWeighDate, todayStr, accountMature, backupDaysAgo }) {
  const r = { ...REMINDER_DEFAULTS, ...(reminders || {}) };
  const out = [];
  if (r.record && !recordedToday) out.push({ key: "record" });
  if (r.weight) {
    const d = lastWeighDate ? daysBetween(lastWeighDate, todayStr) : 999;
    if (d >= 7) out.push({ key: "weight", days: d });
  }
  if (r.backup && accountMature && backupDaysAgo >= 15) out.push({ key: "backup", days: backupDaysAgo });
  return out;
}

// pending 목록 중 가장 중요한 1건을 골라 푸시 페이로드로 변환(백그라운드 크론용).
// 하루 1회 크론이라 여러 건이면 우선순위(기록>체중>백업)로 하나만 보낸다. 없으면 null.
export function reminderPush(pending) {
  if (!pending || !pending.length) return null;
  const order = { record: 0, weight: 1, backup: 2 };
  const top = pending.slice().sort((a, b) => order[a.key] - order[b.key])[0];
  if (top.key === "record") return { title: "오늘 기록 아직이에요 🍱", body: "식단·운동 잊지 않으셨나요? 지금 1분이면 돼요.", tab: "diet" };
  if (top.key === "weight") {
    const b = top.days >= 999 ? "체중 기록이 아직 없어요." : `${top.days}일째 체중을 안 쟀어요.`;
    return { title: "체중 잴 시간 ⚖️", body: `${b} 추세·적응형 정확도를 위해 한 번!`, tab: "body" };
  }
  return { title: "백업이 필요해요 💾", body: `${top.days}일째 백업이 없어요. 데이터 안전을 위해 백업해주세요.`, tab: "home" };
}
