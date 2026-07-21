// 클로드 분석용 패키지 생성(순수) — CSV 원자료 대신 "지시문 + 맥락(목표·규칙·컨디션) + 집계"를
// 한 덩어리 마크다운으로 만들어, claude.ai에 붙여넣자마자 매달 같은 품질의 분석이 시작되게 한다.
// UI(복사/공유/저장)는 App 쪽 — 이 모듈은 문자열만 만든다(테스트 대상).
import { aggregateDay, isCalOk, adjustForDate, exFeedback } from "./utils.js";
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
// 운동 유형 분류(키워드) — 종목↔체성분 연결 분석용. 미분류는 '기타'로 정직하게.
// 코어를 하체보다 먼저 검사(예: '행잉 레그 레이즈'는 코어).
const EX_CATS = [
  ["유산소", ["걷", "러닝", "런닝", "달리", "조깅", "자전거", "사이클", "수영", "축구", "풋살", "등산", "계단", "줄넘기", "인터벌", "유산소", "테니스", "배드민턴", "농구", "하이킹", "트레드밀"]],
  ["코어", ["코어", "플랭크", "복근", "크런치", "싯업", "레그 레이즈", "레그레이즈"]],
  ["하체", ["스쿼트", "런지", "레그", "데드리프트", "카프", "힙"]],
  ["상체", ["벤치", "푸시업", "팔굽", "풀업", "턱걸이", "로우", "숄더", "프레스", "이/삼두", "이두", "삼두", "컬", "랫", "델트", "체스트", "딥스"]],
];
export function exCategory(name) {
  for (const [cat, kws] of EX_CATS) if (kws.some((k) => (name || "").includes(k))) return cat;
  return "기타";
}

