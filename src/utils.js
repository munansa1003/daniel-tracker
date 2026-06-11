export const today = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
export const nowHour = () => new Date().getHours();

// 통계용 헬퍼: 오늘은 미완성 데이터이므로 평균/이상치/달성률 계산에서 제외
// (홈 탭의 "오늘 진행률" 같은 의도된 partial 표시는 별도 처리)
export const isCompletedDay = (dateStr) => dateStr < today();

// 체중 기반 목표 단탄지 계산 (Mifflin-St Jeor)
// 비운동 기초유지 ≈ BMR×1.05 (정확기록 데이터로 역산 보정; 공식 활동계수 1.55는 유지칼로리를 과대평가했음).
// 휴식일 섭취 목표 K = 기초유지 − 기초적자(175). 운동일엔 운동 소모의 50%를 carbBonus로 되먹어
// 평균 하루 적자 ≈ 400kcal(주 0.37kg)을 유지하면서 큰 운동일의 과한 적자/근손실을 방지한다.
// 매크로: 단백질 2.2g/kg(근육 보존), 지방 0.6g/kg(호르몬 유지 최소선 이상), 나머지는 탄수.
// (지방 0.8 → 0.6: 칼로리 인하 시 탄수가 과하게 짜부라지던 것을 완화 → 에너지/운동수행/지속성 개선)
export function calcTargets(weight, height = 175, age = 35) {
  const bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  const baseMaintenance = bmr * 1.05;
  const k = Math.round(baseMaintenance - 175);
  const p = Math.round(weight * 2.2);
  const f = Math.round(weight * 0.6);
  const c = Math.round((k - p * 4 - f * 9) / 4);
  return { p, c, f, k, weight: Math.round(weight * 10) / 10 };
}

// 배열을 시간순으로 정렬
export function sortByHour(arr) {
  return [...arr].sort((a, b) => (a.hour || 0) - (b.hour || 0));
}

// 시간대 단일 기준 (식단/운동 그룹핑 + 시간 선택 라벨이 모두 이 정의를 사용)
export const TIME_PERIODS = [
  { key: "dawn",    name: "새벽", emoji: "🌌", start: 0,  end: 5  },
  { key: "morning", name: "아침", emoji: "🌅", start: 6,  end: 10 },
  { key: "lunch",   name: "점심", emoji: "🌞", start: 11, end: 16 },
  { key: "dinner",  name: "저녁", emoji: "🌆", start: 17, end: 20 },
  { key: "night",   name: "야간", emoji: "🌃", start: 21, end: 23 },
];
export function periodOf(hour) {
  const h = hour || 0;
  return TIME_PERIODS.find(p => h >= p.start && h <= p.end) || TIME_PERIODS[0];
}

// 시간대별 식단 그룹핑
export function groupMealsByTime(meals) {
  const groups = TIME_PERIODS.map(p => ({ label: `${p.emoji} ${p.name}`, key: p.key, meals: [] }));
  const idxByKey = Object.fromEntries(TIME_PERIODS.map((p, i) => [p.key, i]));
  meals.forEach((m, idx) => {
    groups[idxByKey[periodOf(m.hour).key]].meals.push({ ...m, _idx: idx });
  });
  return groups.filter(g => g.meals.length > 0);
}

// 시간대별 운동 그룹핑
export function groupExercisesByTime(exercises) {
  const groups = TIME_PERIODS.map(p => ({ label: `${p.emoji} ${p.name}`, key: p.key, items: [] }));
  const idxByKey = Object.fromEntries(TIME_PERIODS.map((p, i) => [p.key, i]));
  exercises.forEach((e, idx) => {
    groups[idxByKey[periodOf(e.hour).key]].items.push({ ...e, _idx: idx });
  });
  return groups.filter(g => g.items.length > 0);
}

/* ───── 유틸 ───── */
export function aggregateDay(d) {
  if (!d) return { p: 0, c: 0, f: 0, k: 0, ex: 0, net: 0 };
  let p = 0, c = 0, f = 0, k = 0, ex = 0;
  (d.meals || []).forEach(m => { const s = m.serving; p += m.p * s; c += m.c * s; f += m.f * s; k += m.k * s; });
  (d.exercises || []).forEach(e => { ex += e.kcal || 0; });
  return { p, c, f, k, ex, net: k - ex };
}

// 7일 이동 평균 계산
export function calcMovingAvg(data, key, window = 7) {
  return data.map((item, idx) => {
    const start = Math.max(0, idx - window + 1);
    const slice = data.slice(start, idx + 1);
    const avg = slice.reduce((s, d) => s + (d[key] || 0), 0) / slice.length;
    return { ...item, [`${key}_ma`]: Math.round(avg * 10) / 10 };
  });
}

export function getWeekKey(ds) { const d = new Date(ds); const day = d.getDay() || 7; d.setDate(d.getDate() + 4 - day); const ys = new Date(d.getFullYear(), 0, 1); return `${d.getFullYear()}-W${String(Math.ceil((((d - ys) / 86400000) + 1) / 7)).padStart(2, "0")}`; }
export function getMonthKey(ds) { return ds.slice(0, 7); }
export function getYearKey(ds) { return ds.slice(0, 4); }
