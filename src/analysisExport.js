// 클로드 분석용 패키지 생성(순수) — CSV 원자료 대신 "지시문 + 맥락(목표·규칙·컨디션) + 집계"를
// 한 덩어리 마크다운으로 만들어, claude.ai에 붙여넣자마자 매달 같은 품질의 분석이 시작되게 한다.
// UI(복사/공유/저장)는 App 쪽 — 이 모듈은 문자열만 만든다(테스트 대상).
import { aggregateDay, isCalOk, adjustForDate } from "./utils.js";
import { dateInEvent, typeMeta } from "./healthEvents.js";

const MS_DAY = 86400000;
const toDate = (ds) => new Date(ds + "T12:00:00");
const fmt = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
export const shiftDays = (ds, n) => { const d = toDate(ds); d.setDate(d.getDate() + n); return fmt(d); };

export const PERIODS = [
  { key: "2w", label: "격주", days: 14 },
  { key: "1m", label: "1개월", days: 30 },
  { key: "3m", label: "3개월", days: 91 },
  { key: "all", label: "전체" },
  { key: "custom", label: "직접" },
];

// 기간 키 → {start, end}. all은 첫 기록일부터, custom은 호출측 지정.
export function resolvePeriod(periodKey, todayStr, allDays, custom) {
  if (periodKey === "custom" && custom?.start && custom?.end) {
    return custom.end < custom.start ? { start: custom.end, end: custom.start } : { ...custom };
  }
  if (periodKey === "all") {
    const first = Object.keys(allDays || {}).sort()[0] || todayStr;
    return { start: first, end: todayStr };
  }
  const p = PERIODS.find((x) => x.key === periodKey) || PERIODS[2];
  return { start: shiftDays(todayStr, -(p.days - 1)), end: todayStr };
}

// 기간 메타(패널 미리보기용): 기록일·체중·컨디션 건수 + 대략 크기
export function packageMeta(pkg, { allDays, bodyLog, healthEvents }, { start, end }) {
  const days = Object.keys(allDays || {}).filter((d) => d >= start && d <= end && (allDays[d]?.meals?.length || allDays[d]?.exercises?.length)).length;
  const weighs = (bodyLog || []).filter((b) => b.date >= start && b.date <= end).length;
  const conds = (healthEvents || []).filter((ev) => ev.start <= end && (ev.end || end) >= start).length;
  return { days, weighs, conds, kb: Math.max(1, Math.round(pkg.length / 1024)) };
}

