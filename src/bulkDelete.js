// src/bulkDelete.js — 자동 유입분 기간 일괄 삭제 (순수 계산) — 2026-08 감사 R-19.
//
// 자동 수신이 잘못 들어온 구간(단축어 오설정·인바디 계정 혼선 등)을 되돌리는 유일한 방법이
// "1건씩 지우기" 아니면 "백업 복원"뿐이었다. 몇 주치가 잘못 들어오면 어느 쪽도 현실적이지 않다.
//
// 이 모듈은 **무엇을 지울지 계산만** 한다. 실제 저장·삭제 흔적·안전본 백업은 호출측(App)이
// 기존 경로로 수행한다 — 파괴적 동작을 순수 함수로 분리해 두면 "무엇이 지워지는가"를
// 지우기 전에 정확히 보여줄 수 있고(미리보기), 테스트로 고정할 수 있다.
//
// 지우는 대상은 **자동 유입분만**이다. 손으로 입력한 기록은 어떤 경우에도 건드리지 않는다:
//   운동    — source === "watch"          (워치 자동 수신)
//   체성분  — auto === true               (4종 실측으로 자동 확정)
//             또는 source === "import"    (자동 수신분을 사용자가 확정·편집 → 출처는 자동)
//   초안    — 전부 (초안은 자동 유입으로만 생긴다)

const inRange = (ds, start, end) => typeof ds === "string" && ds >= start && ds <= end;

export const isAutoExercise = (e) => !!(e && e.source === "watch");
export const isAutoBody = (b) => !!(b && (b.auto === true || b.source === "import"));

// { allDays, bodyLog, bodyDrafts, start, end } → 지운 뒤의 상태 + 무엇을 지웠는지
// 반환:
//   updatedDays  — 실제로 바뀐 날짜만 (호출측이 store.set으로 그 날짜만 저장)
//   bodyLog      — 지운 뒤의 전체 배열
//   bodyDrafts   — 지운 뒤의 전체 객체
//   counts       — { exercises, bodyRecords, drafts } 미리보기용 건수
//   bodyDates    — 지운 체성분 레코드의 날짜들(호출측이 삭제 흔적을 남길 대상)
//   draftKeys    — 지운 초안의 `date|sampleTs`들(같은 형식의 흔적)
export function planAutoDelete({ allDays, bodyLog, bodyDrafts, start, end }) {
  const empty = { updatedDays: {}, bodyLog: bodyLog || [], bodyDrafts: bodyDrafts || {},
                  counts: { exercises: 0, bodyRecords: 0, drafts: 0 }, bodyDates: [], draftKeys: [] };
  // 기간이 뒤집혀 있거나 형식이 깨졌으면 아무것도 하지 않는다 — 파괴적 동작에서
  // "입력이 이상하면 일단 진행"은 있을 수 없다.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || "") || start > end) return empty;

  const updatedDays = {};
  let exercises = 0;
  for (const [ds, rec] of Object.entries(allDays || {})) {
    if (!inRange(ds, start, end) || !rec) continue;
    const list = Array.isArray(rec.exercises) ? rec.exercises : [];
    const kept = list.filter((e) => !isAutoExercise(e));
    if (kept.length === list.length) continue;      // 이 날은 지울 것이 없다
    exercises += list.length - kept.length;
    updatedDays[ds] = { ...rec, exercises: kept };  // meals·mode·dayType 등 나머지는 그대로
  }

  const bodyDates = [];
  const nextLog = (Array.isArray(bodyLog) ? bodyLog : []).filter((b) => {
    const drop = b && inRange(b.date, start, end) && isAutoBody(b);
    if (drop) bodyDates.push(b.date);
    return !drop;
  });

  const draftKeys = [];
  const nextDrafts = { ...(bodyDrafts || {}) };
  for (const ds of Object.keys(nextDrafts)) {
    if (!inRange(ds, start, end)) continue;
    draftKeys.push(`${ds}|${nextDrafts[ds] && nextDrafts[ds].sampleTs}`);
    delete nextDrafts[ds];
  }

  return {
    updatedDays,
    bodyLog: nextLog,
    bodyDrafts: nextDrafts,
    counts: { exercises, bodyRecords: bodyDates.length, drafts: draftKeys.length },
    bodyDates,
    draftKeys,
  };
}
