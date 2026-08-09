// api/_lib/push-state.js — 크론 푸시가 조건 판단에 쓰는 KV 스냅샷의 병합 규칙 (순수).
//
// 배경(2026-08 감사 R-44): 서버는 Firestore 자격증명을 갖지 않는다(의도된 보안 태세).
// 그래서 크론은 "앱이 마지막에 올려둔 스냅샷"으로 판단하고, 인앱 배너는 Firestore 원본으로
// 판단한다 — 입력 출처가 다르다. 여기까지는 설계상 감수하는 지연이다.
//
// 문제는 스냅샷을 **통째로 덮어쓰던 것**이었다. 기기가 둘이면 오래된 스냅샷을 든 기기가
// 나중에 쓰는 것만으로 날짜가 과거로 되돌아간다: 폰A에서 오늘 기록 → 며칠 만에 켠 폰B가
// 옛 스냅샷을 올림 → 그날 밤 "오늘 기록하세요" 푸시. 사용자는 분명히 기록했다.
//
// "마지막 ○○한 날"들은 전부 단조 증가하는 값이다. 그래서 통째 교체 대신 **필드별 최댓값**을
// 취한다 — 오래된 기기는 값을 앞으로 밀 수는 있어도 뒤로 되돌릴 수는 없다.

// 날짜 문자열(YYYY-MM-DD) 최댓값 — 사전순 비교가 곧 시간순이다.
const maxDate = (a, b) => {
  const A = typeof a === "string" && a ? a : null;
  const B = typeof b === "string" && b ? b : null;
  if (!A) return B;
  if (!B) return A;
  return A >= B ? A : B;
};

export function mergePushState(prev, next) {
  const p = prev && typeof prev === "object" ? prev : {};
  const n = next && typeof next === "object" ? next : {};
  return {
    // 단조 — 오래된 기기가 과거로 되돌릴 수 없다
    lastRecordDate: maxDate(p.lastRecordDate, n.lastRecordDate),
    lastWeighDate: maxDate(p.lastWeighDate, n.lastWeighDate),
    lastBackup: maxDate(p.lastBackup, n.lastBackup),
    // 계정 생성일은 사실상 불변 — 한 번 알아낸 값을 유지한다(기기 로컬 값이라 새 기기에서
    // 비어 오는 일이 있고, 그때 null로 덮으면 백업 리마인더가 조용히 꺼진다)
    accountCreatedAt: p.accountCreatedAt || n.accountCreatedAt || null,
    // 주간 성적표는 더 나중 주차의 것을 남긴다
    weekReport: pickWeekReport(p.weekReport, n.weekReport),
    // 알림 토글은 날짜가 아니라 "설정"이다 — 사용자가 방금 바꾼 값이 이겨야 하므로 최신 우선.
    // (토글은 goals로 Firestore 동기화되므로 기기 간 수렴은 그쪽이 담당한다)
    reminders: n.reminders && typeof n.reminders === "object" ? n.reminders
             : (p.reminders && typeof p.reminders === "object" ? p.reminders : {}),
  };
}

function pickWeekReport(a, b) {
  const A = a && typeof a === "object" ? a : null;
  const B = b && typeof b === "object" ? b : null;
  if (!A) return B;
  if (!B) return A;
  return maxDate(A.weekStart, B.weekStart) === A.weekStart && A.weekStart !== B.weekStart ? A : B;
}
