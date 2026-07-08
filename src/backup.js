// JSON 전체 백업/복원 — 순수 로직 (파일 I/O·store 접근은 App에서).
// CSV 내보내기는 사람이 보는 용도라 복원이 불가능했음. 이 모듈이 만드는 JSON은
// 앱의 저장 구조를 그대로 담아 통째로 되살릴 수 있는 유일한 복원 경로다.
export const BACKUP_APP = "daniel-tracker";
export const BACKUP_SCHEMA = 1;

const isDateStr = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// 전체 백업 객체 생성 (exportedAt은 호출측에서 주입 — 테스트 결정성)
export function buildBackup({ allDays, bodyLog, goals, customFoods, customExercises }, exportedAt) {
  return {
    app: BACKUP_APP,
    schema: BACKUP_SCHEMA,
    exportedAt,
    data: {
      days: allDays || {},
      bodylog: bodyLog || [],
      goals: goals || {},
      customFoods: customFoods || [],
      customExercises: customExercises || [],
    },
  };
}

// 백업 파일 검증 — 복원해도 안전한 형태인지. { ok, error? }
export function validateBackup(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "JSON 형식이 아니에요" };
  if (obj.app !== BACKUP_APP) return { ok: false, error: "이 앱의 백업 파일이 아니에요" };
  if (obj.schema !== BACKUP_SCHEMA) return { ok: false, error: `지원하지 않는 백업 버전(${obj.schema})이에요` };
  const d = obj.data;
  if (!d || typeof d !== "object") return { ok: false, error: "데이터가 비어 있어요" };
  if (!d.days || typeof d.days !== "object" || Array.isArray(d.days)) return { ok: false, error: "일별 기록(days) 형식 오류" };
  for (const k in d.days) {
    if (!isDateStr(k)) return { ok: false, error: `날짜 키 오류: ${k}` };
    const day = d.days[k];
    if (!day || typeof day !== "object") return { ok: false, error: `${k} 기록 형식 오류` };
    if (day.meals && !Array.isArray(day.meals)) return { ok: false, error: `${k} meals 형식 오류` };
    if (day.exercises && !Array.isArray(day.exercises)) return { ok: false, error: `${k} exercises 형식 오류` };
  }
  if (!Array.isArray(d.bodylog)) return { ok: false, error: "체성분(bodylog) 형식 오류" };
  for (const b of d.bodylog) {
    if (!b || !isDateStr(b.date) || typeof b.weight !== "number") return { ok: false, error: "체성분 항목 형식 오류" };
  }
  if (!d.goals || typeof d.goals !== "object" || Array.isArray(d.goals)) return { ok: false, error: "목표(goals) 형식 오류" };
  if (d.customFoods && !Array.isArray(d.customFoods)) return { ok: false, error: "직접 추가 음식 형식 오류" };
  if (d.customExercises && !Array.isArray(d.customExercises)) return { ok: false, error: "직접 추가 운동 형식 오류" };
  return { ok: true };
}

// 확인 다이얼로그용 요약 — 건수 + 기간
export function summarizeBackup(obj) {
  const d = obj?.data || {};
  const dayKeys = Object.keys(d.days || {}).sort();
  return {
    exportedAt: obj?.exportedAt || null,
    days: dayKeys.length,
    firstDay: dayKeys[0] || null,
    lastDay: dayKeys[dayKeys.length - 1] || null,
    bodyLog: (d.bodylog || []).length,
    customFoods: (d.customFoods || []).length,
    customExercises: (d.customExercises || []).length,
  };
}
