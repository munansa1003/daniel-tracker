export const today = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
export const nowHour = () => new Date().getHours();

// 통계용 헬퍼: 오늘은 미완성 데이터이므로 평균/이상치/달성률 계산에서 제외
// (홈 탭의 "오늘 진행률" 같은 의도된 partial 표시는 별도 처리)
export const isCompletedDay = (dateStr) => dateStr < today();

// 기간 토글(1주/1달/3개월/전체)의 시작일(YYYY-MM-DD) 계산. "all"이면 전체 포함하는 하한.
// todayStr 주입형이라 순수·테스트 가능. 필터는 start <= ds < todayStr(오늘 제외)로 쓴다.
export function periodStart(period, todayStr) {
  if (period === "all") return "0000-00-00";
  const d = new Date(todayStr + "T12:00:00");
  if (period === "1w") d.setDate(d.getDate() - 7);
  else if (period === "1m") d.setMonth(d.getMonth() - 1);
  else if (period === "3m") d.setMonth(d.getMonth() - 3);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// 체중 기반 목표 단탄지 계산 (Mifflin-St Jeor)
// 비운동 기초유지 ≈ BMR×1.05 (정확기록 데이터로 역산 보정; 공식 활동계수 1.55는 유지칼로리를 과대평가했음).
// 휴식일 섭취 목표 K = 기초유지 − 기초적자(175). 운동일엔 운동 소모의 50%를 carbBonus로 되먹어
// 평균 하루 적자 ≈ 400kcal(주 0.37kg)을 유지하면서 큰 운동일의 과한 적자/근손실을 방지한다.
// 매크로: 단백질 2.2g/kg(근육 보존), 지방 0.6g/kg(호르몬 유지 최소선 이상), 나머지는 탄수.
// (지방 0.8 → 0.6: 칼로리 인하 시 탄수가 과하게 짜부라지던 것을 완화 → 에너지/운동수행/지속성 개선)
// 목표 모드별 상수
//  cut(감량)     : 휴식일 −175 적자 + 운동 50%만 되먹기 → 현재 체중 기준 영구 적자 구조
//  maintain(유지): 적자 0(=BMR×1.05 그대로) + 운동 100% 되먹기 → 에너지 균형(체중·근육 유지)
// 감량값(175 · 0.5)은 7개월 실측 캘리브레이션 — 변경 금지. 단백질 2.2/지방 0.6은 공통,
// 탄수는 '나머지'라 유지 모드에서 자동 증가한다.
export const MODE_DEFICIT = { cut: 175, maintain: 0 };
export const MODE_FEEDBACK = { cut: 0.5, maintain: 1, rest: 0 };
export function exFeedback(mode) { return MODE_FEEDBACK[mode] ?? MODE_FEEDBACK.cut; }

/* ── 휴식일 프리셋 (dayType:"rest" 도장) ──────────────────────────────
   쉬는 날의 목표를 체중 공식이 아니라 고정 한 숫자(1,675)로 둔다 — 컨셉 A(고정 안전선).
   1,675는 추정 유지 바로 아래 안전선으로 사용자가 확정한 값. 적응형 보정(adjust)과도
   무관하게 항상 같다("항상 같은 숫자"가 이 프리셋의 존재 이유). 체중이 크게 변하면 수동 재점검.
   P(2.2g/kg)·F(0.6g/kg)는 근육 보존 축이라 훈련일과 동일, C만 나머지로 재계산.
   운동을 300kcal 넘게 기록한 날은 도장이 있어도 훈련일 공식으로 자동 복귀한다
   (되먹기 0.5 기준 복귀 시점 목표가 1,675보다 커지도록 300을 선택 — 문턱 절벽 없음).
   유지(maintain) 모드는 이미 목표가 유지 칼로리라 프리셋보다 관대 — 도장을 무시한다.
   dayType:"train"은 예약된 값(명시적 훈련일 확정) — 판정은 도장 없음과 동일하게 취급한다. */
export const REST_K = 1675;
export const REST_EX_REVERT = 300;
export const isRestStamp = (day) => day?.dayType === "rest";
export function restTargets(weight) {
  const p = Math.round(weight * 2.2);
  const f = Math.round(weight * 0.6);
  const c = Math.round((REST_K - p * 4 - f * 9) / 4);
  return { p, c, f, k: REST_K, weight: Math.round(weight * 10) / 10 };
}
// 그 날의 유효 모드: 휴식일 도장이 실제로 발효 중이면 "rest", 아니면 원래 모드.
// isCalOk/exFeedback/목표 선택이 전부 이 모드 하나로 갈라진다(판정 단일 기준 유지).
export function effectiveDayMode(day, exKcal, mode = "cut") {
  if (mode !== "maintain" && isRestStamp(day) && Math.round(exKcal || 0) <= REST_EX_REVERT) return "rest";
  return mode;
}

// 칼로리 적정/초과 판정 단일 함수 (전 화면 통일 — §3/§6).
// 표시값(반올림) ≤ 모드 목표 + 운동 되먹기(반올림). targetK는 해당 mode의 목표여야 한다.
export function isCalOk(intakeK, exKcal, targetK, mode = "cut") {
  return Math.round(intakeK) <= targetK + Math.round(exKcal * exFeedback(mode));
}

// adjust: 적응형 유지칼로리 보정치(kcal). 기준선(BMR×1.05)만 이동시키고 캘리브레이션 절대값
// (175·2.2·0.6)은 그대로 둔다. 기본 0이라 기존 호출부·테스트는 무영향. 탄수는 나머지라 자동 반영,
// 단백질·지방은 체중 함수라 보정에 불변(§3 매크로 철학 유지).
export function calcTargets(weight, height = 175, age = 35, mode = "cut", adjust = 0) {
  const bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  const baseMaintenance = bmr * 1.05 + adjust;
  const deficit = MODE_DEFICIT[mode] ?? MODE_DEFICIT.cut;
  const k = Math.round(baseMaintenance - deficit);
  const p = Math.round(weight * 2.2);
  const f = Math.round(weight * 0.6);
  const c = Math.round((k - p * 4 - f * 9) / 4);
  return { p, c, f, k, weight: Math.round(weight * 10) / 10 };
}

// 적응형 보정 이력에서 특정 날짜에 유효했던 보정치를 찾는다(과거 판정 보존용).
// history: [{ from:"YYYY-MM-DD", adjust:kcal }] 오름차순. 해당일 이전 마지막 적용치, 없으면 0.
export function adjustForDate(history, dateStr) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  let adj = 0;
  for (const h of history) { if (h && h.from <= dateStr) adj = h.adjust || 0; }
  return adj;
}

