// 인앱 리마인더 — "앱을 열었을 때" 상태 기반으로 띄우는 배너 판단(순수).
// 시간 지정/성적표 등 '앱 닫아도 오는' 알림은 백그라운드 푸시(FCM+크론, 별도)라 여기엔 없다.
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
