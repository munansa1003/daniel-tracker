import { useState, useMemo, useCallback } from "react";
import { THEME } from "../theme.jsx";
import { today, isCompletedDay, calcTargets, aggregateDay, isCalOk, adjustForDate } from "../utils.js";
import { useOrientation } from "../hooks/useOrientation.js";

export function StatsTab({ bodyLog, allDays, goals, onSaveGoals, appTargets, targetsByMode, mode = "cut", appAdjust = 0, tdeeHistory = [] }) {
  const landscape = useOrientation(); // 가로모드 여부 — 표시 재배치 전용, 계산과 무관
  const [statsTab, setStatsTab] = useState("report");
  const [summaryPeriod, setSummaryPeriod] = useState("1m");
  const totalDays = Object.keys(allDays).length;
  const targets = appTargets || calcTargets(goals.weight || 75, 175, 35, mode);
  // 그 날의 모드로 목표 세트를 고르는 헬퍼(달력/주간 판정용). 세트가 없으면 현재 targets로 폴백.
  const dayTargets = (m) => (targetsByMode ? (targetsByMode[m] || targetsByMode.cut) : targets);
  // 그 날 유효 적응형 보정치로 목표 K 조정(과거 판정 보존). 보정 없으면 dayTargets(m).k와 동일.
  const dayTargetK = (m, ds) => dayTargets(m).k - appAdjust + adjustForDate(tdeeHistory, ds);
  const [weekOffset, setWeekOffset] = useState(0); // 0=이번주, -1=지난주, -2=2주전...
  const latest = bodyLog[bodyLog.length - 1];
  const first = bodyLog[0];

  // ═══ 기간별 요약 데이터 ═══
  const periodSummary = useMemo(() => {
    if (bodyLog.length < 2) return null;
    const sorted = [...bodyLog].sort((a, b) => a.date.localeCompare(b.date));
    const todayDate = new Date(today() + "T12:00:00");
    let startDate;
    if (summaryPeriod === "1w") { startDate = new Date(todayDate); startDate.setDate(startDate.getDate() - 7); }
    else if (summaryPeriod === "1m") { startDate = new Date(todayDate); startDate.setMonth(startDate.getMonth() - 1); }
    else if (summaryPeriod === "3m") { startDate = new Date(todayDate); startDate.setMonth(startDate.getMonth() - 3); }
    else { startDate = new Date(sorted[0].date + "T12:00:00"); }
    const startStr = startDate.getFullYear() + "-" + String(startDate.getMonth() + 1).padStart(2, "0") + "-" + String(startDate.getDate()).padStart(2, "0");
    const periodEntries = sorted.filter(b => b.date >= startStr);
    if (periodEntries.length < 1) return null;
    const from = summaryPeriod === "all" ? sorted[0] : periodEntries[0];
    const to = periodEntries[periodEntries.length - 1];
    if (from.date === to.date && summaryPeriod !== "all") return null;
    const dW = Math.round((to.weight - from.weight) * 10) / 10;
    const dF = Math.round((to.fatPct - from.fatPct) * 10) / 10;
    const dM = Math.round((to.muscle - from.muscle) * 10) / 10;
    // 선택 기간 전체를 스파크라인에 반영 (점이 많으면 균등 샘플링으로 최대 24개)
    const MAX_SPARK = 24;
    let spark;
    if (periodEntries.length <= MAX_SPARK) {
      spark = periodEntries;
    } else {
      const step = (periodEntries.length - 1) / (MAX_SPARK - 1);
      spark = Array.from({ length: MAX_SPARK }, (_, i) => periodEntries[Math.round(i * step)]);
    }
    const gW = dW <= 0, gF = dF <= 0, gM = dM >= 0;
    const gc = (gW ? 1 : 0) + (gF ? 1 : 0) + (gM ? 1 : 0);
    const pLabel = { "1w": "1주", "1m": "1개월", "3m": "3개월", "all": "전체" }[summaryPeriod];

    // 같은 기간(측정 from~to)의 식단/운동 집계 — 코멘트 근거로 사용
    let diet = null;
    if (allDays) {
      let tK = 0, tP = 0, tEx = 0, tTk = 0, exDays = 0, n = 0;
      Object.entries(allDays).forEach(([d, day]) => {
        if (d >= from.date && d <= to.date && isCompletedDay(d)) {
          const a = aggregateDay(day);
          // 목표 비교는 그 날의 모드 목표를 평균(기간이 감량↔유지 전환을 걸쳐도 정확)
          if (a.k > 0) { tK += a.k; tP += a.p; tTk += dayTargetK(day.mode || "cut", d); n++; }
          if (a.ex > 0) { tEx += a.ex; exDays++; }
        }
      });
      if (n > 0) diet = { avgK: Math.round(tK / n), avgP: Math.round(tP / n), avgTk: Math.round(tTk / n), avgEx: exDays > 0 ? Math.round(tEx / exDays) : 0, exDays, days: n };
    }

    // ── 풍부한 코멘트 생성 (규칙 기반) ──
    let status, sColor;
    const head = gc === 3 ? `${pLabel} 리컴프 진행 중 💪` : gc >= 2 ? `${pLabel} 전반적으로 양호` : `${pLabel} 관리가 필요해요`;
    sColor = gc === 3 ? "#5a9e6f" : gc >= 2 ? "#d4af37" : "#e05252";

    // 변화 요약 (방향 + 수치)
    const chg = [];
    if (dW !== 0) chg.push(`체중 ${dW > 0 ? "+" : ""}${dW}kg`);
    if (dF !== 0) chg.push(`체지방 ${dF > 0 ? "+" : ""}${dF}%p`);
    if (dM !== 0) chg.push(`골격근 ${dM > 0 ? "+" : ""}${dM}kg`);
    const chgStr = chg.length ? chg.join(" · ") : "변화 거의 없음";

    // 원인/조언 (식단·운동 데이터 연계)
    let advice = "";
    if (diet) {
      const overK = diet.avgK - diet.avgTk;
      const pOk = diet.avgP >= targets.p * 0.9;
      if (!gW || !gF) {
        // 체중/체지방이 늘었거나 안 빠진 경우 → 섭취 점검
        if (overK > 80) advice = `일평균 섭취 ${diet.avgK.toLocaleString()}kcal로 목표(${diet.avgTk.toLocaleString()})보다 ${overK}kcal 높았어요. 총량을 줄이면 개선됩니다.`;
        else advice = `섭취는 목표 부근(${diet.avgK.toLocaleString()}kcal)이었어요. 기록 누락이나 활동량을 점검해보세요.`;
        if (pOk) advice += ` 단백질(${diet.avgP}g)은 충분했습니다.`;
      } else if (gc === 3) {
        advice = `일평균 ${diet.avgK.toLocaleString()}kcal·단백질 ${diet.avgP}g, 운동 ${diet.exDays}일. 지금 페이스가 이상적이에요!`;
      } else {
        advice = `일평균 섭취 ${diet.avgK.toLocaleString()}kcal·단백질 ${diet.avgP}g, 운동 ${diet.exDays}일 기록.`;
        if (!pOk) advice += ` 단백질이 목표(${targets.p}g)보다 부족하니 보충해보세요.`;
      }
    }

    status = advice ? `${head} — ${chgStr}. ${advice}` : `${head} — ${chgStr}.`;
    return { from, to, dW, dF, dM, spark, dateLabel: from.date.slice(5) + " → " + to.date.slice(5), cnt: periodEntries.length, status, sColor, gW, gF, gM, diet };
  }, [bodyLog, summaryPeriod, allDays, targets, targetsByMode, appAdjust, tdeeHistory]);

  // 주간 날짜 배열 (월~일) 구하기, offset만큼 과거로 이동
  const getWeekDates = useCallback((dateStr, offset = 0) => {
    const d = new Date(dateStr + "T12:00:00");
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(d); dd.setDate(d.getDate() + diff + i + offset * 7);
      return dd.getFullYear() + "-" + String(dd.getMonth() + 1).padStart(2, "0") + "-" + String(dd.getDate()).padStart(2, "0");
    });
  }, []);

  // ═══ 주간 리포트 데이터 ═══
  const weeklyReport = useMemo(() => {
    const todayStr = today();
    const thisWeekDates = getWeekDates(todayStr, weekOffset);
    const lastWeekDates = getWeekDates(todayStr, weekOffset - 1);
    const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];

    const analyzeWeek = (dates) => {
      let pDays = 0, dDays = 0, eDays = 0, totP = 0, totK = 0, totEx = 0, n = 0;
      const daily = dates.map((ds, i) => {
        const isToday = ds === todayStr;
        const dd = allDays[ds];
        if (!dd || ((!dd.meals || !dd.meals.length) && (!dd.exercises || !dd.exercises.length)))
          return { date: ds, label: dayLabels[i], has: false, pHit: false, dHit: false, eHit: false, isToday };
        const a = aggregateDay(dd);
        // 판정은 화면 표시값(반올림) 기준 — 표시가 목표와 같으면 달성으로 직관 일치
        // 칼로리 판정은 '그 날의 모드' 기준(과거 감량일은 감량 기준 유지). 단백질은 모드 무관.
        const dM = dd.mode || "cut";
        const ph = Math.round(a.p) >= targets.p, dh = isCalOk(a.k, a.ex, dayTargetK(dM, ds), dM), eh = (dd.exercises || []).length > 0;
        const lateEat = (dd.meals || []).some(m => (m.hour || 0) >= 22);
        // 오늘은 미완성이므로 평균/카운트에서 제외 (시각화에는 isToday 플래그로 별도 표시)
        if (!isToday) {
          n++; totP += a.p; totK += a.k; totEx += a.ex;
          if (ph) pDays++; if (dh) dDays++; if (eh) eDays++;
        }
        return { date: ds, label: dayLabels[i], has: true, pHit: ph, dHit: dh, eHit: eh, p: Math.round(a.p), k: Math.round(a.k), ex: Math.round(a.ex), lateEat, isToday };
      });
      return { daily, n, pDays, dDays, eDays, avgP: n ? Math.round(totP / n) : 0, avgK: n ? Math.round(totK / n) : 0, avgEx: n ? Math.round(totEx / n) : 0 };
    };

    const tw = analyzeWeek(thisWeekDates);
    const lw = analyzeWeek(lastWeekDates);
    const todayDow = new Date(todayStr + "T12:00:00").getDay();
    const dayIdx = todayDow === 0 ? 6 : todayDow - 1;
    // 이번 주(weekOffset=0)는 항상 진행 중. 월요일 0시가 되면 새 "이번 주"가 시작되고
    // 방금 끝난 주는 자동으로 weekOffset=-1로 밀려나면서 등급 공개됨.
    const isComplete = weekOffset < 0;

    const grade = (w) => {
      if (w.n === 0) return { letter: "—", color: "#4a4a4a" };
      const s = (w.pDays / w.n) * 40 + (w.dDays / w.n) * 30 + Math.min(w.eDays / 4, 1) * 30;
      if (s >= 90) return { letter: "A+", color: "#5a9e6f" };
      if (s >= 80) return { letter: "A", color: "#5a9e6f" };
      if (s >= 70) return { letter: "B+", color: "#5a9e6f" };
      if (s >= 60) return { letter: "B", color: "#4a8fc9" };
      if (s >= 50) return { letter: "C+", color: "#d4af37" };
      if (s >= 40) return { letter: "C", color: "#d4af37" };
      if (s >= 30) return { letter: "D", color: "#e05252" };
      return { letter: "F", color: "#e05252" };
    };

    // 코칭 생성
    // 중간 점검: 이번 주(weekOffset=0) + 수~토(dayIdx 2~5) + 3일 이상 기록
    // 최종 코칭: 과거 주(weekOffset<0) + 5일 이상 기록
    let coaching = "";
    const showMid = weekOffset === 0 && dayIdx >= 2 && dayIdx <= 5 && tw.n >= 3;
    const showFinal = isComplete && tw.n >= 5;
    if (showMid || showFinal) {
      const pts = [];
      if (tw.avgP >= targets.p) pts.push(`단백질 평균 ${tw.avgP}g으로 목표 달성 중!`);
      else pts.push(`단백질이 목표보다 일평균 ${targets.p - tw.avgP}g 부족합니다. 닭가슴살 1팩(~30g)을 추가해보세요.`);
      const wkendFails = tw.daily.filter((d, i) => i >= 5 && d.has && !d.dHit).length;
      const calWord = mode === "maintain" ? "목표 유지" : "적자 유지";
      if (tw.dDays >= Math.ceil(tw.n * 0.7)) pts.push(`칼로리 ${calWord}율 좋습니다!`);
      else if (wkendFails > 0) pts.push("주말 칼로리 초과 경향 → 토요일 식단을 미리 계획해보세요.");
      else pts.push(`칼로리 ${calWord}를 더 신경 써보세요.`);
      if (tw.eDays >= 4) pts.push("운동 빈도 훌륭합니다!");
      else pts.push(`운동 ${tw.eDays}회 → 주 4회 이상 목표로!`);
      if (lw.n > 0) {
        const pd = tw.avgP - lw.avgP;
        if (pd > 10) pts.push(`단백질 지난 주 대비 +${pd}g 향상!`);
        else if (pd < -10) pts.push(`단백질 지난 주 대비 ${pd}g 감소.`);
      }
      coaching = showFinal ? pts.join(" ") : "중간 점검: " + pts.slice(0, 2).join(" ");
    }

    return { tw, lw, tg: grade(tw), lg: grade(lw), isComplete, dayIdx, showMid, showFinal, coaching, weekLabel: thisWeekDates[0].slice(5) + " ~ " + thisWeekDates[6].slice(5) };
  }, [allDays, targets, targetsByMode, mode, getWeekDates, weekOffset, appAdjust, tdeeHistory]);

  // ═══ 최근 8주 등급 트렌드 (점 인디케이터용) ═══
  const weekHistory = useMemo(() => {
    const todayStr = today();
    const todayDow = new Date(todayStr + "T12:00:00").getDay();
    const dayIdx = todayDow === 0 ? 6 : todayDow - 1;
    const grade = (w) => {
      if (w.n === 0) return { letter: "—", color: "#252525" };
      const s = (w.pDays / w.n) * 40 + (w.dDays / w.n) * 30 + Math.min(w.eDays / 4, 1) * 30;
      if (s >= 90) return { letter: "A+", color: "#5a9e6f" };
      if (s >= 80) return { letter: "A", color: "#5a9e6f" };
      if (s >= 70) return { letter: "B+", color: "#5a9e6f" };
      if (s >= 60) return { letter: "B", color: "#4a8fc9" };
      if (s >= 50) return { letter: "C+", color: "#d4af37" };
      if (s >= 40) return { letter: "C", color: "#d4af37" };
      if (s >= 30) return { letter: "D", color: "#e05252" };
      return { letter: "F", color: "#e05252" };
    };

    return Array.from({ length: 8 }, (_, i) => {
      const offset = i - 7; // -7 ~ 0
      const dates = getWeekDates(todayStr, offset);
      let pDays = 0, dDays = 0, eDays = 0, n = 0;
      dates.forEach(ds => {
        // 오늘은 미완성이므로 grade 계산에서 제외 (방어적 — UI는 isInProgress로 가려져 있지만 grade 객체 정확도 확보)
        if (!isCompletedDay(ds)) return;
        const dd = allDays[ds];
        if (!dd || ((!dd.meals || !dd.meals.length) && (!dd.exercises || !dd.exercises.length))) return;
        const a = aggregateDay(dd);
        const dM = dd.mode || "cut";
        n++;
        if (Math.round(a.p) >= targets.p) pDays++;
        if (isCalOk(a.k, a.ex, dayTargetK(dM, ds), dM)) dDays++;
        if ((dd.exercises || []).length > 0) eDays++;
      });
      const isCurrent = offset === 0;
      const isInProgress = isCurrent; // 이번 주는 항상 진행 중 (월요일에 자동으로 지난 주로 밀려남)
      const g = grade({ n, pDays, dDays, eDays });
      return { offset, grade: g, hasData: n > 0, isInProgress, dateRange: dates[0].slice(5) + "~" + dates[6].slice(5) };
    });
  }, [allDays, targets, targetsByMode, mode, getWeekDates, appAdjust, tdeeHistory]);

  // ═══ 패턴 분석 (Phase 3++) ═══
  const [analysisPeriodIdx, setAnalysisPeriodIdx] = useState(1); // 0:2주, 1:1개월, 2:3개월, 3:6개월
  const [analysisCategory, setAnalysisCategory] = useState("compare"); // compare / food / exercise / formula
  const periodOptions = [
    { idx: 0, label: "2주", days: 14, hint: "빠른 변화 감지" },
    { idx: 1, label: "1개월", days: 30, hint: "노이즈 적정 · 추천" },
    { idx: 2, label: "3개월", days: 90, hint: "트렌드 명확" },
    { idx: 3, label: "6개월", days: 180, hint: "장기 패턴" },
  ];

  const patternAnalysis = useMemo(() => {
    if (bodyLog.length < 4) return null;
    const period = periodOptions[analysisPeriodIdx];
    const sorted = [...bodyLog].sort((a, b) => a.date.localeCompare(b.date));
    const todayStr = today();

    // 분석 기간으로 데이터 자르기
    const startDate = (() => {
      const d = new Date(todayStr + "T12:00:00");
      d.setDate(d.getDate() - period.days);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    })();
    const periodBody = sorted.filter(b => b.date >= startDate);
    if (periodBody.length < 3) return null;

    // 주 단위로 그룹화 (월~일 기준)
    const weekGroups = {};
    periodBody.forEach(b => {
      const d = new Date(b.date + "T12:00:00");
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(d); monday.setDate(d.getDate() + diff);
      const wkKey = monday.getFullYear() + "-" + String(monday.getMonth() + 1).padStart(2, "0") + "-" + String(monday.getDate()).padStart(2, "0");
      if (!weekGroups[wkKey]) weekGroups[wkKey] = { startDate: wkKey, body: [], dates: [] };
      weekGroups[wkKey].body.push(b);
      weekGroups[wkKey].dates.push(b.date);
    });

    // 주별 변화량 + 식단/운동 집계
    const weeks = Object.values(weekGroups).map(w => {
      const sortedB = [...w.body].sort((a, b) => a.date.localeCompare(b.date));
      const startW = sortedB[0], endW = sortedB[sortedB.length - 1];
      const fatDelta = endW.fatPct - startW.fatPct;
      const muscleDelta = endW.muscle - startW.muscle;

      // 그 주의 식단/운동 데이터 수집
      const weekStartD = new Date(w.startDate + "T12:00:00");
      const foods = {}, exercises = {};
      let totP = 0, dayCount = 0, lateCount = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStartD); d.setDate(d.getDate() + i);
        const ds = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        // 오늘은 미완성이므로 패턴 분석(잘 빠진 주 vs 정체된 주 비교)에서 제외
        if (!isCompletedDay(ds)) continue;
        const dd = allDays[ds];
        if (!dd) continue;
        if ((dd.meals || []).length > 0) {
          dayCount++;
          (dd.meals || []).forEach(m => {
            foods[m.n] = (foods[m.n] || 0) + 1;
            totP += (m.p || 0) * (m.serving || 1);
            if ((m.hour || 0) >= 22) lateCount++;
          });
        }
        (dd.exercises || []).forEach(e => {
          exercises[e.n] = (exercises[e.n] || 0) + 1;
        });
      }
      return {
        weekStart: w.startDate, fatDelta, muscleDelta,
        foods, exercises,
        avgP: dayCount > 0 ? Math.round(totP / dayCount) : 0,
        exerciseCount: Object.values(exercises).reduce((s, v) => s + v, 0),
        lateCount,
        dayCount
      };
    }).filter(w => w.dayCount >= 3);

    if (weeks.length < 2) return null;

    // 잘 빠진 주 vs 정체된 주 분리
    const sortedByFat = [...weeks].sort((a, b) => a.fatDelta - b.fatDelta);
    const goodWeeks = sortedByFat.slice(0, Math.max(1, Math.floor(weeks.length / 3)));
    const badWeeks = sortedByFat.slice(-Math.max(1, Math.floor(weeks.length / 3)));

    // 음식 효과 랭킹 (잘 빠진 주에 더 많이 등장한 음식)
    const foodEffect = {};
    goodWeeks.forEach(w => Object.entries(w.foods).forEach(([n, c]) => {
      foodEffect[n] = foodEffect[n] || { good: 0, bad: 0 };
      foodEffect[n].good += c;
    }));
    badWeeks.forEach(w => Object.entries(w.foods).forEach(([n, c]) => {
      foodEffect[n] = foodEffect[n] || { good: 0, bad: 0 };
      foodEffect[n].bad += c;
    }));
    const goodFoods = Object.entries(foodEffect)
      .filter(([, v]) => v.good >= 3 && v.good > v.bad)
      .map(([n, v]) => ({ name: n, score: v.good - v.bad, count: v.good }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const badFoods = Object.entries(foodEffect)
      .filter(([, v]) => v.bad >= 3 && v.bad > v.good)
      .map(([n, v]) => ({ name: n, score: v.bad - v.good, count: v.bad }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // 운동 효과 (골격근 증가와 상관관계)
    const sortedByMuscle = [...weeks].sort((a, b) => b.muscleDelta - a.muscleDelta);
    const muscleGoodWeeks = sortedByMuscle.slice(0, Math.max(1, Math.floor(weeks.length / 3)));
    const exerciseEffect = {};
    muscleGoodWeeks.forEach(w => Object.entries(w.exercises).forEach(([n, c]) => {
      exerciseEffect[n] = (exerciseEffect[n] || 0) + c;
    }));
    const goodExercises = Object.entries(exerciseEffect)
      .map(([n, c]) => ({ name: n, count: c, weeklyAvg: Math.round(c / muscleGoodWeeks.length * 10) / 10 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 황금 공식 도출
    const avgP_good = goodWeeks.reduce((s, w) => s + w.avgP, 0) / goodWeeks.length;
    const avgEx_good = goodWeeks.reduce((s, w) => s + w.exerciseCount, 0) / goodWeeks.length;
    const avgLate_good = goodWeeks.reduce((s, w) => s + w.lateCount, 0) / goodWeeks.length;
    const avgP_bad = badWeeks.reduce((s, w) => s + w.avgP, 0) / badWeeks.length;
    const avgEx_bad = badWeeks.reduce((s, w) => s + w.exerciseCount, 0) / badWeeks.length;
    const avgLate_bad = badWeeks.reduce((s, w) => s + w.lateCount, 0) / badWeeks.length;

    return {
      period,
      bestWeek: goodWeeks[0],
      worstWeek: badWeeks[badWeeks.length - 1],
      goodFoods, badFoods, goodExercises,
      formula: {
        protein: Math.round(avgP_good),
        exercise: Math.round(avgEx_good * 10) / 10,
        lateAvoid: Math.round(avgLate_good * 10) / 10,
        topFood: goodFoods[0]?.name || "",
        topExercise: goodExercises[0]?.name || "",
      },
      diff: {
        proteinDelta: Math.round(avgP_good - avgP_bad),
        exerciseDelta: Math.round((avgEx_good - avgEx_bad) * 10) / 10,
        lateDelta: Math.round((avgLate_good - avgLate_bad) * 10) / 10,
      },
      weekCount: weeks.length,
      goodCount: goodWeeks.length,
      badCount: badWeeks.length,
    };
  }, [bodyLog, allDays, analysisPeriodIdx]);

  // ═══ 인사이트 데이터 ═══
  const insights = useMemo(() => {
    // 1. 황금 패턴: 체지방 감소 기간의 공통 행동
    let golden = null;
    if (bodyLog.length >= 4) {
      const sorted = [...bodyLog].sort((a, b) => a.date.localeCompare(b.date));
      const good = [], bad = [];
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1], curr = sorted[i];
        // 오늘 체성분을 측정한 경우 curr.date===오늘 → today partial 데이터가 평균을 왜곡하므로 제외
        const entries = Object.entries(allDays).filter(([d]) => d >= prev.date && d <= curr.date && isCompletedDay(d));
        if (entries.length < 3) continue;
        let tP = 0, tK = 0, tTk = 0, eD = 0, latD = 0;
        entries.forEach(([ds, data]) => { const a = aggregateDay(data); tP += a.p; tK += a.k; tTk += dayTargetK(data.mode || "cut", ds); if ((data.exercises || []).length > 0) eD++; if ((data.meals || []).some(m => (m.hour || 0) >= 22)) latD++; });
        const d = entries.length;
        const p = { avgP: Math.round(tP / d), avgK: Math.round(tK / d), avgTk: Math.round(tTk / d), weeklyEx: Math.round(eD / d * 7 * 10) / 10, lateRate: Math.round(latD / d * 100) };
        if (curr.fatPct < prev.fatPct) good.push(p); else if (curr.fatPct > prev.fatPct) bad.push(p);
      }
      if (good.length >= 2) {
        const avg = { avgP: Math.round(good.reduce((s, p) => s + p.avgP, 0) / good.length), avgK: Math.round(good.reduce((s, p) => s + p.avgK, 0) / good.length), avgTk: Math.round(good.reduce((s, p) => s + p.avgTk, 0) / good.length), weeklyEx: Math.round(good.reduce((s, p) => s + p.weeklyEx, 0) / good.length * 10) / 10, lateRate: Math.round(good.reduce((s, p) => s + p.lateRate, 0) / good.length) };
        const pats = [];
        if (avg.avgP >= targets.p * 0.9) pats.push(`단백질 ${avg.avgP}g+`);
        if (avg.weeklyEx >= 3.5) pats.push(`운동 주 ${Math.round(avg.weeklyEx)}회+`);
        if (avg.lateRate < 15) pats.push("야식 없음");
        if (avg.avgK <= avg.avgTk * 1.05) pats.push(`칼로리 ${avg.avgK} 이하`);
        golden = { patterns: pats, good: avg, count: good.length, total: good.length + bad.length };
      }
    }

    // 2. 이상치 감지 (이번 주)
    // 오늘은 미완성 데이터(아침만 먹은 상태 등)이므로 이상치 검사에서 제외
    const anomalies = [];
    const recentEntries = Object.entries(allDays).filter(([d]) => isCompletedDay(d)).sort(([a], [b]) => a.localeCompare(b));
    if (recentEntries.length >= 7) {
      const last14 = recentEntries.slice(-14);
      let sumP = 0, sumK = 0, sumEx = 0, cnt = 0;
      last14.forEach(([, d]) => { const a = aggregateDay(d); sumP += a.p; sumK += a.k; sumEx += a.ex; cnt++; });
      const avgP = cnt ? sumP / cnt : 0, avgK = cnt ? sumK / cnt : 0, avgEx = cnt ? sumEx / cnt : 0;

      const last7 = recentEntries.slice(-7);
      last7.forEach(([date, d]) => {
        const a = aggregateDay(d);
        if (avgP > 0 && a.p < avgP * 0.6) anomalies.push({ type: "warn", title: `${date.slice(5)} 단백질 ${Math.round(a.p)}g`, desc: `평소(${Math.round(avgP)}g) 대비 ${Math.round((1 - a.p / avgP) * 100)}% 부족` });
        if (avgK > 0 && a.k > avgK * 1.4) anomalies.push({ type: "warn", title: `${date.slice(5)} 칼로리 ${Math.round(a.k)}kcal`, desc: `평소(${Math.round(avgK)}) 대비 ${Math.round((a.k / avgK - 1) * 100)}% 초과` });
        if (a.ex > 0 && avgEx > 0 && a.ex > avgEx * 1.5) anomalies.push({ type: "good", title: `${date.slice(5)} 운동 소모 ${Math.round(a.ex)}kcal`, desc: `평소(${Math.round(avgEx)}) 대비 ${Math.round((a.ex / avgEx - 1) * 100)}% 초과 달성!` });
      });
    }

    // 3. 상관관계 발견
    const correlations = [];
    if (bodyLog.length >= 4) {
      const sorted = [...bodyLog].sort((a, b) => a.date.localeCompare(b.date));
      let hiP = [], loP = [], exD = [], noExD = [], lateD = [], noLateD = [];
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1], curr = sorted[i];
        const entries = Object.entries(allDays).filter(([d]) => d >= prev.date && d < curr.date);
        if (entries.length < 2) continue;
        let tP = 0; let eCount = 0, lateCount = 0;
        entries.forEach(([, d]) => { tP += aggregateDay(d).p; if ((d.exercises || []).length > 0) eCount++; if ((d.meals || []).some(m => (m.hour || 0) >= 22)) lateCount++; });
        const avgP2 = tP / entries.length;
        const dMuscle = curr.muscle - prev.muscle;
        const dWeight = curr.weight - prev.weight;
        if (avgP2 >= targets.p) hiP.push(dMuscle); else loP.push(dMuscle);
        if (eCount >= entries.length * 0.5) exD.push(dMuscle); else noExD.push(dMuscle);
        if (lateCount > 0) lateD.push(dWeight); else noLateD.push(dWeight);
      }
      const avg = arr => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 10) / 10 : 0;
      if (hiP.length >= 2 && loP.length >= 1) {
        const hi = avg(hiP), lo = avg(loP);
        correlations.push({ color: "#5a9e6f", title: `단백질 ${targets.p}g+ → 골격근 ${hi >= 0 ? "+" : ""}${hi}kg`, desc: `${hiP.length}회 관측 · 미달 시 ${lo >= 0 ? "+" : ""}${lo}kg` });
      }
      if (exD.length >= 2 && noExD.length >= 1) {
        const hi = avg(exD), lo = avg(noExD);
        correlations.push({ color: "#4a8fc9", title: `주 4회+ 운동 → 골격근 ${hi >= 0 ? "+" : ""}${hi}kg`, desc: `${exD.length}회 관측 · 미달 시 ${lo >= 0 ? "+" : ""}${lo}kg` });
      }
      if (lateD.length >= 2 && noLateD.length >= 1) {
        const la = avg(lateD), nla = avg(noLateD);
        if (la > nla + 0.1) correlations.push({ color: "#e05252", title: `야식(22시+) → 체중 ${la >= 0 ? "+" : ""}${la}kg`, desc: `${lateD.length}회 관측 · 야식 없을 때 ${nla >= 0 ? "+" : ""}${nla}kg` });
      }
    }

    // 4. 우선순위 액션
    const actions = [];
    const { tw } = weeklyReport;
    if (tw.n > 0) {
      if (tw.avgP < targets.p) actions.push(`단백질 일평균 ${targets.p - tw.avgP}g 부족 → 매 끼 단백질 보충`);
      const wkendOver = tw.daily.filter((d, i) => i >= 5 && d.has && !d.dHit).length;
      if (wkendOver > 0) actions.push("주말 칼로리 초과 → 토요일 식단 미리 입력");
      if (tw.eDays < 4) actions.push(`운동 ${tw.eDays}회 → 주 4회 이상 목표`);
      const lateDays = tw.daily.filter(d => d.has && d.lateEat).length;
      if (lateDays > 0) actions.push(`야식 ${lateDays}회 감지 → 22시 이후 식사 줄이기`);
    }
    if (!actions.length) actions.push("데이터를 더 쌓으면 맞춤 액션이 생성됩니다");

    return { golden, anomalies: anomalies.slice(0, 4), correlations, actions };
  }, [allDays, bodyLog, targets, targetsByMode, weeklyReport, appAdjust, tdeeHistory]);

  // 스파크라인 SVG 생성
  const sparklinePath = (entries, key, w = 60, h = 22) => {
    if (!entries || entries.length < 2) return { full: "", recent: "", lastX: 0, lastY: 0 };
    const vals = entries.map(e => e[key]);
    const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
    const pts = vals.map((v, i) => ({ x: Math.round(i / (vals.length - 1) * w), y: Math.round(2 + (h - 4) - ((v - min) / range) * (h - 4)) }));
    const full = pts.map(p => `${p.x},${p.y}`).join(" ");
    const half = Math.floor(pts.length / 2);
    const recent = pts.slice(half).map(p => `${p.x},${p.y}`).join(" ");
    const last = pts[pts.length - 1];
    return { full, recent, lastX: last.x, lastY: last.y };
  };

  // 기간탭 스타일
  const pTabStyle = (key) => ({ flex: 1, padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: summaryPeriod === key ? 500 : 400, color: summaryPeriod === key ? "#d4af37" : "#707070", background: "transparent", border: "none", borderBottom: summaryPeriod === key ? "2px solid #d4af37" : "2px solid transparent", cursor: "pointer" });

  // 도트매트릭스 렌더
  const DotMatrix = ({ label, thisDaily, lastDaily, field, color, thisDays, lastDays, thisN, lastN }) => {
    const delta = thisDays - lastDays;
    const thisLabel = weekOffset === 0 ? "이번 주" : weekOffset === -1 ? "지난 주" : `${Math.abs(weekOffset)}주 전`;
    const lastLabel = weekOffset === 0 ? "지난 주" : weekOffset === -1 ? "지지난 주" : `${Math.abs(weekOffset) + 1}주 전`;
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, color: "#f5f5f0", marginBottom: 6 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ minWidth: 52, fontSize: 10, color: "#707070" }}>{thisLabel}</div>
          <div style={{ display: "flex", gap: 3 }}>{thisDaily.map((d, i) => {
            // 오늘 dot은 미완성이므로 별도 시각: 흐린 배경 + 점선 outline (진행 중 의미)
            const bg = d.isToday && d.has
              ? `${color}1a`
              : (d.has ? (d[field] ? color : `${color}22`) : "#2a2a2a");
            const outline = d.isToday && d.has ? `1px dashed ${color}99` : "none";
            return <div key={i} style={{ width: 12, height: 12, borderRadius: 3, background: bg, outline, outlineOffset: -1 }} />;
          })}</div>
          <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 500, color, minWidth: 28, textAlign: "right" }}>{thisDays}/{thisN}</span>
          {lastN > 0 && delta !== 0 && <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 500, padding: "1px 6px", borderRadius: 99, background: delta > 0 ? "rgba(90,158,111,0.12)" : "rgba(224,82,82,0.12)", color: delta > 0 ? "#5a9e6f" : "#e05252" }}>{delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <div style={{ minWidth: 52, fontSize: 10, color: "#4a4a4a" }}>{lastLabel}</div>
          <div style={{ display: "flex", gap: 3 }}>{lastDaily.map((d, i) => <div key={i} style={{ width: 12, height: 12, borderRadius: 3, background: d.has ? (d[field] ? `${color}55` : `${color}15`) : "rgba(42,42,42,0.3)" }} />)}</div>
          <span style={{ fontSize: 12, fontFamily: "monospace", color: "#4a4a4a", minWidth: 28, textAlign: "right" }}>{lastDays}/{lastN}</span>
        </div>
        <div style={{ display: "flex", gap: 3, marginLeft: 60, marginTop: 2 }}>
          {["월", "화", "수", "목", "금", "토", "일"].map(l => <span key={l} style={{ width: 12, fontSize: 8, color: "#4a4a4a", textAlign: "center" }}>{l}</span>)}
        </div>
      </div>
    );
  };

  const tabBtn = (key, label) => ({ flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 500, background: statsTab === key ? THEME.gold : "transparent", color: statsTab === key ? "#141414" : THEME.sub, border: `1px solid ${THEME.borderLight}`, cursor: "pointer", transition: "all 0.15s" });

  // ── 가로모드 표시 재배치용 블록 추출 — 내부 계산·판정·조건부 렌더 무변경 ──
  // 기간별 체성분 변화 배너
  const summaryBanner = (
      <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ display: "flex", borderBottom: "0.5px solid rgba(255,255,255,0.06)" }}>
          {[["1w", "1주"], ["1m", "1개월"], ["3m", "3개월"], ["all", "전체"]].map(([k, l]) => (
            <button key={k} onClick={() => setSummaryPeriod(k)} style={pTabStyle(k)}>{l}</button>
          ))}
        </div>
        <div style={{ padding: "14px 16px 12px" }}>
          {periodSummary ? (<>
            <div style={{ fontSize: 10, color: "#4a4a4a", marginBottom: 10, textAlign: "right" }}>{periodSummary.dateLabel} · 측정 {periodSummary.cnt}회</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { label: "체중", delta: periodSummary.dW, unit: "kg", good: periodSummary.gW, key: "weight", from: periodSummary.from.weight, to: periodSummary.to.weight, color: periodSummary.gW ? "#5a9e6f" : "#e05252", goodDir: "down" },
                { label: "체지방률", delta: periodSummary.dF, unit: "%p", good: periodSummary.gF, key: "fatPct", from: periodSummary.from.fatPct, to: periodSummary.to.fatPct, color: periodSummary.gF ? "#5a9e6f" : "#e05252", goodDir: "down" },
                { label: "골격근", delta: periodSummary.dM, unit: "kg", good: periodSummary.gM, key: "muscle", from: periodSummary.from.muscle, to: periodSummary.to.muscle, color: periodSummary.gM ? "#5a9e6f" : "#e05252", goodDir: "up" },
              ].map((x, i) => {
                const sp = sparklinePath(periodSummary.spark, x.key);
                const dimColor = x.color + "40";
                return (
                  <div key={i} style={{ background: "#252525", borderRadius: 10, padding: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#707070", marginBottom: 4 }}>{x.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: x.color }}>{x.delta >= 0 ? "+" : ""}{x.delta}</div>
                    <div style={{ fontSize: 9, color: "#4a4a4a", margin: "2px 0" }}>{x.unit}</div>
                    <svg width="60" height="22" viewBox="0 0 60 22" style={{ display: "block", margin: "6px auto 0" }}>
                      <polyline points={sp.full} fill="none" stroke={dimColor} strokeWidth="1.5" strokeLinecap="round" />
                      <polyline points={sp.recent} fill="none" stroke={x.color} strokeWidth="2" strokeLinecap="round" />
                      <circle cx={sp.lastX} cy={sp.lastY} r="2" fill={x.color} />
                    </svg>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontSize: 9, color: "#4a4a4a" }}>{x.from}</span>
                      <span style={{ fontSize: 9, color: x.color, fontWeight: 500 }}>{x.to}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 10, background: `${periodSummary.sColor}0F`, border: `0.5px solid ${periodSummary.sColor}25`, borderRadius: 8, padding: "10px 12px" }}>
              <span style={{ fontSize: 11.5, color: periodSummary.sColor, lineHeight: 1.6 }}>{periodSummary.status}</span>
            </div>
          </>) : (
            <div style={{ textAlign: "center", padding: 20 }}>
              {bodyLog.length < 2
                ? <div style={{ fontSize: 12, color: "#4a4a4a" }}>체성분 2회 이상 측정하면 변화가 표시됩니다<br/><span style={{ fontSize: 11, color: "#707070", marginTop: 4, display: "inline-block" }}>현재 {bodyLog.length}회 · {totalDays}일 기록</span></div>
                : <div style={{ fontSize: 12, color: "#4a4a4a" }}>선택 기간에 측정 데이터가 부족합니다</div>
              }
            </div>
          )}
        </div>
      </div>
  );

  // 서브탭 바 + 선택된 서브탭 콘텐츠 (주간 성적표 / 나의 인사이트 / 커뮤니티)
  const subTabsSection = (
    <>
      {/* 탭 전환 */}
      <div style={{ display: "flex", gap: 0, marginBottom: 14, borderRadius: 8, overflow: "hidden" }}>
        <button onClick={() => setStatsTab("report")} style={{ ...tabBtn("report"), borderRadius: "8px 0 0 8px" }}>주간 성적표</button>
        <button onClick={() => setStatsTab("insight")} style={{ ...tabBtn("insight"), borderRadius: 0 }}>나의 인사이트</button>
        <button onClick={() => setStatsTab("community")} style={{ ...tabBtn("community"), borderRadius: "0 8px 8px 0" }}>커뮤니티</button>
      </div>

      {/* ═══ 주간 성적표 ═══ */}
      {statsTab === "report" && (<>
        {/* 점 인디케이터 (최근 8주 등급 트렌드) */}
        <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "#707070" }}>주차 선택</span>
            <span style={{ fontSize: 10, color: "#d4af37" }}>
              {weekOffset === 0 ? "이번 주" : weekOffset === -1 ? "지난 주" : `${Math.abs(weekOffset)}주 전`} · {weeklyReport.weekLabel}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
            {weekHistory.map((w, i) => {
              const isSelected = w.offset === weekOffset;
              const dotColor = !w.hasData ? "#252525" : w.isInProgress ? "#4a4a4a" : w.grade.color;
              return (
                <div key={i} onClick={() => setWeekOffset(w.offset)}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", padding: "4px 0" }}
                  title={`${w.dateRange} · ${w.isInProgress ? "진행 중" : w.grade.letter}`}>
                  <div style={{
                    width: isSelected ? 14 : 10,
                    height: isSelected ? 14 : 10,
                    borderRadius: "50%",
                    background: isSelected ? "#d4af37" : `${dotColor}99`,
                    border: isSelected ? "2px solid #fff" : w.isInProgress ? "1.5px dashed #4a4a4a" : "none",
                    boxShadow: isSelected ? "0 0 8px rgba(212,175,55,0.4)" : "none",
                    transition: "all 0.2s"
                  }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: 8, color: "#555" }}>7주 전</span>
            <span style={{ fontSize: 8, color: "#555" }}>이번 주</span>
          </div>
        </div>

        {/* 헤더: 지난 주 확정 + 이번 주 등급 (일요일 공개) */}
        <div style={{ background: "#1e1e1e", border: `1px solid ${weeklyReport.isComplete ? "rgba(212,175,55,0.3)" : "rgba(255,255,255,0.06)"}`, borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#707070" }}>{weeklyReport.weekLabel}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#f5f5f0", marginTop: 2 }}>주간 성적표</div>
              {weekOffset === 0 && <div style={{ fontSize: 10, color: "#4a8fc9", marginTop: 4 }}>진행 중 · {weeklyReport.dayIdx + 1}/7일</div>}
              {weeklyReport.isComplete && weeklyReport.tw.n > 0 && <div style={{ fontSize: 10, color: "#5a9e6f", marginTop: 4 }}>완료 · {weeklyReport.tw.n}일 기록</div>}
              {weeklyReport.isComplete && weeklyReport.tw.n === 0 && <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>기록 없음</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {weeklyReport.lw.n > 0 && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "#555", marginBottom: 2 }}>{weekOffset === 0 ? "지난 주" : weekOffset === -1 ? "지지난 주" : `${Math.abs(weekOffset) + 1}주 전`}</div>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 600, fontFamily: "monospace", border: `2px solid ${weeklyReport.lg.color}55`, color: weeklyReport.lg.color, opacity: weeklyReport.isComplete ? 0.5 : 1 }}>{weeklyReport.lg.letter}</div>
                </div>
              )}
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 9, color: weeklyReport.isComplete ? "#d4af37" : "#555", marginBottom: 2 }}>{weekOffset === 0 ? "이번 주" : weekOffset === -1 ? "지난 주" : `${Math.abs(weekOffset)}주 전`}</div>
                {weeklyReport.isComplete ? (
                  <div style={{ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, fontFamily: "monospace", border: `2px solid ${weeklyReport.tg.color}`, background: `${weeklyReport.tg.color}15`, color: weeklyReport.tg.color }}>{weeklyReport.tg.letter}</div>
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 600, border: "2px dashed #4a4a4a", color: "#4a4a4a" }}>?</div>
                )}
              </div>
            </div>
          </div>
          {weekOffset === 0 && <div style={{ textAlign: "center", marginTop: 10, fontSize: 10, color: "#555" }}>이번 주 등급은 월요일 0시에 공개!</div>}
        </div>

        {/* 코칭 (헤더 바로 아래) */}
        {weeklyReport.coaching && (
          <div style={{ background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.15)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#d4af37", fontWeight: 600, marginBottom: 4 }}>{weekOffset === 0 ? (weeklyReport.showFinal ? "이번 주 코칭" : "중간 점검 코칭") : `${weekOffset === -1 ? "지난 주" : Math.abs(weekOffset) + "주 전"} 코칭`}</div>
            <div style={{ fontSize: 11.5, color: "#d4af37", lineHeight: 1.6 }}>{weeklyReport.coaching}</div>
          </div>
        )}

        {/* 도트매트릭스 비교 */}
        <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#707070", marginBottom: 12 }}>핵심 지표 달성률</div>
          <DotMatrix label={`단백질 목표 (${targets.p}g+)`} thisDaily={weeklyReport.tw.daily} lastDaily={weeklyReport.lw.daily} field="pHit" color="#5a9e6f" thisDays={weeklyReport.tw.pDays} lastDays={weeklyReport.lw.pDays} thisN={weeklyReport.tw.n} lastN={weeklyReport.lw.n} />
          <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "4px 0 14px" }} />
          <DotMatrix label={`섭취 목표 달성 (${targets.k}kcal + 운동${mode === "maintain" ? "100" : "50"}%)`} thisDaily={weeklyReport.tw.daily} lastDaily={weeklyReport.lw.daily} field="dHit" color="#d4af37" thisDays={weeklyReport.tw.dDays} lastDays={weeklyReport.lw.dDays} thisN={weeklyReport.tw.n} lastN={weeklyReport.lw.n} />
          <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "4px 0 14px" }} />
          <DotMatrix label="운동 실행 (주 4회+ 목표)" thisDaily={weeklyReport.tw.daily} lastDaily={weeklyReport.lw.daily} field="eHit" color="#4a8fc9" thisDays={weeklyReport.tw.eDays} lastDays={weeklyReport.lw.eDays} thisN={weeklyReport.tw.n} lastN={weeklyReport.lw.n} />
        </div>

        {/* 주간 평균 수치 */}
        {weeklyReport.tw.n > 0 && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 10 }}>주간 평균</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { l: "단백질", v: weeklyReport.tw.avgP, u: "g", c: "#4a8fc9", lv: weeklyReport.lw.avgP },
                { l: "칼로리", v: weeklyReport.tw.avgK, u: "kcal", c: "#5a9e6f", lv: weeklyReport.lw.avgK },
                { l: "운동소모", v: weeklyReport.tw.avgEx, u: "kcal", c: "#4a8fc9", lv: weeklyReport.lw.avgEx },
              ].map((x, i) => {
                const d = weeklyReport.lw.n > 0 ? x.v - x.lv : null;
                return (
                  <div key={i} style={{ background: "#252525", borderRadius: 8, padding: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#707070" }}>{x.l}</div>
                    <div style={{ fontSize: 16, fontWeight: 500, fontFamily: "monospace", color: "#f5f5f0", marginTop: 2 }}>{x.v.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: "#707070" }}>{x.u}</div>
                    {d !== null && d !== 0 && <div style={{ fontSize: 10, fontFamily: "monospace", marginTop: 4, color: ((x.l === "칼로리" && d < 0) || (x.l !== "칼로리" && d > 0)) ? "#5a9e6f" : "#e05252" }}>{d > 0 ? "+" : ""}{d}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {weeklyReport.tw.n === 0 && (
          <div style={{ textAlign: "center", padding: 32, color: "#4a4a4a", fontSize: 13 }}>이번 주 기록이 아직 없습니다. 식단/운동을 기록해보세요!</div>
        )}
      </>)}

      {/* ═══ 나의 인사이트 ═══ */}
      {statsTab === "insight" && (<>
        {/* 패턴 분석 (슬라이더 + 스토리) */}
        {patternAnalysis && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 16, padding: 14, marginBottom: 12 }}>
            {/* 헤더 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#f5f5f0" }}>📊 패턴 분석</div>
              <div style={{ fontSize: 9, color: "#707070" }}>{patternAnalysis.weekCount}주 데이터 분석</div>
            </div>

            {/* 슬라이더 (분석 기간) */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ fontSize: 9, color: "#707070" }}>분석 기간</span>
              <span style={{ fontSize: 14, color: "#d4af37", fontWeight: 600 }}>{patternAnalysis.period.label}</span>
            </div>
            <div style={{ position: "relative", height: 28, display: "flex", alignItems: "center", marginBottom: 4 }}>
              <div style={{ position: "absolute", left: 12, right: 12, height: 3, background: "#252525", borderRadius: 2 }} />
              <div style={{ position: "absolute", left: 12, width: `calc((100% - 24px) * ${analysisPeriodIdx / 3})`, height: 3, background: "linear-gradient(90deg, #5a9e6f, #d4af37)", borderRadius: 2 }} />
              {[0, 1, 2, 3].map(i => (
                <div key={i} onClick={() => setAnalysisPeriodIdx(i)}
                  style={{
                    position: "absolute",
                    left: `calc(12px + (100% - 24px) * ${i / 3} - 12px)`,
                    width: 24, height: 24,
                    borderRadius: "50%",
                    background: i === analysisPeriodIdx ? "#1e1e1e" : "transparent",
                    border: i === analysisPeriodIdx ? "2px solid #d4af37" : i < analysisPeriodIdx ? "2px solid #5a9e6f" : "2px solid #4a4a4a",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: i === analysisPeriodIdx ? "0 0 12px rgba(212,175,55,0.3)" : "none",
                    transition: "all 0.2s"
                  }}>
                  {i === analysisPeriodIdx && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#d4af37" }} />}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#555", padding: "0 4px" }}>
              {periodOptions.map(p => <span key={p.idx} style={{ color: p.idx === analysisPeriodIdx ? "#d4af37" : "#555" }}>{p.label}</span>)}
            </div>
            <div style={{ fontSize: 9, color: "#707070", textAlign: "center", marginTop: 4, fontStyle: "italic" }}>{patternAnalysis.period.hint}</div>

            {/* 분석 항목 토글 */}
            <div style={{ display: "flex", gap: 3, marginTop: 12, marginBottom: 16 }}>
              {[
                { k: "compare", l: "📅 비교" },
                { k: "food", l: "🍱 음식" },
                { k: "exercise", l: "💪 운동" },
                { k: "formula", l: "🎯 공식" },
              ].map(t => (
                <button key={t.k} onClick={() => setAnalysisCategory(t.k)}
                  style={{
                    flex: 1, padding: 6, fontSize: 10,
                    background: analysisCategory === t.k ? "rgba(212,175,55,0.15)" : "#252525",
                    border: analysisCategory === t.k ? "1px solid #d4af37" : "1px solid transparent",
                    borderRadius: 4,
                    color: analysisCategory === t.k ? "#d4af37" : "#999",
                    fontWeight: analysisCategory === t.k ? 500 : 400,
                    cursor: "pointer"
                  }}>{t.l}</button>
              ))}
            </div>

            {/* 스토리 타임라인 */}
            {analysisCategory === "compare" && (
              <>
                <div style={{ position: "relative", paddingLeft: 22, marginBottom: 12, borderLeft: "2px solid #d4af37" }}>
                  <div style={{ position: "absolute", left: -7, top: 0, width: 12, height: 12, borderRadius: "50%", background: "#d4af37" }} />
                  <div style={{ fontSize: 9, color: "#d4af37", marginBottom: 2 }}>단계 1</div>
                  <div style={{ fontSize: 12, color: "#f5f5f0", fontWeight: 500, marginBottom: 6 }}>잘 빠진 주는?</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 1, background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 6, padding: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 8, color: "#5a9e6f" }}>최고</div>
                      <div style={{ fontSize: 10, color: "#f5f5f0", marginTop: 2 }}>{patternAnalysis.bestWeek.weekStart.slice(5)} 주</div>
                      <div style={{ fontSize: 11, color: "#5a9e6f", marginTop: 2, fontWeight: 500 }}>{patternAnalysis.bestWeek.fatDelta > 0 ? "+" : ""}{patternAnalysis.bestWeek.fatDelta.toFixed(1)}%</div>
                    </div>
                    <div style={{ flex: 1, background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.2)", borderRadius: 6, padding: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 8, color: "#e05252" }}>정체</div>
                      <div style={{ fontSize: 10, color: "#f5f5f0", marginTop: 2 }}>{patternAnalysis.worstWeek.weekStart.slice(5)} 주</div>
                      <div style={{ fontSize: 11, color: "#e05252", marginTop: 2, fontWeight: 500 }}>{patternAnalysis.worstWeek.fatDelta > 0 ? "+" : ""}{patternAnalysis.worstWeek.fatDelta.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>

                <div style={{ position: "relative", paddingLeft: 22, marginBottom: 12, borderLeft: "2px solid #5a9e6f" }}>
                  <div style={{ position: "absolute", left: -7, top: 0, width: 12, height: 12, borderRadius: "50%", background: "#5a9e6f" }} />
                  <div style={{ fontSize: 9, color: "#5a9e6f", marginBottom: 2 }}>단계 2</div>
                  <div style={{ fontSize: 12, color: "#f5f5f0", fontWeight: 500, marginBottom: 4 }}>식단 차이는?</div>
                  <div style={{ background: "#252525", borderRadius: 6, padding: 8, fontSize: 10, color: "#c0b896", lineHeight: 1.7 }}>
                    {patternAnalysis.diff.proteinDelta > 0 ? `단백질 +${patternAnalysis.diff.proteinDelta}g/일 더 섭취` : `단백질 ${patternAnalysis.diff.proteinDelta}g/일 차이`}
                    {patternAnalysis.diff.lateDelta < 0 && <><br />야식 {Math.abs(patternAnalysis.diff.lateDelta)}회/주 줄임</>}
                  </div>
                </div>

                <div style={{ position: "relative", paddingLeft: 22, marginBottom: 12, borderLeft: "2px solid #4a8fc9" }}>
                  <div style={{ position: "absolute", left: -7, top: 0, width: 12, height: 12, borderRadius: "50%", background: "#4a8fc9" }} />
                  <div style={{ fontSize: 9, color: "#4a8fc9", marginBottom: 2 }}>단계 3</div>
                  <div style={{ fontSize: 12, color: "#f5f5f0", fontWeight: 500, marginBottom: 4 }}>운동 차이는?</div>
                  <div style={{ background: "#252525", borderRadius: 6, padding: 8, fontSize: 10, color: "#c0b896", lineHeight: 1.7 }}>
                    {patternAnalysis.diff.exerciseDelta > 0 ? `운동 +${patternAnalysis.diff.exerciseDelta}회/주 더 실행` : `운동 ${patternAnalysis.diff.exerciseDelta}회/주 차이`}
                  </div>
                </div>

                <div style={{ position: "relative", paddingLeft: 22, borderLeft: "2px solid #d4af37" }}>
                  <div style={{ position: "absolute", left: -7, top: 0, width: 12, height: 12, borderRadius: "50%", background: "#d4af37", boxShadow: "0 0 8px rgba(212,175,55,0.5)" }} />
                  <div style={{ fontSize: 9, color: "#d4af37", marginBottom: 2 }}>결론</div>
                  <div style={{ fontSize: 12, color: "#f5f5f0", fontWeight: 500, marginBottom: 4 }}>핵심 포인트</div>
                  <div style={{ background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 6, padding: 8, fontSize: 10, color: "#c0b896", lineHeight: 1.7 }}>
                    잘 빠진 주에는 단백질 평균 {patternAnalysis.formula.protein}g+, 운동 {patternAnalysis.formula.exercise}회/주를 유지했습니다.
                  </div>
                </div>
              </>
            )}

            {analysisCategory === "food" && (
              <>
                {patternAnalysis.goodFoods.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "#5a9e6f", fontWeight: 500, marginBottom: 8 }}>🍱 효과 있던 음식 TOP {patternAnalysis.goodFoods.length}</div>
                    {patternAnalysis.goodFoods.map((f, i) => {
                      const max = patternAnalysis.goodFoods[0].count;
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: i < patternAnalysis.goodFoods.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                          <span style={{ fontSize: 11, color: i === 0 ? "#d4af37" : "#999", width: 14, textAlign: "center", fontWeight: i === 0 ? 600 : 400 }}>{i + 1}</span>
                          <span style={{ flex: 1, fontSize: 11, color: "#f5f5f0" }}>{f.name}</span>
                          <div style={{ width: 60, height: 5, background: "#252525", borderRadius: 3, overflow: "hidden" }}><div style={{ width: (f.count / max * 100) + "%", height: "100%", background: "#5a9e6f", borderRadius: 3 }} /></div>
                          <span style={{ fontSize: 9, color: "#5a9e6f", width: 28, textAlign: "right" }}>{f.count}회</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {patternAnalysis.badFoods.length > 0 && (
                  <div style={{ background: "rgba(224,82,82,0.04)", border: "1px solid rgba(224,82,82,0.15)", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 11, color: "#e05252", fontWeight: 500, marginBottom: 6 }}>⚠️ 주의 음식</div>
                    <div style={{ fontSize: 10, color: "#c0b896", lineHeight: 1.7 }}>
                      {patternAnalysis.badFoods.map(f => `${f.name} (${f.count}회)`).join(" · ")}
                    </div>
                    <div style={{ fontSize: 9, color: "#707070", marginTop: 4 }}>정체된 주에 자주 등장한 음식</div>
                  </div>
                )}
                {patternAnalysis.goodFoods.length === 0 && patternAnalysis.badFoods.length === 0 && (
                  <div style={{ textAlign: "center", padding: 20, color: "#555", fontSize: 11 }}>분석할 음식 데이터가 부족합니다.</div>
                )}
              </>
            )}

            {analysisCategory === "exercise" && (
              <>
                {patternAnalysis.goodExercises.length > 0 ? (
                  <>
                    <div style={{ fontSize: 11, color: "#4a8fc9", fontWeight: 500, marginBottom: 8 }}>💪 골격근 증가에 효과적인 운동</div>
                    {patternAnalysis.goodExercises.map((e, i) => {
                      const max = patternAnalysis.goodExercises[0].count;
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < patternAnalysis.goodExercises.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                          <span style={{ fontSize: 11, color: i === 0 ? "#d4af37" : "#999", width: 14, textAlign: "center", fontWeight: i === 0 ? 600 : 400 }}>{i + 1}</span>
                          <span style={{ flex: 1, fontSize: 11, color: "#f5f5f0" }}>{e.name}</span>
                          <div style={{ width: 60, height: 5, background: "#252525", borderRadius: 3, overflow: "hidden" }}><div style={{ width: (e.count / max * 100) + "%", height: "100%", background: "#4a8fc9", borderRadius: 3 }} /></div>
                          <span style={{ fontSize: 9, color: "#4a8fc9", width: 36, textAlign: "right" }}>{e.weeklyAvg}회/주</span>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: 20, color: "#555", fontSize: 11 }}>분석할 운동 데이터가 부족합니다.</div>
                )}
              </>
            )}

            {analysisCategory === "formula" && (
              <div style={{ background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 13, color: "#d4af37", fontWeight: 600, marginBottom: 10 }}>🎯 너의 황금 공식</div>
                <div style={{ fontSize: 11, color: "#c0b896", lineHeight: 2 }}>
                  ✓ 단백질 <strong style={{ color: "#5a9e6f" }}>{patternAnalysis.formula.protein}g+/일</strong><br />
                  ✓ 운동 <strong style={{ color: "#4a8fc9" }}>{patternAnalysis.formula.exercise}회+/주</strong><br />
                  ✓ 야식 <strong style={{ color: "#e05252" }}>{patternAnalysis.formula.lateAvoid.toFixed(1)}회/주 이하</strong>
                  {patternAnalysis.formula.topFood && <><br />✓ 추천 음식: <strong style={{ color: "#5a9e6f" }}>{patternAnalysis.formula.topFood}</strong></>}
                  {patternAnalysis.formula.topExercise && <><br />✓ 추천 운동: <strong style={{ color: "#4a8fc9" }}>{patternAnalysis.formula.topExercise}</strong></>}
                </div>
                <div style={{ fontSize: 9, color: "#707070", marginTop: 10, lineHeight: 1.5 }}>잘 빠진 주 {patternAnalysis.goodCount}개를 분석한 너만의 패턴입니다.</div>
              </div>
            )}
          </div>
        )}

        {!patternAnalysis && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#707070", lineHeight: 1.6 }}>패턴 분석을 위해<br/>체성분 측정 4회 이상 + 식단/운동 데이터가 필요합니다.</div>
          </div>
        )}

        {/* 황금 패턴 */}
        {insights.golden && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#d4af37" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#d4af37" }}>당신의 황금 패턴</span>
            </div>
            <div style={{ fontSize: 11.5, color: "#ccc", lineHeight: 1.6, marginBottom: 10 }}>체지방이 감소한 {insights.golden.count}개 기간의 공통점:</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {insights.golden.patterns.map((p, i) => <span key={i} style={{ display: "inline-block", fontSize: 10, padding: "3px 8px", borderRadius: 99, fontWeight: 500, background: "rgba(212,175,55,0.12)", color: "#d4af37" }}>{p}</span>)}
            </div>
            <div style={{ fontSize: 10, color: "#707070", marginTop: 8 }}>전체 {insights.golden.total}개 측정 기간 기반 분석</div>
          </div>
        )}

        {/* 이상치 감지 */}
        {insights.anomalies.length > 0 && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 10 }}>최근 이상치 감지</div>
            {insights.anomalies.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < insights.anomalies.length - 1 ? "0.5px solid rgba(255,255,255,0.04)" : "none" }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, background: a.type === "warn" ? "rgba(224,82,82,0.12)" : "rgba(90,158,111,0.12)" }}>
                  <span style={{ color: a.type === "warn" ? "#e05252" : "#5a9e6f" }}>{a.type === "warn" ? "!" : "★"}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#f5f5f0", fontWeight: 500 }}>{a.title}</div>
                  <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>{a.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 상관관계 발견 */}
        {insights.correlations.length > 0 && (
          <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 10 }}>상관관계 발견</div>
            {insights.correlations.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: i < insights.correlations.length - 1 ? "0.5px solid rgba(255,255,255,0.04)" : "none" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.color, marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: "#f5f5f0", fontWeight: 500 }}>{c.title}</div>
                  <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>{c.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 우선순위 액션 */}
        <div style={{ background: "rgba(212,175,55,0.04)", border: "1px solid rgba(212,175,55,0.15)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#d4af37", fontWeight: 600, marginBottom: 8 }}>이번 주 우선순위 액션</div>
          {insights.actions.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: i < insights.actions.length - 1 ? 6 : 0 }}>
              <span style={{ fontSize: 11, color: "#d4af37", fontWeight: 600, minWidth: 14 }}>{i + 1}.</span>
              <span style={{ fontSize: 11, color: "#ccc", lineHeight: 1.5 }}>{a}</span>
            </div>
          ))}
        </div>

        {/* 데이터 부족 안내 */}
        {!insights.golden && insights.anomalies.length === 0 && insights.correlations.length === 0 && (
          <div style={{ textAlign: "center", padding: 32, color: "#4a4a4a", fontSize: 13, lineHeight: 1.6 }}>체성분 측정 4회 이상 + 식단 기록 14일 이상이면<br/>의미 있는 인사이트가 생성됩니다.</div>
        )}
      </>)}

      {/* ═══ 커뮤니티 ═══ */}
      {statsTab === "community" && (<>
        {/* 챌린지 */}
        {(() => {
          const thisWeekDates = (() => {
            const d = new Date(today() + "T12:00:00");
            const day = d.getDay();
            const diff = day === 0 ? -6 : 1 - day;
            return Array.from({ length: 7 }, (_, i) => {
              const dd = new Date(d); dd.setDate(d.getDate() + diff + i);
              return dd.getFullYear() + "-" + String(dd.getMonth() + 1).padStart(2, "0") + "-" + String(dd.getDate()).padStart(2, "0");
            });
          })();
          // 오늘은 미완성이므로 챌린지 달성률 계산에서 제외 (eHits 운동 챌린지도 동일)
          const pHits = thisWeekDates.filter(ds => {
            if (!isCompletedDay(ds)) return false;
            const dd = allDays[ds]; if (!dd || !dd.meals || !dd.meals.length) return false;
            const p = (dd.meals || []).reduce((s, ml) => s + ml.p * ml.serving, 0);
            return p >= targets.p;
          }).length;
          const recorded = thisWeekDates.filter(ds => isCompletedDay(ds) && allDays[ds] && allDays[ds].meals && allDays[ds].meals.length > 0).length;
          const pct = recorded > 0 ? Math.round(pHits / recorded * 100) : 0;
          const eHits = thisWeekDates.filter(ds => {
            const dd = allDays[ds]; return dd && dd.exercises && dd.exercises.length > 0;
          }).length;
          const ePct = Math.round(Math.min(eHits / 4, 1) * 100);

          return (
            <>
              <div style={{ background: "#1e1e1e", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#d4af37" }}>이번 주 단백질 챌린지</div>
                    <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>매일 단백질 {targets.p}g 이상 달성하기</div>
                  </div>
                  <div style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: "rgba(212,175,55,0.15)", color: "#d4af37" }}>참여 중</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "#999" }}>나의 달성률</span>
                  <span style={{ fontSize: 10, color: pct >= 70 ? "#5a9e6f" : "#d4af37" }}>{pct}% ({pHits}/{recorded}일)</span>
                </div>
                <div style={{ height: 6, background: "#252525", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}><div style={{ width: pct + "%", height: "100%", background: pct >= 70 ? "#5a9e6f" : "#d4af37", borderRadius: 3, transition: "width 0.3s" }} /></div>

                <div style={{ fontSize: 10, color: "#707070", marginBottom: 6 }}>리더보드</div>
                {[
                  { rank: 1, name: "GymHero", pct: 100, color: "#d4af37" },
                  { rank: 2, name: "FitTracker", pct: 86, color: "#5a9e6f" },
                  { rank: 3, name: "HealthyDan", pct: 83, color: "#5a9e6f" },
                  { rank: null, name: "나 (Daniel)", pct, color: "#4a8fc9", me: true },
                ].sort((a, b) => b.pct - a.pct).map((u, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.04)" : "none", background: u.me ? "rgba(74,143,201,0.06)" : "transparent", borderRadius: u.me ? 6 : 0, padding: u.me ? "6px 8px" : "6px 0" }}>
                    <span style={{ fontSize: 11, color: i === 0 ? "#d4af37" : "#555", width: 16, textAlign: "center" }}>{i + 1}</span>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: `${u.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 500, color: u.color }}>{u.name.slice(0, 2).toUpperCase()}</div>
                    <span style={{ flex: 1, fontSize: 11, color: u.me ? "#4a8fc9" : "#f5f5f0" }}>{u.name}</span>
                    <span style={{ fontSize: 11, color: u.pct >= 80 ? "#5a9e6f" : "#d4af37" }}>{u.pct}%</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#4a8fc9" }}>운동 습관 챌린지</div>
                    <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>이번 주 운동 4회 이상 실행</div>
                  </div>
                  <div style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: "rgba(74,143,201,0.15)", color: "#4a8fc9" }}>참여 중</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "#999" }}>진행률</span>
                  <span style={{ fontSize: 10, color: ePct >= 75 ? "#5a9e6f" : "#d4af37" }}>{eHits}/4회 ({ePct}%)</span>
                </div>
                <div style={{ height: 6, background: "#252525", borderRadius: 3, overflow: "hidden" }}><div style={{ width: ePct + "%", height: "100%", background: ePct >= 75 ? "#5a9e6f" : "#d4af37", borderRadius: 3 }} /></div>
              </div>
            </>
          );
        })()}

        {/* 나의 위치 (벤치마크) */}
        {latest && (() => {
          const wt = latest.weight || 75;
          const refData = wt < 70 ? { label: "남성 60~70kg", avgFat: 21.5, avgMuscle: 30.2, avgP: 110, topExercises: ["런닝", "벤치프레스", "스쿼트", "풀업", "사이클"] }
            : wt < 80 ? { label: "남성 70~80kg", avgFat: 23.4, avgMuscle: 33.5, avgP: 128, topExercises: ["벤치프레스", "스쿼트", "데드리프트", "런닝", "랫풀다운"] }
            : { label: "남성 80~90kg", avgFat: 25.1, avgMuscle: 35.8, avgP: 142, topExercises: ["스쿼트", "벤치프레스", "데드리프트", "레그프레스", "런닝"] };

          const fatPct = latest.fatPct || 22;
          const fatRank = fatPct <= 15 ? "상위 10%" : fatPct <= 18 ? "상위 20%" : fatPct <= 22 ? "상위 35%" : fatPct <= 25 ? "상위 50%" : "하위 40%";
          const fatPos = Math.max(5, Math.min(95, 100 - ((fatPct - 10) / 25 * 100)));

          const weekP = (() => {
            // 오늘은 미완성이므로 평균에서 제외 → 완성된 최근 7일만
            const last7 = Object.entries(allDays).filter(([d]) => isCompletedDay(d)).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
            if (last7.length === 0) return 0;
            const total = last7.reduce((s, [, d]) => s + (d.meals || []).reduce((ms, ml) => ms + ml.p * ml.serving, 0), 0);
            return Math.round(total / last7.length);
          })();
          const pRank = weekP >= 180 ? "상위 10%" : weekP >= 150 ? "상위 25%" : weekP >= 120 ? "상위 40%" : weekP >= 90 ? "상위 60%" : "하위 30%";
          const pPos = Math.max(5, Math.min(95, (weekP - 60) / 160 * 100));

          return (
            <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "#f5f5f0", marginBottom: 4 }}>나의 위치</div>
              <div style={{ fontSize: 10, color: "#707070", marginBottom: 14 }}>{refData.label} 기준 · 표준 참고 데이터</div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "#e05252" }}>체지방률</span>
                  <span style={{ fontSize: 11, color: "#f5f5f0" }}>{fatPct}% · {fatRank}</span>
                </div>
                <div style={{ height: 16, background: "#252525", borderRadius: 8, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: "15%", width: "35%", height: "100%", background: "rgba(90,158,111,0.1)", borderRadius: 8 }} />
                  <div style={{ position: "absolute", left: fatPos + "%", top: 0, width: 3, height: "100%", background: "#d4af37", borderRadius: 2, transition: "left 0.3s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#4a4a4a", marginTop: 2 }}><span>30%</span><span style={{ color: "#5a9e6f" }}>적정 15~22%</span><span>10%</span></div>
                <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>평균 {refData.avgFat}%</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "#5a9e6f" }}>일평균 단백질</span>
                  <span style={{ fontSize: 11, color: "#f5f5f0" }}>{weekP}g · {pRank}</span>
                </div>
                <div style={{ height: 16, background: "#252525", borderRadius: 8, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: "30%", width: "30%", height: "100%", background: "rgba(90,158,111,0.1)", borderRadius: 8 }} />
                  <div style={{ position: "absolute", left: pPos + "%", top: 0, width: 3, height: "100%", background: "#d4af37", borderRadius: 2, transition: "left 0.3s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#4a4a4a", marginTop: 2 }}><span>60g</span><span style={{ color: "#5a9e6f" }}>권장 120~180g</span><span>220g</span></div>
                <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>평균 {refData.avgP}g</div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: "#4a8fc9", marginBottom: 6 }}>인기 운동 TOP 5 ({refData.label})</div>
                {refData.topExercises.map((ex, i) => {
                  const pcts = [78, 72, 65, 58, 45];
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: i < 3 ? "#d4af37" : "#555", width: 14 }}>{i + 1}.</span>
                      <span style={{ flex: 1, fontSize: 11, color: "#c0c0b0" }}>{ex}</span>
                      <div style={{ width: 60, height: 4, background: "#252525", borderRadius: 2, overflow: "hidden" }}><div style={{ width: pcts[i] + "%", height: "100%", background: "#4a8fc9", borderRadius: 2 }} /></div>
                      <span style={{ fontSize: 9, color: "#707070", width: 24, textAlign: "right" }}>{pcts[i]}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {!latest && (
          <div style={{ textAlign: "center", padding: 32, color: "#4a4a4a", fontSize: 13, lineHeight: 1.6 }}>체성분 기록이 있으면<br/>나의 위치를 확인할 수 있습니다.</div>
        )}

        <div style={{ textAlign: "center", fontSize: 9, color: "#4a4a4a", marginTop: 4, lineHeight: 1.5 }}>벤치마크는 표준 참고 데이터 기준입니다.<br/>챌린지 리더보드는 데모 데이터입니다.</div>
      </>)}
    </>
  );

  // 가로: 2컬럼(왼쪽 배너 / 오른쪽 서브탭 전체) · 세로: 기존 순서 그대로
  // ⚠️ 트리 구조는 두 방향에서 동일 — 회전 시 자식 리마운트(상태 초기화)를 막기 위해
  //    방향별 트리 스왑 대신 컨테이너 스타일만 분기한다 (BodyTab과 동일 원칙).
  return (
    <div style={landscape ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" } : undefined}>
      <div>{summaryBanner}</div>
      <div>{subTabsSection}</div>
    </div>
  );
}