/* 마스터 토글을 반영한 "실제로 쓸 이력" — 2026-08 감사 R-29.

   옛 동작은 토글이 꺼져 있으면 이력을 **통째로 []로** 만들었다. 그러면 보정이 오늘만이 아니라
   과거까지 소급해서 사라져, 그때 화면에 ✓였던 날이 ✗로 바뀐다. 다시 켜면 되돌아온다.
   이 모듈이 이력을 들고 있는 이유("그 날짜에 유효했던 보정치" — 위 adjustForDate 주석)와
   정면으로 어긋나는 동작이었다.

   끄기의 옳은 의미는 "**오늘부터** 보정 0"이다. 그래서 과거 항목은 그대로 두고 오늘자 0만 얹는다:
     · 과거 날짜 → 그때 적용돼 있던 보정 그대로 (판정 보존)
     · 오늘·이후 → 0 (토글을 끈 의미 그대로, 오늘의 목표는 안 변한다)

   왜 저장이 아니라 읽는 쪽에서 얹는가: 토글을 끈 **시점이 기록돼 있지 않은 기존 데이터**가
   이미 존재한다. 그 데이터를 고치려면 앱을 여는 것만으로 저장이 일어나야 하는데(기기마다,
   조용히), 파괴적 소급 수정은 하지 않는다. 대신 읽을 때마다 같은 결론을 내게 한다.
   토글을 실제로 만지는 순간에는 App이 이 항목을 진짜로 기록하므로 그때부터는 기기 간에도 일치한다. */
export function effectiveTdeeHistory(history, adaptiveOn, todayStr) {
  const hist = Array.isArray(history) ? history.filter((h) => h && typeof h.from === "string") : [];
  if (adaptiveOn) return hist;
  return [...hist.filter((h) => h.from !== todayStr), { from: todayStr, adjust: 0 }]
    .sort((x, y) => (x.from < y.from ? -1 : 1));
}