// 본체 — 마크다운 패키지 생성
export function buildAnalysisPackage(state, { start, end }, todayStr) {
  const { allDays = {}, bodyLog = [], goals = {}, user = {}, mode = "cut", targets = {}, targetsByMode = {}, appAdjust = 0, tdeeHistory = [], healthEvents = [] } = state;
  const dayTargetK = (m, ds) => ((targetsByMode[m] || targetsByMode.cut || targets).k || 0) - appAdjust + adjustForDate(tdeeHistory, ds);

  const totalDays = Math.round((toDate(end) - toDate(start)) / MS_DAY) + 1;
  const periodLabel = totalDays <= 15 ? "격주" : totalDays <= 32 ? "1개월" : totalDays <= 95 ? "3개월" : `${totalDays}일`;

  // 기간 내 기록일 수집
  const recorded = Object.keys(allDays).filter((d) => d >= start && d <= end)
    .filter((d) => (allDays[d]?.meals?.length || allDays[d]?.exercises?.length)).sort();
  const weighs = bodyLog.filter((b) => b && b.date >= start && b.date <= end && b.weight > 0);
  const events = (healthEvents || []).filter((ev) => ev.start <= end && (ev.end || end) >= start);

  const L = [];
  L.push(`# Body Plan 분석 요청 (${start} ~ ${end}, ${periodLabel})`);
  L.push("");
  L.push("너는 나의 영양·운동 코치다. 아래 실측 데이터를 근거로 분석해줘.");
  L.push("1) 체중 추세 해석과 변곡점  2) 칼로리·단백질 준수율과 결과의 연결");
  L.push("3) 정체/급변 구간 원인 가설  4) 다음 2주 실행 조언 2~3개(구체적으로)");
  L.push("수치는 아래 데이터만 근거로 하고, 추측은 추측이라고 표시해줘.");
  L.push("");

  // 프로필·규칙
  L.push("## 내 프로필·규칙 (앱 자동 첨부)");
  const lastW = weighs.length ? weighs[weighs.length - 1].weight : (bodyLog.length ? bodyLog[bodyLog.length - 1].weight : null);
  const deltaW = weighs.length >= 2 ? Math.round((weighs[weighs.length - 1].weight - weighs[0].weight) * 10) / 10 : null;
  L.push(`- 키 ${user.height || "?"}cm · 나이 ${user.age || "?"}${lastW ? ` · 현재 ${lastW}kg` : ""}${deltaW !== null ? ` (기간 ${deltaW > 0 ? "+" : ""}${deltaW}kg)` : ""}`);
  L.push(`- 모드: ${mode === "maintain" ? "유지(maintain)" : "감량(cut)"} · 목표 ${targets.k?.toLocaleString() || "?"}kcal · P${targets.p || "?"} C${targets.c || "?"} F${targets.f || "?"}`);
  L.push(`- 적응형 보정: ${appAdjust !== 0 ? `${appAdjust > 0 ? "+" : ""}${appAdjust}kcal 적용 중 (실측 TDEE 역산 기반)` : "없음(공식 그대로)"}`);
  L.push(`- 규칙: 운동 소모의 ${mode === "maintain" ? "100%" : "50%"}를 잔여칼로리에 반영 · 운동일 탄수 보너스`);
  L.push("- 아래 판정(✓/✗)은 그 날의 모드·보정 기준 적정 여부");
  L.push("");

  // 컨디션
  if (events.length) {
    L.push("## 컨디션 이력 (분석 시 감안할 것)");
    for (const ev of events.sort((a, b) => a.start.localeCompare(b.start))) {
      const tm = typeMeta(ev.type);
      L.push(`- ${ev.start} ~ ${ev.end || "진행중"} ${ev.label || tm.name}(${tm.name})${ev.exclude ? " — 적응형 계산 제외 처리됨(이 기간 체중 급변은 비정상치)" : ""}${ev.note ? ` · ${ev.note}` : ""}`);
    }
    L.push("");
  }

  // 월별 집계
  const byMonth = new Map();
  for (const ds of recorded) {
    const m = ds.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(ds);
  }
  if (byMonth.size > 1) {
    L.push("## 월별 집계");
    L.push("월        평균kcal  평균P  적정일  운동회수  체중변화");
    for (const [m, dsList] of [...byMonth.entries()].sort()) {
      let k = 0, p = 0, ok = 0, judged = 0, exCnt = 0;
      for (const ds of dsList) {
        const a = aggregateDay(allDays[ds]);
        k += a.k; p += a.p;
        if ((allDays[ds].exercises || []).length) exCnt++;
        if (ds !== todayStr && a.k > 0) {
          judged++;
          const dM = allDays[ds].mode || "cut";
          if (isCalOk(a.k, a.ex, dayTargetK(dM, ds), dM)) ok++;
        }
      }
      const mw = weighs.filter((b) => b.date.startsWith(m));
      const wd = mw.length >= 2 ? Math.round((mw[mw.length - 1].weight - mw[0].weight) * 10) / 10 : null;
      L.push(`${m}   ${String(Math.round(k / dsList.length)).padStart(6)}  ${String(Math.round(p / dsList.length)).padStart(4)}  ${String(ok).padStart(3)}/${judged}  ${String(exCnt).padStart(5)}   ${wd === null ? "  —" : (wd > 0 ? "+" : "") + wd + "kg"}`);
    }
    L.push("");
  }

  // 일별 요약
  L.push(`## 일별 요약 (기록 ${recorded.length}일 / 기간 ${totalDays}일 — 날짜 kcal P C F 운동 판정)`);
  for (const ds of recorded) {
    const day = allDays[ds];
    const a = aggregateDay(day);
    const dM = day.mode || "cut";
    let mark;
    if (ds === todayStr) mark = "(오늘, 진행중)";
    else if (a.k <= 0) mark = "(식단 기록 없음)";
    else mark = isCalOk(a.k, a.ex, dayTargetK(dM, ds), dM) ? "✓" : "✗";
    const inEvent = events.find((ev) => dateInEvent(ds, ev));
    L.push(`${ds.slice(5)}  ${String(Math.round(a.k)).padStart(5)}  ${String(Math.round(a.p)).padStart(3)}  ${String(Math.round(a.c)).padStart(3)}  ${String(Math.round(a.f)).padStart(3)}  ${String(a.ex ? "-" + Math.round(a.ex) : "0").padStart(5)}  ${mark}${inEvent ? ` [${inEvent.label || typeMeta(inEvent.type).name}]` : ""}`);
    // 상세 — 무엇을 먹고 어떤 운동을 했는지(시간·수량·kcal). 식사 패턴·종목 분석의 근거.
    const meals = [...(day.meals || [])].sort((x, y) => (x.hour || 0) - (y.hour || 0));
    if (meals.length) L.push(`      식단: ${meals.map((m) => `${String(m.hour || 0).padStart(2, "0")}시 ${m.n}${m.serving !== 1 ? `×${m.serving}` : ""} ${Math.round((m.k || 0) * (m.serving || 1))}`).join(" · ")}`);
    const exs = [...(day.exercises || [])].sort((x, y) => (x.hour || 0) - (y.hour || 0));
    if (exs.length) L.push(`      운동: ${exs.map((e) => `${String(e.hour || 0).padStart(2, "0")}시 ${e.n} ${e.duration || 0}분 ${Math.round(e.kcal || 0)}`).join(" · ")}`);
  }
  L.push("");

  // 빈도 집계 — 반복 패턴(주식·루틴)을 클로드가 바로 보게
  const foodFreq = new Map(), exFreq = new Map();
  for (const ds of recorded) {
    for (const m of (allDays[ds].meals || [])) {
      const f = foodFreq.get(m.n) || { n: 0, k: 0 };
      f.n++; f.k += (m.k || 0) * (m.serving || 1);
      foodFreq.set(m.n, f);
    }
    for (const e of (allDays[ds].exercises || [])) {
      const x = exFreq.get(e.n) || { n: 0, min: 0, k: 0 };
      x.n++; x.min += e.duration || 0; x.k += e.kcal || 0;
      exFreq.set(e.n, x);
    }
  }
  if (foodFreq.size) {
    const top = [...foodFreq.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
    L.push(`## 자주 먹은 음식 TOP ${top.length}`);
    L.push(top.map(([name, f]) => `${name} ${f.n}회`).join(" · "));
    L.push("");
  }
  if (exFreq.size) {
    L.push("## 운동 종목별 집계");
    for (const [name, x] of [...exFreq.entries()].sort((a, b) => b[1].n - a[1].n)) {
      L.push(`- ${name}: ${x.n}회 · 총 ${x.min}분 · ${Math.round(x.k).toLocaleString()}kcal`);
    }
    L.push("");
  }

  // 체중
  L.push(`## 체중 기록 (${weighs.length}건)`);
  if (weighs.length) {
    const chunks = [];
    for (let i = 0; i < weighs.length; i += 5) {
      chunks.push(weighs.slice(i, i + 5).map((b) => `${b.date.slice(5)} ${b.weight}kg`).join(" · "));
    }
    L.push(...chunks);
  } else {
    L.push("(기간 내 측정 없음)");
  }
  L.push("");
  L.push("## 직접 추가 메모");
  L.push("(특별히 물어보고 싶은 것이 있으면 여기에 이어서 쓰세요)");
  return L.join("\n");
}
