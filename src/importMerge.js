// src/importMerge.js — 워치 수입 사서함 → day 기록 병합 (순수 로직).
//
// 사서함 항목을 "수동 입력과 같은 모양"의 운동 항목으로 바꿔 그 날 기록에 넣는다.
// day 문서 쓰기는 호출측(App)이 기존 saveDay와 같은 store.set 경로로 수행 — 이 모듈은
// 계산만 한다. 병합은 importKey 기준 멱등: 이미 반영된 항목은 다시 넣지 않으므로
// ack 유실·다중 기기 동시 병합에도 중복이 생기지 않는다.
import { sortByHour } from "./utils.js";

// 수정 화면(EditExForm)이 kcal을 m×체중×분/60으로 재계산하므로, 수입 항목에도
// 역산한 m을 넣어 기존 편집 UI가 무수정으로 동작하게 한다.
export function deriveM(kcal, duration, weight) {
  if (!(kcal > 0) || !(duration > 0) || !(weight > 0)) return 6; // 평균 유산소 수준 폴백
  const m = (kcal * 60) / (weight * duration);
  return Math.min(30, Math.max(0.5, Math.round(m * 10) / 10));
}

// 사서함 항목 → 앱 운동 항목. importKey(재수입 차단 신분증)와 source(⌚ 배지)만 추가 필드.
export function importEntryToExercise(entry, weight) {
  return {
    n: entry.n,
    m: deriveM(entry.kcal, entry.duration, weight),
    memo: "",
    duration: entry.duration,
    kcal: entry.kcal,
    ts: entry.ts,      // 시작 시각 epoch(ms) — 기기 간 결정적이라 병합 dedup(n|ts)과도 일관
    hour: entry.hour,
    importKey: entry.importKey,
    source: "watch",
    ...(entry.device ? { device: entry.device } : {}),
  };
}

// days: { "YYYY-MM-DD": rec } (App의 allDays와 같은 형태 — day: 프리픽스 없음)
// 반환: { updatedDays, ackKeys }
//   updatedDays — 실제로 바뀐 날짜만 (saveDay와 같은 레코드 구성: mode/dayType 보존)
//   ackKeys     — 사서함에서 지워도 되는 키 전부(이번에 반영 + 이미 반영돼 있던 것)
export function mergeImports(days, entries, { weight = 0, todayStr = "", mode = "" } = {}) {
  const updatedDays = {};
  const ackKeys = [];
  for (const entry of entries || []) {
    if (!entry || typeof entry.importKey !== "string" || !entry.importKey) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date || "")) continue;
    if (typeof entry.n !== "string" || !entry.n || !Number.isFinite(entry.kcal) || !Number.isFinite(entry.duration)) continue;

    const base = updatedDays[entry.date] || days[entry.date] || {};
    const list = Array.isArray(base.exercises) ? base.exercises : [];
    if (list.some((x) => x && x.importKey === entry.importKey)) {
      ackKeys.push(entry.importKey); // 이미 반영됨(이전 병합의 ack 유실 등) — 사서함만 비우면 됨
      continue;
    }

    const exercises = sortByHour([...list, importEntryToExercise(entry, weight)]);
    // saveDay와 동일 정책: 오늘은 현재 모드 스탬프, 과거 날은 기존 스탬프 보존. dayType 명시 이월.
    const dayMode = entry.date === todayStr ? mode : base.mode;
    const dayType = base.dayType;
    updatedDays[entry.date] = {
      meals: base.meals || [],
      exercises,
      ...(dayMode ? { mode: dayMode } : {}),
      ...(dayType ? { dayType } : {}),
    };
    ackKeys.push(entry.importKey);
  }
  return { updatedDays, ackKeys };
}