/* ── 날짜별 목표의 체중 기준 (2026-08 감사 R-10) ────────────────────────
   목표 kcal·매크로는 "그 달 평균 측정 체중"에서 나온다. 그런데 그 평균을 **사용자가 지금
   보고 있는 날짜**의 달에서 뽑고 있었다. 결과가 둘이었다:
     ① 달력을 지난달로 넘기면 그 달 기준으로 전 화면 목표가 바뀐다(UI 상태가 판정에 샌다)
     ② 새 측정 1건이 그 달 평균을 움직여 **그 달 모든 날의 판정이 소급 변경**된다
   적응형 보정은 tdeeHistory의 from 날짜로 과거를 보존하는데 체중 기준선만 보존이 없었다.
   이제 판정은 "그 날짜가 속한 달"의 평균으로 고정한다 — 같은 날의 ✓/✗가 보는 시점에
   따라 달라지지 않는다. (②의 같은 달 안에서의 이동은 월평균이라는 설계 자체의 성질이라
   남는다 — 월이 끝나면 그 달 판정은 더 이상 움직이지 않는다) */
export function monthAvgWeights(bodyLog) {
  const acc = new Map();
  for (const b of bodyLog || []) {
    if (!b || typeof b.date !== "string" || !(b.weight > 0)) continue;
    const ym = b.date.slice(0, 7);
    const cur = acc.get(ym) || { sum: 0, n: 0 };
    cur.sum += b.weight; cur.n++;
    acc.set(ym, cur);
  }
  const out = {};
  for (const [ym, { sum, n }] of acc) out[ym] = sum / n;
  return out;
}

// 그 달에 측정이 없으면 가장 가까운 "이전" 달 → 그것도 없으면 가장 이른 달 → 전부 없으면 fallback.
// (이후 달로 앞당겨 보지 않는 이유: 그 시점에 알 수 없던 체중으로 과거를 판정하지 않기 위해)
export function weightForMonth(monthAvg, ym, fallback) {
  const map = monthAvg || {};
  if (map[ym] > 0) return map[ym];
  const months = Object.keys(map).sort();
  if (!months.length) return fallback;
  let prev = null;
  for (const m of months) { if (m <= ym) prev = m; else break; }
  return map[prev ?? months[0]];
}

/* 날짜별 목표 세트를 돌려주는 함수를 만든다 — App·StatsTab·analysisExport 공용 단일 출처.
   (이전에는 `targetsByMode[m].k - appAdjust + adjustForDate(...)` 산식이 세 파일에 복붙돼
    있었다. 정수 보정치에서 두 식은 수학적으로 동일하다: round(x+a)-a+b = round(x)+b.)
   반환 함수: (mode, "YYYY-MM-DD") → { p, c, f, k, weight } */
export function makeDayTargets({ bodyLog, height = 175, age = 35, fallbackWeight = 75, tdeeHistory = [] }) {
  const monthAvg = monthAvgWeights(bodyLog);
  const cache = new Map();
  return (mode, ds) => {
    const ym = String(ds || "").slice(0, 7);
    const adjust = adjustForDate(tdeeHistory, ds);
    const ck = `${ym}|${mode}|${adjust}`;
    if (!cache.has(ck)) {
      const w = weightForMonth(monthAvg, ym, fallbackWeight);
      // 휴식일은 고정 프리셋(K=1,675) — 적응형 보정과 무관하다는 규칙 그대로
      cache.set(ck, mode === "rest" ? restTargets(w) : calcTargets(w, height, age, mode, adjust));
    }
    return cache.get(ck);
  };
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
// ⚠️ 결측 필드 방어가 필수다(2026-08 감사 R-28). 예전에는 serving이나 매크로가 빠진 항목
// 하나가 합계를 통째로 NaN으로 만들었고, estimateTDEE의 `a.k > 0` 게이트에서 false가 되어
// **그 날이 통째로 계산에서 조용히 빠졌다**. 운동은 이미 `|| 0`으로 방어돼 있었다 — 식단만
// 무방비였다. 값이 깨진 항목은 0으로 세되, 그 날 자체는 살린다.
export function aggregateDay(d) {
  if (!d) return { p: 0, c: 0, f: 0, k: 0, ex: 0, net: 0 };
  const n = (v) => (Number.isFinite(v) ? v : 0);
  let p = 0, c = 0, f = 0, k = 0, ex = 0;
  (d.meals || []).forEach(m => {
    if (!m) return;
    const s = Number.isFinite(m.serving) ? m.serving : 1;   // serving 결측은 1인분으로
    p += n(m.p) * s; c += n(m.c) * s; f += n(m.f) * s; k += n(m.k) * s;
  });
  (d.exercises || []).forEach(e => { ex += n(e && e.kcal); });
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
