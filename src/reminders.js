// 리마인더 판단(순수). 인앱 배너(앱 열 때)와 백그라운드 푸시(매일 밤 크론) 양쪽에서 공용으로 쓴다.
export const REMINDER_DEFAULTS = { record: true, weight: true, backup: true, report: true, sync: true };

// 자동 수신 침묵 감지 (2026-08 감사 R-06).
// 자동화의 최대 위험은 고장이 조용하다는 것이다 — 단축어가 iOS 업데이트로 깨지거나
// 인바디가 프로토콜을 바꾸면 "아무 일도 안 일어난 것처럼" 보인다. 감사 전에는 이걸
// 잡아내는 장치가 하나도 없었다: 체성분은 7일 체중 리마인더가 간접 신호였지만(체중이
// 안 들어오면 lastWeighDate가 안 갱신되므로), 운동은 식단만 기록해도 record 리마인더가
// 충족돼 2주가 죽어도 알림이 0건이었다.
// 크론이 KV 수신 로그(import:log / import:body-log)의 최신 시각을 직접 읽어 판단하므로
// 앱을 열지 않아도 동작한다 — 새 저장소도 클라이언트 개입도 필요 없다.
export const IMPORT_SILENCE_DAYS = 5;

export function daysBetween(aStr, bStr) {
  return Math.round((new Date(bStr + "T12:00:00") - new Date(aStr + "T12:00:00")) / 86400000);
}

function shiftDateStr(ds, n) {
  const d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// 해당 날짜가 속한 주의 월요일 (통계 탭과 동일한 월요일 시작 기준)
export function mondayOf(ds) {
  const day = new Date(ds + "T12:00:00").getDay();
  return shiftDateStr(ds, day === 0 ? -6 : 1 - day);
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

/* 자동 수신 침묵 푸시 (크론 전용 — 인앱 배너는 KV 로그를 못 읽는다).
   lastExerciseAt·lastBodyAt: 수신 로그의 최신 `at`(ISO) 또는 null.
   **null은 "한 번도 들어온 적 없음"이라 침묵으로 치지 않는다** — 그 경로를 아예 안 쓰는
   사용자를 독촉하지 않기 위해서다(설정한 적 없는 기능의 알림은 소음이다).
   반환: 푸시 페이로드 | null */
export function importSilencePush({ lastExerciseAt, lastBodyAt, todayStr, days = IMPORT_SILENCE_DAYS }) {
  const gapDays = (iso) => {
    const d = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const n = daysBetween(d, todayStr);
    return Number.isFinite(n) ? n : null;
  };
  const parts = [];
  const ex = gapDays(lastExerciseAt);
  const bd = gapDays(lastBodyAt);
  if (ex !== null && ex >= days) parts.push(`워치 운동 ${ex}일`);
  if (bd !== null && bd >= days) parts.push(`인바디 체성분 ${bd}일`);
  if (!parts.length) return null;
  return {
    title: "자동 수신이 조용해요 📡",
    body: `${parts.join(" · ")}째 새로 들어온 기록이 없어요. 단축어·인바디 연결을 확인해 주세요.`,
    tab: "home",
    tag: "daniel-import-silence",
  };
}

// 주간 성적표 푸시(월요일 저녁 크론 전용). 지난 주(월~일) 요약이 KV에 동기화돼 있으면
// 수치를 담고, 없거나 옛 주면 일반 안내. 월요일이 아니면 null.
// weekReport: { weekStart, recorded, calOk, protHit, workouts } (클라이언트가 동기화)
export function weeklyReportPush(weekReport, todayStr) {
  if (new Date(todayStr + "T12:00:00").getDay() !== 1) return null; // 월요일만
  const expected = shiftDateStr(mondayOf(todayStr), -7); // 지난주 월요일
  const base = { title: "지난 주 성적표가 나왔어요 🎯", tab: "stats", tag: "daniel-weekly" };
  if (weekReport && weekReport.weekStart === expected) {
    return { ...base, body: `기록 ${weekReport.recorded}/7일 · 칼로리 적정 ${weekReport.calOk}일 · 단백질 ${weekReport.protHit}일 · 운동 ${weekReport.workouts}회` };
  }
  return { ...base, body: "통계 탭에서 지난 주 등급을 확인해보세요." };
}