// opts.detail: true=정밀 상세본(끼니별 식단·운동 세션 포함), false=코치 요약본(기본 — 문서 비대화 방지)
export function buildAnalysisPackage(state, { start, end }, todayStr, opts = {}) {
  const detail = !!opts.detail;
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

  // 설정 변경 이력 — 변곡점(감량 속도 변화)의 원인 추적용.
  // 적응형 보정은 tdeeHistory에, 모드 전환은 그날 스탬프에 남아 있어 재구성 가능.
  // 목표 kcal 절대값은 월평균 체중 따라 자동 산출이라 이력이 없다 — 그 사실을 명시.
  const settingLines = [];
  const hist = [...(tdeeHistory || [])].filter((h) => h && h.from).sort((a, b) => a.from.localeCompare(b.from));
  let prevAdj = 0;
  for (const h of hist) {
    if (h.from <= end) settingLines.push(`- ${h.from} 적응형 보정 ${prevAdj}→${h.adjust || 0}kcal`);
    prevAdj = h.adjust || 0;
  }
  const modeName = (m) => (m === "maintain" ? "유지" : "감량");
  const modeFb = (m) => (m === "maintain" ? "100%" : "50%");
  let prevMode = null;
  for (const ds of recorded) {
    const m = allDays[ds].mode || "cut";
    if (prevMode !== null && m !== prevMode) {
      settingLines.push(`- ${ds} 모드 ${modeName(prevMode)}→${modeName(m)} (운동반영 ${modeFb(prevMode)}→${modeFb(m)})`);
    }
    prevMode = m;
  }
  if (settingLines.length) {
    L.push("## 설정 변경 이력");
    settingLines.sort((a, b) => a.slice(2, 12).localeCompare(b.slice(2, 12)));
    L.push(...settingLines);
    L.push("(목표 kcal·매크로 절대값은 월평균 체중에 따라 자동 산출 — 변경 이력으로 저장되지 않음)");
    L.push("");
  }

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
    L.push("월        평균kcal  평균P  평균C  평균F  적정일  운동회수  체중변화");
    for (const [m, dsList] of [...byMonth.entries()].sort()) {
      let k = 0, p = 0, c = 0, f = 0, ok = 0, judged = 0, exCnt = 0;
      for (const ds of dsList) {
        const a = aggregateDay(allDays[ds]);
        k += a.k; p += a.p; c += a.c; f += a.f;
        if ((allDays[ds].exercises || []).length) exCnt++;
        if (ds !== todayStr && a.k > 0) {
          judged++;
          const dM = allDays[ds].mode || "cut";
          if (isCalOk(a.k, a.ex, dayTargetK(dM, ds), dM)) ok++;
        }
      }
      const mw = weighs.filter((b) => b.date.startsWith(m));
      const wd = mw.length >= 2 ? Math.round((mw[mw.length - 1].weight - mw[0].weight) * 10) / 10 : null;
      const n = dsList.length;
      L.push(`${m}   ${String(Math.round(k / n)).padStart(6)}  ${String(Math.round(p / n)).padStart(4)}  ${String(Math.round(c / n)).padStart(4)}  ${String(Math.round(f / n)).padStart(4)}  ${String(ok).padStart(3)}/${judged}  ${String(exCnt).padStart(5)}   ${wd === null ? "  —" : (wd > 0 ? "+" : "") + wd + "kg"}`);
    }
    L.push("");
  }

  // 운동 구성 (주간) — 유형 비중(kcal 기준 %)과 운동/휴식일. 구조 진단(편중·하체 빈도)용.
  const hasAnyEx = recorded.some((ds) => (allDays[ds].exercises || []).length);
  if (hasAnyEx) {
    const mondayOf = (ds) => { const dow = toDate(ds).getDay(); return shiftDays(ds, dow === 0 ? -6 : 1 - dow); };
    const weeks = new Map(); // 월요일 → 그 주에 속한 기간 내 날짜들
    for (let ds = start; ds <= end; ds = shiftDays(ds, 1)) {
      const wk = mondayOf(ds);
      if (!weeks.has(wk)) weeks.set(wk, []);
      weeks.get(wk).push(ds);
    }
    L.push("## 운동 구성 (주간)");
    L.push("주(월요일)   유산소  상체  하체  코어  기타(%) | 운동일·휴식일");
    for (const [wk, dates] of [...weeks.entries()].sort()) {
      const cats = { 유산소: 0, 상체: 0, 하체: 0, 코어: 0, 기타: 0 };
      let exDays = 0;
      for (const ds of dates) {
        const exs = allDays[ds]?.exercises || [];
        if (exs.length) exDays++;
        for (const e of exs) cats[exCategory(e.n)] += e.kcal || 0;
      }
      const total = Object.values(cats).reduce((s, v) => s + v, 0);
      const pct = (v) => String(total > 0 ? Math.round((v / total) * 100) : 0).padStart(4);
      L.push(`${wk.slice(5).replace("-", "/")}주    ${pct(cats.유산소)}  ${pct(cats.상체)}  ${pct(cats.하체)}  ${pct(cats.코어)}  ${pct(cats.기타)}   | 운동 ${exDays}일 · 휴식 ${dates.length - exDays}일`);
    }
    L.push("");
  }

  // 일별 요약 — 유효목표 병기(판정 검증 가능) + 초과폭 + 직전일 동일총량 플래그(일괄 입력 감지)
  L.push(`## 일별 요약 (기록 ${recorded.length}일 / 기간 ${totalDays}일 — 날짜 kcal P C F 운동 유효목표 판정)`);
  L.push("(유효목표 = 그날 목표kcal + 운동반영분 → ✓/✗의 기준값 · ✗(+N) = 초과폭 · ≈ = 직전 기록일과 총량 동일, 일괄 입력 가능성)");
  let prevSig = null;
  for (const ds of recorded) {
    const day = allDays[ds];
    const a = aggregateDay(day);
    const dM = day.mode || "cut";
    // isCalOk와 동일 산식: round(섭취) ≤ 목표 + round(운동×반영률) — 표시값도 그 기준값 그대로
    const effTarget = dayTargetK(dM, ds) + Math.round(a.ex * exFeedback(dM));
    let mark;
    if (ds === todayStr) mark = "(오늘, 진행중)";
    else if (a.k <= 0) mark = "(식단 기록 없음)";
    else if (isCalOk(a.k, a.ex, dayTargetK(dM, ds), dM)) mark = "✓";
    else mark = `✗(+${Math.round(a.k) - effTarget})`;
    const sig = a.k > 0 ? `${Math.round(a.k)}|${Math.round(a.p)}|${Math.round(a.c)}|${Math.round(a.f)}` : null;
    const repeat = sig !== null && sig === prevSig;
    prevSig = sig;
    const inEvent = events.find((ev) => dateInEvent(ds, ev));
    L.push(`${ds.slice(5)}  ${String(Math.round(a.k)).padStart(5)}  ${String(Math.round(a.p)).padStart(3)}  ${String(Math.round(a.c)).padStart(3)}  ${String(Math.round(a.f)).padStart(3)}  ${String(a.ex ? "-" + Math.round(a.ex) : "0").padStart(5)}  ${String(effTarget).padStart(5)}  ${mark}${repeat ? " ≈" : ""}${inEvent ? ` [${inEvent.label || typeMeta(inEvent.type).name}]` : ""}`);
    if (detail) {
      // 정밀 상세본 — 무엇을 먹고 어떤 운동을 했는지(시간·수량·kcal). 구간 심층 분석용.
      const meals = [...(day.meals || [])].sort((x, y) => (x.hour || 0) - (y.hour || 0));
      if (meals.length) L.push(`      식단: ${meals.map((m) => `${String(m.hour || 0).padStart(2, "0")}시 ${m.n}${m.serving !== 1 ? `×${m.serving}` : ""} ${Math.round((m.k || 0) * (m.serving || 1))}`).join(" · ")}`);
      const exs = [...(day.exercises || [])].sort((x, y) => (x.hour || 0) - (y.hour || 0));
      if (exs.length) L.push(`      운동: ${exs.map((e) => `${String(e.hour || 0).padStart(2, "0")}시 ${e.n} ${e.duration || 0}분 ${Math.round(e.kcal || 0)}`).join(" · ")}`);
    }
  }
  // 기록 공백(3일 이상 연속 무기록) — "공백 = 체중 증가" 패턴 감지용. 오늘은 진행중이라 제외.
  const gaps = [];
  const recSet = new Set(recorded);
  const gapEnd = end === todayStr ? shiftDays(todayStr, -1) : end;
  let gapStart = null;
  for (let ds = start; ds <= gapEnd; ds = shiftDays(ds, 1)) {
    if (!recSet.has(ds)) { if (!gapStart) gapStart = ds; }
    else if (gapStart) { gaps.push([gapStart, shiftDays(ds, -1)]); gapStart = null; }
  }
  if (gapStart) gaps.push([gapStart, gapEnd]);
  const bigGaps = gaps.map(([s, e]) => [s, e, Math.round((toDate(e) - toDate(s)) / MS_DAY) + 1]).filter(([, , n]) => n >= 3);
  if (bigGaps.length) L.push(`기록 공백: ${bigGaps.map(([s, e, n]) => `${s.slice(5)}~${e.slice(5)} (${n}일)`).join(" · ")}`);
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

  // 체성분 — 체중만이 아니라 골격근·체지방률·체지방량(진짜 지표)까지
  L.push(`## 체성분 기록 (${weighs.length}건)`);
  if (weighs.length) {
    const fatKg = (b) => Math.round(b.weight * b.fatPct / 100 * 10) / 10;
    const withComp = weighs.filter((b) => b.fatPct > 0);
    if (withComp.length >= 2) {
      const f0 = withComp[0], f1 = withComp[withComp.length - 1];
      const dFat = Math.round((fatKg(f1) - fatKg(f0)) * 10) / 10;
      const dMus = f0.muscle > 0 && f1.muscle > 0 ? Math.round((f1.muscle - f0.muscle) * 10) / 10 : null;
      L.push(`기간 변화: 체지방량 ${fatKg(f0)}→${fatKg(f1)}kg (${dFat > 0 ? "+" : ""}${dFat})${dMus !== null ? ` · 골격근 ${f0.muscle}→${f1.muscle}kg (${dMus > 0 ? "+" : ""}${dMus})` : ""}`);
    }
    for (const b of weighs) {
      const parts = [`${b.date.slice(5)} ${b.weight}kg`];
      if (b.muscle > 0) parts.push(`골격근 ${b.muscle}kg`);
      if (b.fatPct > 0) parts.push(`체지방 ${b.fatPct}% = ${fatKg(b)}kg`);
      if (b.score > 0) parts.push(`점수 ${b.score}`);
      L.push(parts.join(" · "));
    }
  } else {
    L.push("(기간 내 측정 없음)");
  }
  L.push("");
  L.push("## 직접 추가 메모");
  L.push("(특별히 물어보고 싶은 것이 있으면 여기에 이어서 쓰세요)");
  return L.join("\n");
}
