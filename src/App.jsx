import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar, ComposedChart, Legend, ReferenceLine } from "recharts";
import store, { getCurrentUserId, setUserId, logout, getMembership, joinWithInvite, getSharedFoods, addSharedFood, getSharedExercises, addSharedExercise } from "./store.js";
import { watchAuth, signInWithGoogle, signOutUser, isOwnerEmail } from "./auth.js";
import { APP_NAME, DEFAULT_FOODS, DEFAULT_EX, TARGETS as DEFAULT_TARGETS, COLORS } from "./data.js";
import { THEME, GlobalStyles } from "./theme.jsx";
import { today, nowHour, isCompletedDay, calcTargets, sortByHour, periodOf, groupMealsByTime, groupExercisesByTime, aggregateDay, exFeedback, isCalOk, adjustForDate } from "./utils.js";
import { estimateTDEE } from "./adaptiveTDEE.js";
import { pendingReminders } from "./reminders.js";
import { pushConfigured, enablePush, disablePush, syncPushState } from "./push.js";
import { isExcludedDate, activeEvents, eventsForDate, typeMeta } from "./healthEvents.js";
import { buildBackup, validateBackup, summarizeBackup } from "./backup.js";
import { useLongPress } from "./hooks/useLongPress.js";
import { LongPressActionBar } from "./components/LongPressActionBar.jsx";
import { Modal } from "./components/Modal.jsx";
import { ProgressBar } from "./components/ProgressBar.jsx";
import { MiniDonut } from "./components/MiniDonut.jsx";
import { NetCalCard } from "./components/NetCalCard.jsx";
import { NextMealTip } from "./components/NextMealTip.jsx";
import { MacroRatioBar } from "./components/MacroRatioBar.jsx";
import { IntakeRhythm } from "./components/IntakeRhythm.jsx";
import { WorkoutStamp } from "./components/WorkoutStamp.jsx";
import { ExerciseRhythm } from "./components/ExerciseRhythm.jsx";
import { CalorieBandChart } from "./components/CalorieBandChart.jsx";
import { WeekdayRadar } from "./components/WeekdayRadar.jsx";
import { DateCopySheet, recentCopyDays, copyDupCount } from "./components/DateCopySheet.jsx";
import { AdaptiveTdeeCard } from "./components/AdaptiveTdeeCard.jsx";
import { ReminderSettings } from "./components/ReminderSettings.jsx";
import { HealthEvents } from "./components/HealthEvents.jsx";
import { AddFoodForm } from "./components/AddFoodForm.jsx";
import { AddExForm } from "./components/AddExForm.jsx";
import { EditMealForm } from "./components/EditMealForm.jsx";
import { EditExForm } from "./components/EditExForm.jsx";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { InviteGate } from "./components/InviteGate.jsx";
import { ProfileSetup } from "./components/ProfileSetup.jsx";
import { BodyTab } from "./components/BodyTab.jsx";
import { StatsTab } from "./components/StatsTab.jsx";



/* ═══════════════════════════════════════════════ */
/*                    MAIN APP                     */
/* ═══════════════════════════════════════════════ */
// 앱 래퍼 (로그인 관리) — 경로 B: Firebase Auth 상태 기계.
// 로그인(Google) → 멤버십(초대 코드, 규칙이 검증) → 프로필(온보딩) → MainApp 순으로 진행.
// 오프라인 재시작: Auth 세션은 indexedDB, 멤버십은 dt_{uid}_member, 프로필은 store.get의
// localStorage 폴백으로 각각 복원돼 네트워크 없이도 ready까지 도달한다.
export default function App() {
  const [phase, setPhase] = useState("checking"); // checking | signedout | invite | onboarding | ready
  const [account, setAccount] = useState(null);   // Firebase user (uid·email·displayName)
  const [profile, setProfile] = useState(null);   // users/{uid}/data/profile

  // 멤버 확정 후 공통 진입: 프로필 있으면 ready, 없으면 온보딩
  const enterApp = async () => {
    const prof = await store.get("profile");
    if (prof && prof.name) { setProfile(prof); setPhase("ready"); }
    else setPhase("onboarding");
  };

  useEffect(() => {
    return watchAuth(async (u) => {
      if (!u) { logout(); setAccount(null); setProfile(null); setPhase("signedout"); return; }
      setUserId(u.uid);
      setAccount(u);
      let member = await getMembership();
      if (!member && isOwnerEmail(u.email)) {
        // 운영자는 초대 코드 없이 통과 (규칙의 isOwner 분기)
        const r = await joinWithInvite(null, u.email);
        if (r.ok) member = { owner: true };
      }
      if (!member) { setPhase("invite"); return; }
      await enterApp();
    });
  }, []);

  const handleInvite = async (code) => {
    const r = await joinWithInvite(code, account?.email);
    if (r.ok) await enterApp();
    return r;
  };

  const handleProfileSave = async (p) => {
    await store.set("profile", p);
    setProfile(p);
    setPhase("ready");
  };

  // watchAuth가 null을 받아 signedout으로 전환한다 (localStorage 데이터는 유지 — 기존 정책)
  const handleLogout = () => { signOutUser().catch(e => console.error("signOut error:", e)); };

  if (phase === "checking") return <><GlobalStyles /><div style={{ background: THEME.bg, color: THEME.sub, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>로딩 중...</div></>;
  if (phase === "signedout") return <><GlobalStyles /><LoginScreen onGoogle={signInWithGoogle} /></>;
  if (phase === "invite") return <><GlobalStyles /><InviteGate email={account?.email} onSubmit={handleInvite} onSignOut={handleLogout} /></>;
  if (phase === "onboarding") return <><GlobalStyles />
    <div style={{ background: THEME.bg, minHeight: "100vh", maxWidth: 480, margin: "0 auto", padding: "60px 24px" }}>
      <ProfileSetup defaultName={account?.displayName || ""} colorSeed={account?.uid || ""} onSave={handleProfileSave} />
    </div></>;

  const user = { ...profile, uid: account?.uid, email: account?.email, isOwner: isOwnerEmail(account?.email) };
  return <><GlobalStyles /><MainApp user={user} onLogout={handleLogout} /></>;
}

// 메인 앱
function MainApp({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [date, setDate] = useState(today());
  const [meals, setMeals] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [bodyLog, setBodyLog] = useState([]);
  const [allDays, setAllDays] = useState({});
  const [customFoods, setCustomFoods] = useState([]);
  const [customEx, setCustomEx] = useState([]);
  const [search, setSearch] = useState("");
  const [exSearch, setExSearch] = useState("");
  const [qty, setQty] = useState({});
  const [exMin, setExMin] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [mealHour, setMealHour] = useState(nowHour());
  const [exHour, setExHour] = useState(nowHour());
  const [showAddFood, setShowAddFood] = useState(false);
  const [showAddEx, setShowAddEx] = useState(false);
  const [editMealIdx, setEditMealIdx] = useState(null);
  const [editExIdx, setEditExIdx] = useState(null);
  const lpMeal = useLongPress(400);
  const lpEx = useLongPress(400);
  const [showManage, setShowManage] = useState(false);
  const [manageTab, setManageTab] = useState("freq");
  const [lastBackup, setLastBackup] = useState(null);
  const [justBacked, setJustBacked] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
  const [yesterdayData, setYesterdayData] = useState({ meals: [], exercises: [] });
  const [dateCopyType, setDateCopyType] = useState(null); // null | "diet" | "exercise"
  const [dateCopySrc, setDateCopySrc] = useState(null);   // 복사 소스 날짜
  const [copyUndo, setCopyUndo] = useState(null);         // { kind, prev, text } — 되돌리기 스낵바
  // 레거시(프로필 선택 시절) 데이터 가져오기 — 운영자 전용 (경로 B 전환 후 1회성)
  const [showMigrate, setShowMigrate] = useState(false);
  const [migrateId, setMigrateId] = useState("daniel");
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState(null);     // { ok, text }
  const [goals, setGoals] = useState({ weight: 72, fatPct: 15, muscle: 36 });
  const [sharedFoods, setSharedFoods] = useState([]);
  const [sharedExercises, setSharedExercises] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  // 사진 분석 상태
  const [photoMode, setPhotoMode] = useState(false); // 사진 분석 화면 표시
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoResults, setPhotoResults] = useState(null); // [{n, u, g, p, c, f, k, checked, adjG}]
  const [photoError, setPhotoError] = useState("");
  const [photoPreview, setPhotoPreview] = useState(null); // base64 미리보기
  const [aiExLoading, setAiExLoading] = useState(false);
  const [aiExResults, setAiExResults] = useState(null);
  const [aiExError, setAiExError] = useState("");

  const FOOD_DB = useMemo(() => [...DEFAULT_FOODS, ...customFoods], [customFoods]);
  const SHARED_DB = useMemo(() => sharedFoods.filter(f => !FOOD_DB.some(d => d.n === f.n)), [sharedFoods, FOOD_DB]);
  const EX_DB = useMemo(() => [...DEFAULT_EX, ...customEx], [customEx]);
  const SHARED_EX_DB = useMemo(() => sharedExercises.filter(e => !EX_DB.some(d => d.n === e.n)), [sharedExercises, EX_DB]);

  // 어제 날짜 계산
  const getYesterday = useCallback((d) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() - 1);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }, []);

  // 탭 변경 시 Long Press 선택 해제
  useEffect(() => { lpMeal.clear(); lpEx.clear(); setShowHeaderMenu(false); setShowCalendar(false); }, [tab]);

  // ── 초기 로드: localStorage-first + Firestore 백그라운드 동기화 ──
  useEffect(() => {
    // Phase 1: localStorage에서 즉시 표시 (동기 — 네트워크 대기 없음)
    const local = store.getLocalAll();
    if (local["custom-foods"]) setCustomFoods(local["custom-foods"]);
    if (local["custom-exercises"]) setCustomEx(local["custom-exercises"]);
    if (local["bodylog"]) setBodyLog([...local["bodylog"]].sort((a, b) => a.date.localeCompare(b.date)));
    if (local["lastBackup"]) setLastBackup(local["lastBackup"]);
    if (local["goals"]) setGoals(local["goals"]);
    const localDays = {};
    for (const k in local) { if (k.startsWith("day:")) localDays[k.slice(4)] = local[k]; }
    if (Object.keys(localDays).length > 0) setAllDays(localDays);
    try { const lsf = localStorage.getItem("dt_shared_foods"); if (lsf) setSharedFoods(JSON.parse(lsf)); } catch {}
    try { const lse = localStorage.getItem("dt_shared_exercises"); if (lse) setSharedExercises(JSON.parse(lse)); } catch {}
    // 계정 생성일 기록 (최초 1회)
    const uid = getCurrentUserId();
    if (uid && !localStorage.getItem("dt_" + uid + "_createdAt")) {
      localStorage.setItem("dt_" + uid + "_createdAt", today());
    }
    setLoaded(true);

    // Phase 2: 오프라인 대기분을 먼저 밀어올린 뒤(순서 필수 — getAllData가 Firestore 옛값으로
    // localStorage/state를 덮기 전에 최신 로컬 값을 서버에 반영), 전체 동기화 (ONE getDocs)
    Promise.resolve()
      .then(() => store.flushPendingSync?.())
      .catch(() => {}) // flush 실패는 동기화를 막지 않음 — 큐에 남아 다음 기회에 재시도
      .then(() => Promise.all([store.getAllData(), getSharedFoods(), getSharedExercises()]))
      .then(([remote, sf, se]) => {
        if (sf) setSharedFoods(sf);
        if (se) setSharedExercises(se);
        if (!remote || Object.keys(remote).length === 0) return;
        if (remote["custom-foods"]) setCustomFoods(remote["custom-foods"]);
        if (remote["custom-exercises"]) setCustomEx(remote["custom-exercises"]);
        if (remote["bodylog"]) setBodyLog([...remote["bodylog"]].sort((a, b) => a.date.localeCompare(b.date)));
        if (remote["lastBackup"]) setLastBackup(remote["lastBackup"]);
        if (remote["goals"]) setGoals(remote["goals"]);
        const remoteDays = {};
        for (const k in remote) { if (k.startsWith("day:")) remoteDays[k.slice(4)] = remote[k]; }
        if (Object.keys(remoteDays).length > 0) setAllDays(remoteDays);
      }).catch(e => console.error("Sync error:", e));
  }, []);

  // 온라인 복귀 시 오프라인 대기분 재전송 (세션 중에는 localStorage가 항상 최신이라 순서 무관)
  useEffect(() => {
    const onOnline = () => { Promise.resolve().then(() => store.flushPendingSync?.()).catch(() => {}); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // 날짜 변경 시 allDays에서 해당 날 데이터 추출 (Firestore 호출 없음)
  useEffect(() => {
    if (!loaded) return;
    const d = allDays[date];
    setMeals(sortByHour(d?.meals || []));
    setExercises(sortByHour(d?.exercises || []));
    const yd = getYesterday(date);
    const y = allDays[yd];
    setYesterdayData({ meals: y?.meals || [], exercises: y?.exercises || [] });
  }, [date, loaded, allDays, getYesterday]);

  const saveDay = async (d, m, e) => {
    // 그 날의 목표 모드를 기록에 스탬프해 둔다(달력/통계가 그 날 기준으로 판정).
    // 오늘은 현재 모드로, 과거 날 보정은 기존 스탬프를 보존(없으면 cut 폴백).
    const dayMode = d === today() ? mode : allDays[d]?.mode;
    const rec = { meals: m, exercises: e, ...(dayMode ? { mode: dayMode } : {}) };
    setAllDays(prev => ({ ...prev, [d]: rec }));
    await store.set(`day:${d}`, rec);
  };

  const addMeal = (food, q) => {
    const serving = parseFloat(q) || 1;
    const hour = parseInt(mealHour) || nowHour();
    const entry = { ...food, serving, ts: Date.now(), hour };
    const nm = sortByHour([...meals, entry]);
    setMeals(nm); saveDay(date, nm, exercises);
    setSearch(""); setQty({});
  };
  const removeMeal = (idx) => { const nm = meals.filter((_, i) => i !== idx); setMeals(nm); saveDay(date, nm, exercises); };
  const editMeal = (idx, updated) => {
    const nm = sortByHour(meals.map((m, i) => i === idx ? { ...m, ...updated } : m));
    setMeals(nm); saveDay(date, nm, exercises); setEditMealIdx(null);
  };

  const addExercise = (ex, min) => {
    const duration = parseInt(min) || 30;
    const kcal = Math.round((ex.m * TARGETS.weight * duration) / 60);
    const hour = parseInt(exHour) || nowHour();
    const entry = { ...ex, duration, kcal, ts: Date.now(), hour };
    const ne = sortByHour([...exercises, entry]);
    setExercises(ne); saveDay(date, meals, ne);
    setExSearch(""); setExMin({});
  };
  const removeExercise = (idx) => { const ne = exercises.filter((_, i) => i !== idx); setExercises(ne); saveDay(date, meals, ne); };
  const editExercise = (idx, updated) => {
    const ne = sortByHour(exercises.map((e, i) => i === idx ? { ...e, ...updated, kcal: Math.round((e.m * TARGETS.weight * (updated.duration || e.duration)) / 60) } : e));
    setExercises(ne); saveDay(date, meals, ne); setEditExIdx(null);
  };

  const addBody = async (w, muscle, fatPct, score) => {
    const entry = { date, weight: parseFloat(w), muscle: parseFloat(muscle) || 0, fatPct: parseFloat(fatPct) || 0, score: parseInt(score) || 0 };
    const nl = [...bodyLog.filter(b => b.date !== date), entry].sort((a, b) => a.date.localeCompare(b.date));
    setBodyLog(nl); await store.set("bodylog", nl);
  };

  const editBody = async (idx, updated) => {
    const nl = bodyLog.map((b, i) => i === idx ? { ...b, ...updated } : b).sort((a, b) => a.date.localeCompare(b.date));
    setBodyLog(nl); await store.set("bodylog", nl);
  };

  const deleteBody = async (idx) => {
    const nl = bodyLog.filter((_, i) => i !== idx);
    setBodyLog(nl); await store.set("bodylog", nl);
  };

  const saveCustomFood = async (food) => {
    const nf = [...customFoods, { ...food, custom: true }];
    setCustomFoods(nf); await store.set("custom-foods", nf); setShowAddFood(false);
    // 공용 DB 쓰기는 운영자만 (경로 B: 읽기 전용 공유 — 규칙도 차단하지만 헛요청·콘솔 오류 방지)
    if (user.isOwner) {
      const updated = await addSharedFood({ ...food, source: "manual", addedBy: user.name });
      if (updated) setSharedFoods(updated);
    }
  };
  const deleteCustomFood = async (idx) => {
    const nf = customFoods.filter((_, i) => i !== idx);
    setCustomFoods(nf); await store.set("custom-foods", nf);
  };
  const saveCustomEx = async (ex) => {
    const ne = [...customEx, { ...ex, custom: true }];
    setCustomEx(ne); await store.set("custom-exercises", ne); setShowAddEx(false);
  };
  const deleteCustomEx = async (idx) => {
    const ne = customEx.filter((_, i) => i !== idx);
    setCustomEx(ne); await store.set("custom-exercises", ne);
  };

  const saveGoals = async (newGoals) => {
    setGoals(newGoals);
    await store.set("goals", newGoals);
  };

  // 레거시 uid → 현재 Auth uid 데이터 복사. 완료 후 새로고침으로 전체 재동기화.
  const runMigrate = async () => {
    const oldUid = migrateId.trim();
    if (!oldUid || migrateBusy) return;
    setMigrateBusy(true); setMigrateMsg(null);
    try {
      const r = await store.migrateFrom(oldUid);
      if (!r.copied && !r.photos && !r.local) {
        setMigrateMsg({ ok: false, text: `"${oldUid}"에서 가져올 데이터가 없어요. ID를 확인해주세요.` });
      } else {
        setMigrateMsg({ ok: true, text: `완료 — 문서 ${r.copied}개${r.photos ? `, 사진 ${r.photos}장` : ""}${r.local ? `, 미동기화 ${r.local}건 승계` : ""}. 새로고침합니다...` });
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (e) {
      setMigrateMsg({ ok: false, text: e?.code === "permission-denied" ? "권한이 없어요 — firestore.rules의 운영자 이메일을 확인하세요." : `가져오기 실패: ${e?.message || "오류"}` });
    }
    setMigrateBusy(false);
  };

  // 어제 기록 복사 (개별) — 식단/운동만 추가, 시간은 현재 선택 시간 사용
  const copyMealFromYesterday = (meal) => {
    const entry = { ...meal, ts: Date.now(), hour: parseInt(mealHour) || nowHour() };
    const nm = sortByHour([...meals, entry]);
    setMeals(nm); saveDay(date, nm, exercises);
  };

  const copyExFromYesterday = (ex) => {
    const entry = { ...ex, ts: Date.now(), hour: parseInt(exHour) || nowHour() };
    const ne = sortByHour([...exercises, entry]);
    setExercises(ne); saveDay(date, meals, ne);
  };

  // 어제 전체 복사 — 각 항목의 어제 원래 시간 유지
  const copyAllMealsFromYesterday = () => {
    const fallback = parseInt(mealHour) || nowHour();
    const newMeals = yesterdayData.meals.map(m => ({ ...m, ts: Date.now(), hour: m.hour ?? fallback }));
    const nm = sortByHour([...meals, ...newMeals]);
    setMeals(nm); saveDay(date, nm, exercises);
  };

  const copyAllExFromYesterday = () => {
    const fallback = parseInt(exHour) || nowHour();
    const newEx = yesterdayData.exercises.map(e => ({ ...e, ts: Date.now(), hour: e.hour ?? fallback }));
    const ne = sortByHour([...exercises, ...newEx]);
    setExercises(ne); saveDay(date, meals, ne);
  };

  // ── 날짜별 복사 (컨셉 3 끼니 시트 + 컨셉 4 되돌리기 스낵바) ──
  // 시간 규칙은 기존 계승: 개별=현재 선택 시간(preserveTime=false) / 묶음·전체=원본 시간(true)
  const copyToastText = (items, dup) => items.length === 1
    ? `${items[0].n} 추가됨${dup > 0 ? " · 중복" : ""}`
    : `${items.length}건 복사${dup > 0 ? ` (${dup}건 중복)` : ""}`;
  const openDateCopy = (type) => {
    const days = recentCopyDays(allDays, type, today());
    setDateCopySrc(days[0] ? days[0].ds : getYesterday(date));
    setDateCopyType(type);
  };
  const addMealsBatch = (items, preserveTime) => {
    const fallback = parseInt(mealHour) || nowHour();
    const add = items.map(({ _idx, ...m }) => ({ ...m, ts: Date.now(), hour: preserveTime ? (m.hour ?? fallback) : fallback }));
    const dup = copyDupCount(meals, items, "diet");
    const prev = meals;
    const nm = sortByHour([...meals, ...add]);
    setMeals(nm); saveDay(date, nm, exercises);
    setCopyUndo({ kind: "diet", prev, text: copyToastText(items, dup) });
  };
  const addExBatch = (items, preserveTime) => {
    const fallback = parseInt(exHour) || nowHour();
    const add = items.map(({ _idx, ...e }) => ({ ...e, ts: Date.now(), hour: preserveTime ? (e.hour ?? fallback) : fallback }));
    const dup = copyDupCount(exercises, items, "exercise");
    const prev = exercises;
    const ne = sortByHour([...exercises, ...add]);
    setExercises(ne); saveDay(date, meals, ne);
    setCopyUndo({ kind: "exercise", prev, text: copyToastText(items, dup) });
  };
  const copyDateItem = (it) => (dateCopyType === "diet" ? addMealsBatch([it], false) : addExBatch([it], false));
  const copyDateGroup = (its) => (dateCopyType === "diet" ? addMealsBatch(its, true) : addExBatch(its, true));
  const undoCopy = () => {
    if (!copyUndo) return;
    if (copyUndo.kind === "diet") { setMeals(copyUndo.prev); saveDay(date, copyUndo.prev, exercises); }
    else { setExercises(copyUndo.prev); saveDay(date, meals, copyUndo.prev); }
    setCopyUndo(null);
  };
  // 되돌리기 스낵바 6초 후 자동 사라짐
  useEffect(() => {
    if (!copyUndo) return;
    const t = setTimeout(() => setCopyUndo(null), 6000);
    return () => clearTimeout(t);
  }, [copyUndo]);
  // 날짜복사 진입버튼 노출 여부 — allDays 불변 시 매 렌더 전체 순회 방지
  const hasDietCopySrc = useMemo(() => recentCopyDays(allDays, "diet", today()).length > 0, [allDays]);
  const hasExCopySrc = useMemo(() => recentCopyDays(allDays, "exercise", today()).length > 0, [allDays]);

  // 백업 (CSV 내보내기 + 날짜 기록)
  const doBackup = async () => {
    // CSV 생성
    const rows = [];
    rows.push(["=== 일별 요약 ==="]); rows.push(["날짜","P(g)","C(g)","F(g)","K(kcal)","운동(kcal)","Net(kcal)"]);
    Object.entries(allDays).sort().forEach(([d, data]) => { const a = aggregateDay(data); rows.push([d, Math.round(a.p), Math.round(a.c), Math.round(a.f), Math.round(a.k), Math.round(a.ex), Math.round(a.net)]); });
    rows.push([]); rows.push(["=== 식단 상세 ==="]); rows.push(["날짜","시간","음식","수량","P(g)","C(g)","F(g)","K(kcal)"]);
    Object.entries(allDays).sort().forEach(([d, data]) => (data.meals || []).forEach(m => rows.push([d, `${String(m.hour||0).padStart(2,"0")}:00`, m.n, m.serving, (m.p*m.serving).toFixed(1), (m.c*m.serving).toFixed(1), (m.f*m.serving).toFixed(1), Math.round(m.k*m.serving)])));
    rows.push([]); rows.push(["=== 운동 상세 ==="]); rows.push(["날짜","시간","운동","시간(분)","소모(kcal)","MET"]);
    Object.entries(allDays).sort().forEach(([d, data]) => (data.exercises || []).forEach(e => rows.push([d, `${String(e.hour||0).padStart(2,"0")}:00`, e.n, e.duration, e.kcal, e.m])));
    rows.push([]); rows.push(["=== 체성분 ==="]); rows.push(["날짜","체중(kg)","골격근량(kg)","체지방률(%)"]);
    bodyLog.forEach(b => rows.push([b.date, b.weight, b.muscle, b.fatPct]));
    const csv = "\uFEFF" + rows.map(r => r.map(v => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g,'""')}"` : s; }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `daniel_tracker_${today()}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);

    // 백업 날짜 기록
    const now = today();
    setLastBackup(now);
    setJustBacked(true);
    await store.set("lastBackup", now);
    setTimeout(() => setJustBacked(false), 5000);
  };

  // 파일 다운로드 공통
  const downloadFile = (content, name, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // JSON 전체 백업 — 복원 가능한 유일한 형태 (CSV는 열람용)
  const exportJson = async () => {
    const backup = buildBackup({ allDays, bodyLog, goals, customFoods, customExercises: customEx }, new Date().toISOString());
    downloadFile(JSON.stringify(backup, null, 2), `daniel_backup_${today()}.json`, "application/json");
    const now = today();
    setLastBackup(now); setJustBacked(true);
    await store.set("lastBackup", now);
    setTimeout(() => setJustBacked(false), 5000);
  };

  // JSON 복원 — 검증 → 확인 → 현재 데이터 안전본 자동 저장 → 전체 교체(상태+store)
  const importJsonFile = async (file) => {
    // 오프라인 가드 — Firestore setDoc은 오프라인에서 무한 대기라(store.js 주석) 복원
    // 루프가 중간에 멈춰 localStorage가 부분 갱신될 수 있다. 복원은 온라인 전용.
    if (typeof navigator !== "undefined" && navigator.onLine === false) { alert("복원은 온라인 상태에서만 가능해요."); return; }
    let obj;
    try { obj = JSON.parse(await file.text()); }
    catch { alert("복원 실패: JSON 파일을 읽을 수 없어요"); return; }
    const v = validateBackup(obj);
    if (!v.ok) { alert(`복원할 수 없어요: ${v.error}`); return; }
    const s = summarizeBackup(obj);
    const ok = confirm(
      `이 백업으로 전체 복원할까요?\n\n` +
      `백업 내용: ${s.days}일 (${s.firstDay || "-"} ~ ${s.lastDay || "-"}) · 체성분 ${s.bodyLog}건\n` +
      `백업 생성일: ${s.exportedAt ? s.exportedAt.slice(0, 10) : "알 수 없음"}\n\n` +
      `현재 기록(${Object.keys(allDays).length}일 · 체성분 ${bodyLog.length}건)을 위 내용으로 덮어씁니다.\n` +
      `복원 직전, 현재 데이터가 안전본(JSON)으로 자동 다운로드됩니다.`
    );
    if (!ok) return;
    // 1) 현재 상태 안전본 — 실수로 옛 백업을 넣어도 되돌릴 길을 남긴다
    const safety = buildBackup({ allDays, bodyLog, goals, customFoods, customExercises: customEx }, new Date().toISOString());
    downloadFile(JSON.stringify(safety), `daniel_safety_${today()}.json`, "application/json");
    // 2) 적용 — 상태 즉시 교체 후 store 반영(로컬 우선이라 즉시 안전)
    const d = obj.data;
    const newDays = d.days || {};
    const sortedLog = [...d.bodylog].sort((a, b) => a.date.localeCompare(b.date));
    const staleDays = Object.keys(allDays).filter((k) => !newDays[k]);
    setAllDays(newDays);
    setBodyLog(sortedLog);
    setGoals(d.goals || {});
    setCustomFoods(d.customFoods || []);
    setCustomEx(d.customExercises || []);
    try {
      for (const [k, rec] of Object.entries(newDays)) await store.set(`day:${k}`, rec);
      for (const k of staleDays) await store.delete(`day:${k}`);
      await store.set("bodylog", sortedLog);
      await store.set("goals", d.goals || {});
      await store.set("custom-foods", d.customFoods || []);
      await store.set("custom-exercises", d.customExercises || []);
      alert(`복원 완료 — ${s.days}일 · 체성분 ${s.bodyLog}건`);
    } catch (e) {
      console.error("restore error:", e);
      alert("일부 저장에 실패했어요. 온라인 상태에서 앱을 다시 열면 자동 재시도됩니다.");
    }
  };

  // 백업 경과 일수 계산
  const backupDaysAgo = useMemo(() => {
    if (!lastBackup) return 999;
    const diff = (new Date(today()) - new Date(lastBackup)) / 86400000;
    return Math.floor(diff);
  }, [lastBackup]);

  // 계정 생성 후 15일 이상인지 확인
  const accountMature = useMemo(() => {
    try {
      const uid = getCurrentUserId();
      const created = localStorage.getItem("dt_" + uid + "_createdAt");
      if (!created) return false;
      return (new Date(today()) - new Date(created)) / 86400000 >= 15;
    } catch { return false; }
  }, []);

  // 인앱 리마인더 — 앱을 열 때 상태에 맞춰 홈 배너로 알림. goals.reminders 토글로 켬/끔.
  const saveReminders = (next) => saveGoals({ ...goals, reminders: next });
  const pendingRmd = useMemo(() => {
    const td = allDays[today()];
    const recordedToday = !!(td && (((td.meals || []).length) || ((td.exercises || []).length)));
    const lastWeighDate = bodyLog.length ? bodyLog[bodyLog.length - 1].date : null;
    return pendingReminders({ reminders: goals.reminders, recordedToday, lastWeighDate, todayStr: today(), accountMature, backupDaysAgo });
  }, [allDays, bodyLog, goals.reminders, accountMature, backupDaysAgo]);
  const rmdOn = (k) => goals.reminders?.[k] !== false;

  // 건강 이벤트(부상·질병·휴식) — goals.healthEvents. 계산 제외 판정은 적응형 TDEE에 주입.
  const healthEvents = useMemo(() => goals.healthEvents || [], [goals.healthEvents]);
  const saveHealthEvents = (events) => saveGoals({ ...goals, healthEvents: events });
  const isExcludedCalc = useCallback((ds) => isExcludedDate(healthEvents, ds), [healthEvents]);
  const activeHealth = useMemo(() => activeEvents(healthEvents, today()), [healthEvents]);

  // 푸시 클릭으로 앱이 포커스될 때 해당 탭으로 이동 (서비스워커 postMessage)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e) => { if (e.data && e.data.type === "nav" && e.data.tab) setTab(e.data.tab); };
    navigator.serviceWorker.addEventListener("message", onMsg);
    try { const t = new URLSearchParams(window.location.search).get("tab"); if (t && ["home", "diet", "exercise", "body", "stats"].includes(t)) setTab(t); } catch { /* 무시 */ }
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  // 현재 목표 모드 (cut=감량 / maintain=유지). 기존 사용자·손상값은 cut로 폴백(화이트리스트).
  // 화이트리스트라 targetsByMode[mode]가 항상 유효 — 홈 TARGETS 무가드 접근도 안전.
  const mode = goals.mode === "maintain" ? "maintain" : "cut";

  // 적응형 유지칼로리 — 이력 기반 보정치. 마스터 토글 OFF면 0(공식). 오늘의 목표에 쓰이는 현재 보정치.
  const adaptiveOn = !!goals.adaptiveOn;
  const tdeeHistory = useMemo(() => (adaptiveOn ? (goals.tdeeHistory || []) : []), [adaptiveOn, goals.tdeeHistory]);
  const appAdjust = adjustForDate(tdeeHistory, today());

  // 월 평균 체중 + BMR (목표·적응형 역산 공용)
  const monthWeight = useMemo(() => {
    const currentMonth = date.slice(0, 7);
    const monthEntries = bodyLog.filter(b => b.date.startsWith(currentMonth));
    if (monthEntries.length > 0) return monthEntries.reduce((s, b) => s + b.weight, 0) / monthEntries.length;
    if (bodyLog.length > 0) return bodyLog[bodyLog.length - 1].weight;
    return DEFAULT_TARGETS.weight;
  }, [bodyLog, date]);
  const bmr = 10 * monthWeight + 6.25 * (user.height || 175) - 5 * (user.age || 35) + 5;

  // 같은 체중으로 두 모드 목표를 모두 산출(홈은 현재 모드, 달력/통계는 그 날의 모드). 보정치 반영.
  const targetsByMode = useMemo(() => {
    const h = user.height || 175, a = user.age || 35;
    return {
      cut: calcTargets(monthWeight, h, a, "cut", appAdjust),
      maintain: calcTargets(monthWeight, h, a, "maintain", appAdjust),
    };
  }, [monthWeight, user, appAdjust]);
  const TARGETS = targetsByMode[mode];

  // 실측 유지칼로리 역산(최근 4주) — 설정 목표 탭 카드/제안에 사용
  const tdeeEstimate = useMemo(() => estimateTDEE(bodyLog, allDays, today(), bmr, 28, isExcludedCalc), [bodyLog, allDays, bmr, today(), isExcludedCalc]);

  // 그 날 유효 보정치로 목표 K를 조정(과거 판정 보존): 현재 목표K − 현재보정 + 그날보정
  const dayTargetK = (m, ds) => (targetsByMode[m] || targetsByMode.cut).k - appAdjust + adjustForDate(tdeeHistory, ds);

  // 보정 제안: 켜짐 + 신뢰도 높음 + 현재 보정과 40kcal↑ 벌어질 때만
  const adaptiveProposal = useMemo(() => {
    if (!adaptiveOn || !tdeeEstimate.valid || !tdeeEstimate.confident) return null;
    if (Math.abs(tdeeEstimate.delta - appAdjust) < 40) return null;
    const h = user.height || 175, a = user.age || 35;
    return { delta: tdeeEstimate.delta, current: targetsByMode[mode], proposed: calcTargets(monthWeight, h, a, mode, tdeeEstimate.delta) };
  }, [adaptiveOn, tdeeEstimate, appAdjust, targetsByMode, mode, monthWeight, user]);

  // 백그라운드 푸시(매일 밤 8시 크론)용 상태 — 크론이 KV에서 읽어 조건 판단.
  // (targetsByMode·dayTargetK 정의 이후에 위치해야 함 — weekReport가 참조)
  const pushReady = useMemo(() => pushConfigured(), []);
  const pushState = useMemo(() => {
    const recordedDates = Object.keys(allDays).filter(d => { const x = allDays[d]; return x && (((x.meals || []).length) || ((x.exercises || []).length)); }).sort();
    let accountCreatedAt = null;
    try { accountCreatedAt = localStorage.getItem("dt_" + getCurrentUserId() + "_createdAt") || null; } catch { /* 무시 */ }
    // 지난 주(월~일) 요약 — 월요일 저녁 성적표 푸시용. 주 시작은 통계 탭과 동일(월요일).
    const lastMon = (() => { const d = new Date(today() + "T12:00:00"); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow) - 7); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();
    let recorded = 0, workouts = 0, calOk = 0, protHit = 0;
    for (let i = 0; i < 7; i++) {
      const dd = new Date(lastMon + "T12:00:00"); dd.setDate(dd.getDate() + i);
      const ds = dd.getFullYear() + "-" + String(dd.getMonth() + 1).padStart(2, "0") + "-" + String(dd.getDate()).padStart(2, "0");
      const day = allDays[ds]; if (!day) continue;
      const a = aggregateDay(day);
      const hasAny = ((day.meals || []).length) || ((day.exercises || []).length);
      if (hasAny) recorded++;
      if ((day.exercises || []).length) workouts++;
      const dM = day.mode || "cut";
      if (a.k > 0 && isCalOk(a.k, a.ex, dayTargetK(dM, ds), dM)) calOk++;
      if (a.p >= (targetsByMode[dM] || targetsByMode.cut).p) protHit++;
    }
    return {
      lastRecordDate: recordedDates.length ? recordedDates[recordedDates.length - 1] : null,
      lastWeighDate: bodyLog.length ? bodyLog[bodyLog.length - 1].date : null,
      lastBackup: lastBackup || null,
      accountCreatedAt: accountCreatedAt ? accountCreatedAt.slice(0, 10) : null,
      weekReport: { weekStart: lastMon, recorded, calOk, protHit, workouts },
    };
  }, [allDays, bodyLog, lastBackup, targetsByMode, appAdjust, tdeeHistory]);
  const doEnablePush = () => enablePush({ state: pushState, reminders: goals.reminders });
  const doDisablePush = () => disablePush();
  // 구독돼 있으면 상태·토글 변화 시 KV 갱신(구독 없으면 no-op).
  useEffect(() => { syncPushState({ state: pushState, reminders: goals.reminders }); }, [pushState, goals.reminders]);

  // 적응형 핸들러 (전부 비파괴적·되돌리기 가능)
  const setAdaptiveOn = (on) => saveGoals({ ...goals, adaptiveOn: on });
  const applyAdaptive = (delta) => {
    const t = today();
    const prev = Array.isArray(goals.tdeeHistory) ? goals.tdeeHistory : [];
    const hist = [...prev.filter(h => h && h.from !== t), { from: t, adjust: delta }]
      .sort((x, y) => (x.from < y.from ? -1 : 1));
    saveGoals({ ...goals, adaptiveOn: true, tdeeHistory: hist });
  };
  const revertAdaptive = () => applyAdaptive(0); // 오늘부터 보정 0 (과거 이력·판정 보존)

  const totals = useMemo(() => {
    let p = 0, c = 0, f = 0, k = 0;
    meals.forEach(m => { const s = m.serving; p += m.p * s; c += m.c * s; f += m.f * s; k += m.k * s; });
    return { p: Math.round(p), c: Math.round(c), f: Math.round(f), k: Math.round(k) };
  }, [meals]);
  const exTotal = useMemo(() => exercises.reduce((s, e) => s + (e.kcal || 0), 0), [exercises]);

  // 운동 되먹기: 감량 50% / 유지 100%를 그날 탄수·섭취 목표로 보충 (큰 운동일 과한 적자/근손실 방지)
  const carbBonus = useMemo(() => Math.round((exTotal * exFeedback(mode)) / 4), [exTotal, mode]);
  const adjustedC = useMemo(() => TARGETS.c + carbBonus, [TARGETS.c, carbBonus]);
  // 그날 섭취 목표 = 기초 목표 + 운동 되먹기(kcal)
  const effectiveTargetK = useMemo(() => TARGETS.k + Math.round(exTotal * exFeedback(mode)), [TARGETS.k, exTotal, mode]);

  const filteredFoods = useMemo(() => {
    if (!search.trim()) return [];
    return FOOD_DB.filter(f => f.n.toLowerCase().includes(search.toLowerCase()));
  }, [search, FOOD_DB]);
  const filteredShared = useMemo(() => {
    if (!search.trim()) return [];
    return SHARED_DB.filter(f => f.n.toLowerCase().includes(search.toLowerCase()));
  }, [search, SHARED_DB]);
  const filteredEx = useMemo(() => {
    if (!exSearch.trim()) return [];
    return EX_DB.filter(e => e.n.toLowerCase().includes(exSearch.toLowerCase()));
  }, [exSearch, EX_DB]);
  const filteredSharedEx = useMemo(() => {
    if (!exSearch.trim()) return [];
    return SHARED_EX_DB.filter(e => e.n.toLowerCase().includes(exSearch.toLowerCase()));
  }, [exSearch, SHARED_EX_DB]);

  // AI 음식 분석
  const analyzeFood = async (query) => {
    setAiLoading(true); setAiError(""); setAiResult(null);
    try {
      const res = await fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      if (data.success && data.food) {
        setAiResult(data.food);
      } else {
        setAiError(data.error || "분석 실패");
      }
    } catch (e) {
      setAiError("네트워크 오류 — 온라인 상태를 확인하세요");
    }
    setAiLoading(false);
  };

  // AI·사진 분석 결과 보존 — 운영자는 공용 DB(전원 공유), 그 외 계정은 개인 DB에 저장해 재사용.
  // (경로 B: 공용 DB는 읽기 전용 공유. 이름 중복은 양쪽 모두 추가하지 않음)
  const keepAnalyzedFood = (food) => {
    if (user.isOwner) {
      addSharedFood({ ...food, addedBy: user.name }).then(updated => { if (updated) setSharedFoods(updated); });
    } else {
      setCustomFoods(prev => {
        if (prev.some(x => x.n.trim().toLowerCase() === food.n.trim().toLowerCase())) return prev;
        const nf = [...prev, { ...food, custom: true }];
        store.set("custom-foods", nf);
        return nf;
      });
    }
  };
  const keepAnalyzedEx = (ex) => {
    if (user.isOwner) {
      addSharedExercise({ ...ex, addedBy: user.name }).then(updated => { if (updated) setSharedExercises(updated); });
    } else {
      setCustomEx(prev => {
        if (prev.some(x => x.n.trim().toLowerCase() === ex.n.trim().toLowerCase())) return prev;
        const ne = [...prev, { ...ex, custom: true }];
        store.set("custom-exercises", ne);
        return ne;
      });
    }
  };

  // AI 결과 → 식단 추가 + DB 보존
  const addMealFromAI = (food, q) => {
    const serving = parseFloat(q) || 1;
    const hour = parseInt(mealHour) || nowHour();
    const entry = { ...food, serving, ts: Date.now(), hour, source: "ai" };
    const nm = sortByHour([...meals, entry]);
    setMeals(nm); saveDay(date, nm, exercises);
    keepAnalyzedFood({ n: food.n, u: food.u || "1인분", p: food.p, c: food.c, f: food.f, k: food.k, source: "ai" });
    setAiResult(null); setSearch("");
  };

  // 이미지 압축 (Canvas API)
  const compressImage = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 800;
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
        else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        const base64 = dataUrl.split(",")[1];
        resolve({ base64, preview: dataUrl });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  // 사진으로 음식 분석
  const analyzePhoto = async (file) => {
    setPhotoMode(true); setPhotoLoading(true); setPhotoError(""); setPhotoResults(null);
    try {
      const { base64, preview } = await compressImage(file);
      setPhotoPreview(preview);
      const res = await fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType: "image/jpeg" })
      });
      const data = await res.json();
      if (data.success && data.foods) {
        setPhotoResults(data.foods.map(f => ({ ...f, checked: true, adjG: f.g || 100 })));
      } else {
        setPhotoError(data.error || "분석에 실패했어요. 다시 시도해주세요.");
      }
    } catch (e) {
      setPhotoError("네트워크 오류: " + e.message);
    }
    setPhotoLoading(false);
  };

  // 사진 결과에서 중량 조절 시 영양소 재계산
  const adjustPhotoWeight = (idx, newG) => {
    setPhotoResults(prev => prev.map((f, i) => {
      if (i !== idx) return f;
      const ratio = newG / (f.g || 100);
      return { ...f, adjG: newG, adjP: Math.round(f.p * ratio), adjC: Math.round(f.c * ratio), adjF: Math.round(f.f * ratio), adjK: Math.round(f.k * ratio) };
    }));
  };

  // 사진 결과 체크 토글
  const togglePhotoCheck = (idx) => {
    setPhotoResults(prev => prev.map((f, i) => i === idx ? { ...f, checked: !f.checked } : f));
  };

  // 선택된 항목 일괄 추가
  const addPhotoMeals = () => {
    const hour = parseInt(mealHour) || nowHour();
    const selected = photoResults.filter(f => f.checked);
    const newMeals = selected.map(f => ({
      n: f.n, u: f.u || "1인분",
      p: f.adjP ?? f.p, c: f.adjC ?? f.c, f: f.adjF ?? f.f, k: f.adjK ?? f.k,
      serving: 1, ts: Date.now(), hour, source: "photo"
    }));
    const nm = sortByHour([...meals, ...newMeals]);
    setMeals(nm); saveDay(date, nm, exercises);
    // DB 보존 (운영자=공용 / 그 외=개인)
    selected.forEach(f => {
      keepAnalyzedFood({ n: f.n, u: f.u || "1인분", p: f.adjP ?? f.p, c: f.adjC ?? f.c, f: f.adjF ?? f.f, k: f.adjK ?? f.k, source: "photo" });
    });
    setPhotoMode(false); setPhotoResults(null); setPhotoPreview(null); setSearch("");
  };

  // AI 운동 분석
  const analyzeExercise = async (query) => {
    setAiExLoading(true); setAiExError(""); setAiExResults(null);
    try {
      const res = await fetch("/api/analyze-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      if (data.success && data.exercises && data.exercises.length > 0) {
        setAiExResults(data.exercises);
      } else {
        setAiExError(data.error || "분석 실패");
      }
    } catch (e) {
      setAiExError("네트워크 오류 — 온라인 상태를 확인하세요");
    }
    setAiExLoading(false);
  };

  // AI 운동 결과 → 운동 추가 + DB 보존
  const addExerciseFromAI = (ex, min) => {
    const duration = parseInt(min) || 30;
    const kcal = Math.round((ex.m * TARGETS.weight * duration) / 60);
    const hour = parseInt(exHour) || nowHour();
    const entry = { ...ex, duration, kcal, ts: Date.now(), hour, source: "ai" };
    const ne = sortByHour([...exercises, entry]);
    setExercises(ne); saveDay(date, meals, ne);
    keepAnalyzedEx({ n: ex.n, m: ex.m, memo: ex.memo || "", source: "ai" });
    setExSearch(""); setExMin({});
  };

  const tabStyle = (t) => ({
    flex: 1, padding: "14px 0", textAlign: "center", fontSize: 13, fontWeight: 500,
    color: tab === t ? "#d4af37" : "#4a4a4a", background: "none", border: "none",
    borderTop: tab === t ? "2px solid #d4af37" : "2px solid transparent", cursor: "pointer",
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif",
    transition: "color 0.15s ease, border-color 0.15s ease"
  });

  // 자주 사용하는 음식/운동 집계
  const freqData = useMemo(() => {
    const fc = {}, ec = {};
    Object.values(allDays).forEach(d => {
      (d.meals || []).forEach(m => { const k = m.n; fc[k] = (fc[k] || { ...m, count: 0 }); fc[k].count++; });
      (d.exercises || []).forEach(e => { const k = e.n; ec[k] = (ec[k] || { ...e, count: 0 }); ec[k].count++; });
    });
    return {
      foods: Object.values(fc).sort((a, b) => b.count - a.count).slice(0, 7),
      exercises: Object.values(ec).sort((a, b) => b.count - a.count).slice(0, 5)
    };
  }, [allDays]);
  const cs = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };

  if (!loaded) return <div style={{ color: "#888", padding: 40, textAlign: "center" }}>Loading...</div>;

  return (
    <div style={{ background: THEME.bg, color: THEME.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.3px" }}>{APP_NAME}</div>
          <div style={{ fontSize: 11, color: THEME.gold, fontFamily: "var(--font-mono, monospace)", opacity: 0.7 }}>체지방 {user.targetFat || 15}% · {mode === "maintain" ? "유지 모드" : "감량 모드"} · {user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => { setShowCalendar(v => { if (!v) setCalMonth(date.slice(0, 7)); return !v; }); }} style={{ background: showCalendar ? "rgba(212,175,55,0.1)" : THEME.card, border: `1px solid ${showCalendar ? "rgba(212,175,55,0.3)" : THEME.borderLight}`, borderRadius: 8, color: showCalendar ? "#d4af37" : THEME.text, padding: "6px 10px", fontSize: 11, fontFamily: "monospace", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            {date.slice(5, 7)}.{date.slice(8, 10)}
            <span style={{ fontSize: 9, color: showCalendar ? "#d4af37" : "#707070" }}>{showCalendar ? "▲" : "▼"}</span>
          </button>
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowHeaderMenu(v => !v)} style={{ width: 28, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#707070", cursor: "pointer", background: showHeaderMenu ? "rgba(255,255,255,0.06)" : "transparent", border: "none" }}>⋮</button>
            {showHeaderMenu && (<>
              <div onClick={() => setShowHeaderMenu(false)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} />
              <div style={{ position: "absolute", right: 0, top: 34, background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "4px 0", zIndex: 100, minWidth: 150, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                <div onClick={() => { setShowManage(true); setShowHeaderMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 12, color: "#f5f5f0", cursor: "pointer" }}><span style={{ color: "#d4af37", fontSize: 13, width: 18, textAlign: "center" }}>⚙</span>설정 / 데이터</div>
                <div style={{ height: 0.5, background: "rgba(255,255,255,0.06)" }} />
                <div onClick={() => { setShowHealth(true); setShowHeaderMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 12, color: "#f5f5f0", cursor: "pointer" }}><span style={{ fontSize: 13, width: 18, textAlign: "center" }}>🩹</span>컨디션 기록</div>
                <div style={{ height: 0.5, background: "rgba(255,255,255,0.06)" }} />
                <div onClick={() => { doBackup(); setShowHeaderMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 12, color: "#f5f5f0", cursor: "pointer" }}><span style={{ color: "#4a8fc9", fontSize: 13, width: 18, textAlign: "center" }}>📥</span>CSV 내보내기</div>
                <div style={{ height: 0.5, background: "rgba(255,255,255,0.06)" }} />
                {user.isOwner && (<>
                  <div onClick={() => { setShowMigrate(true); setShowHeaderMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 12, color: "#f5f5f0", cursor: "pointer" }}><span style={{ color: "#5a9e6f", fontSize: 13, width: 18, textAlign: "center" }}>⇊</span>기존 데이터 가져오기</div>
                  <div style={{ height: 0.5, background: "rgba(255,255,255,0.06)" }} />
                </>)}
                <div onClick={() => { onLogout(); setShowHeaderMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 12, color: "#e05252", cursor: "pointer" }}><span style={{ fontSize: 13, width: 18, textAlign: "center" }}>↗</span>로그아웃</div>
              </div>
            </>)}
          </div>
        </div>
      </div>

      {/* 링 캘린더 */}
      {showCalendar && (() => {
        const [calY, calM] = calMonth.split("-").map(Number);
        const firstDay = new Date(calY, calM - 1, 1).getDay();
        const daysInMonth = new Date(calY, calM, 0).getDate();
        const offset = firstDay;
        const todayStr = today();
        const prevMonth = () => { const d = new Date(calY, calM - 2, 1); setCalMonth(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")); };
        const nextMonth = () => { const d = new Date(calY, calM, 1); setCalMonth(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")); };
        // 오늘로 가기: 선택일을 오늘로 되돌리고 달력을 닫는다. 이미 오늘·당월에 있으면 칩 숨김.
        const goToday = () => { setDate(todayStr); setShowCalendar(false); };
        const showTodayChip = calMonth !== todayStr.slice(0, 7) || date !== todayStr;
        const ring = (cx, cy, r, pct, color, sw = 2.5) => {
          const c = 2 * Math.PI * r;
          const p = Math.min(Math.max(pct, 0), 1);
          return (<><circle cx={cx} cy={cy} r={r} fill="none" stroke={color + "33"} strokeWidth={sw} /><circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round" /></>);
        };
        return (
          <div style={{ background: "#1e1e1e", borderBottom: "1px solid rgba(212,175,55,0.15)", padding: "12px 16px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span onClick={prevMonth} style={{ fontSize: 14, color: "#707070", cursor: "pointer", padding: "4px 8px" }}>◀</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: "#f5f5f0" }}>{calY}년 {calM}월</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {showTodayChip && <button onClick={goToday} style={{ background: "rgba(212,175,55,0.15)", border: "1px solid rgba(212,175,55,0.35)", borderRadius: 12, color: "#d4af37", padding: "3px 9px", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>⊙ 오늘</button>}
                <span onClick={nextMonth} style={{ fontSize: 14, color: "#707070", cursor: "pointer", padding: "4px 8px" }}>▶</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1, marginBottom: 4 }}>
              {["일", "월", "화", "수", "목", "금", "토"].map(d => <div key={d} style={{ textAlign: "center", fontSize: 9, color: d === "토" || d === "일" ? "#707070" : "#4a4a4a", padding: "2px 0" }}>{d}</div>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
              {Array.from({ length: offset }, (_, i) => <div key={"e" + i} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const ds = `${calY}-${String(calM).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const dd = allDays[ds];
                const isToday = ds === todayStr;
                const isSelected = ds === date;
                const a = dd ? aggregateDay(dd) : null;
                // 그 날의 모드로 목표/되먹기를 골라 판정(과거 감량일은 감량 기준 그대로 유지)
                const dMode = dd?.mode || "cut";
                const dT = targetsByMode[dMode] || targetsByMode.cut;
                const pP = a ? Math.min(a.p / dT.p, 1) : 0;
                const pC = a ? Math.min(a.c / dT.c, 1) : 0;
                const pF = a ? Math.min(a.f / dT.f, 1) : 0;
                // 오늘은 미완성이므로 적자/초과 판정 dot을 보이지 않음 (false positive 방지)
                // 영양소 ring은 진행률 의미로 자연스러우므로 그대로 표시
                const calOk = a && !isToday ? isCalOk(a.k, a.ex, dayTargetK(dMode, ds), dMode) : null;
                const hasData = !!a && a.k > 0;
                const dow = (offset + i) % 7;
                const hev = eventsForDate(healthEvents, ds)[0];
                return (
                  <div key={day} onClick={() => { setDate(ds); setShowCalendar(false); }} style={{ textAlign: "center", cursor: "pointer", padding: "1px 0" }}>
                    <div style={{ fontSize: 7, color: isToday ? "#d4af37" : isSelected ? "#f5f5f0" : (dow === 0 || dow === 6) ? "#707070" : "#4a4a4a", fontWeight: isToday ? 500 : 400, marginBottom: 1 }}>{day}</div>
                    <div style={{ position: "relative", display: "inline-block" }}>
                      {isToday && <div style={{ position: "absolute", top: -2, left: -2, right: -2, bottom: -2, border: "1.5px solid rgba(212,175,55,0.4)", borderRadius: "50%" }} />}
                      <svg width="36" height="36" viewBox="0 0 36 36" style={{ opacity: hasData ? 1 : 0.3 }}>
                        {ring(18, 18, 14.5, pF, "#e05252")}
                        {ring(18, 18, 11, pC, "#d4af37")}
                        {ring(18, 18, 7.5, pP, "#4a8fc9")}
                      </svg>
                      {hasData && calOk !== null && <div style={{ position: "absolute", top: 0, right: -1, width: 6, height: 6, borderRadius: "50%", background: calOk ? "#5a9e6f" : "#e05252" }} />}
                      {hev && <div style={{ position: "absolute", bottom: -1, left: -1, fontSize: 9, lineHeight: 1 }}>{typeMeta(hev.type).ico}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 8, paddingTop: 8, borderTop: "0.5px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: 8, color: "#e05252", display: "flex", alignItems: "center", gap: 2 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#e05252", display: "inline-block" }} />지방</span>
              <span style={{ fontSize: 8, color: "#d4af37", display: "flex", alignItems: "center", gap: 2 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#d4af37", display: "inline-block" }} />탄수</span>
              <span style={{ fontSize: 8, color: "#4a8fc9", display: "flex", alignItems: "center", gap: 2 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4a8fc9", display: "inline-block" }} />단백질</span>
              <span style={{ fontSize: 8, color: "#707070" }}>|</span>
              <span style={{ fontSize: 8, color: "#5a9e6f", display: "flex", alignItems: "center", gap: 2 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#5a9e6f", display: "inline-block" }} />{mode === "maintain" ? "유지" : "적자"}</span>
              <span style={{ fontSize: 8, color: "#e05252", display: "flex", alignItems: "center", gap: 2 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#e05252", display: "inline-block" }} />초과</span>
            </div>
          </div>
        );
      })()}

      <div style={{ padding: "16px 20px 80px" }}>
        {/* HOME */}
        {tab === "home" && (<>
          {/* 리마인더 배너 — 앱 열 때 상태 기반 (기록/체중). 백업은 아래 전용 배너로 처리 */}
          {pendingRmd.filter(r => r.key === "record").map(() => (
            <div key="rmd-record" onClick={() => setTab("diet")} style={{ background: "rgba(212,175,55,0.1)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 16, padding: 12, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 13, color: "#d4af37", fontWeight: 500 }}>오늘 기록을 안 했어요</div>
                <div style={{ fontSize: 11, color: "#707070", marginTop: 2 }}>식단·운동을 적어주세요</div>
              </div>
              <div style={{ background: "#d4af37", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#fff", fontWeight: 500 }}>기록</div>
            </div>
          ))}
          {pendingRmd.filter(r => r.key === "weight").map(r => (
            <div key="rmd-weight" onClick={() => setTab("body")} style={{ background: "rgba(74,143,201,0.1)", border: "1px solid rgba(74,143,201,0.25)", borderRadius: 16, padding: 12, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 13, color: "#4a8fc9", fontWeight: 500 }}>체중을 재주세요</div>
                <div style={{ fontSize: 11, color: "#707070", marginTop: 2 }}>{r.days >= 999 ? "측정 기록 없음" : `마지막 측정: ${r.days}일 전`} · 추세·적응형 정확도용</div>
              </div>
              <div style={{ background: "#4a8fc9", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#fff", fontWeight: 500 }}>측정</div>
            </div>
          ))}
          {/* 백업 알림 */}
          {justBacked ? (
            <div style={{ background: "rgba(90,158,111,0.08)", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 16, padding: 12, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, color: "#5a9e6f", fontWeight: 500 }}>백업 완료</div>
                <div style={{ fontSize: 11, color: "#707070", marginTop: 2 }}>마지막 백업: 오늘</div>
              </div>
              <div style={{ fontSize: 18, color: "#5a9e6f" }}>✓</div>
            </div>
          ) : rmdOn("backup") && accountMature && backupDaysAgo >= 15 && (
            <div onClick={exportJson} style={{ background: "rgba(212,175,55,0.1)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 16, padding: 12, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 13, color: "#d4af37", fontWeight: 500 }}>백업을 해주세요</div>
                <div style={{ fontSize: 11, color: "#707070", marginTop: 2 }}>마지막 백업: {lastBackup ? `${backupDaysAgo}일 전` : "없음"}</div>
              </div>
              <div style={{ background: "#d4af37", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#fff", fontWeight: 500 }}>백업</div>
            </div>
          )}
          <div className="dbp-fade dbp-card" style={cs}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: THEME.sub }}>오늘의 요약</span>
                {mode === "maintain"
                  ? <span style={{ fontSize: 10, fontWeight: 600, color: "#5a9e6f", background: "rgba(90,158,111,0.12)", border: "1px solid rgba(90,158,111,0.3)", borderRadius: 20, padding: "2px 9px" }}>유지</span>
                  : <span style={{ fontSize: 10, fontWeight: 600, color: "#d4af37", background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.3)", borderRadius: 20, padding: "2px 9px" }}>감량</span>}
                {activeHealth.length > 0 && (() => {
                  const tm = typeMeta(activeHealth[0].type);
                  const multi = activeHealth.length > 1;
                  const col = multi ? "#8a8a8a" : tm.color;
                  return (
                    <span onClick={(e) => { e.stopPropagation(); setShowHealth(true); }} style={{ fontSize: 10, fontWeight: 600, color: col, background: col + "22", border: `1px solid ${col}66`, borderRadius: 20, padding: "2px 9px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {multi ? `🩹 컨디션 ${activeHealth.length}` : `${tm.ico} ${activeHealth[0].label || tm.name}`}
                    </span>
                  );
                })()}
              </div>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: totals.k < effectiveTargetK * 0.75 ? "#e05252" : totals.k < effectiveTargetK * 0.9 ? "#d4af37" : totals.k <= effectiveTargetK ? "#5a9e6f" : "#d4af37" }}>섭취 {Math.round(totals.k)} kcal</span>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16 }}>
              {[{ l: "단백질", v: totals.p, t: TARGETS.p, c: COLORS.p }, { l: "탄수", v: totals.c, t: adjustedC, c: COLORS.c, bonus: carbBonus }, { l: "지방", v: totals.f, t: TARGETS.f, c: COLORS.f }].map(x => (
                <div key={x.l} style={{ textAlign: "center" }}>
                  <MiniDonut value={x.v} max={x.t} color={x.c} />
                  <div style={{ fontSize: 11, color: "#707070", marginTop: 4 }}>{x.l}</div>
                  <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 500, color: "#f5f5f0" }}>{x.v}g</div>
                  <div style={{ fontSize: 10, color: "#4a4a4a" }}>/ {x.t}g</div>
                  {x.bonus > 0 && <div style={{ fontSize: 9, color: "#888", fontFamily: "monospace" }}>운동보충 +{x.bonus}g</div>}
                  {x.v > x.t && <div style={{ fontSize: 10, color: "#e05252", fontFamily: "monospace" }}>+{x.v - x.t}g 초과</div>}
                </div>
              ))}
            </div>
            <ProgressBar value={totals.k} max={effectiveTargetK} color="#5a9e6f" label="섭취 칼로리" unit="kcal" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "8px 0" }}>
              <span style={{ fontSize: 13, color: "#8a8a8a" }}>운동 소모</span>
              <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 500, color: exTotal > 0 ? "#4a8fc9" : "#4a4a4a" }}>
                -{exTotal.toLocaleString()} kcal
              </span>
            </div>
            <NetCalCard intake={totals.k} exercise={exTotal} targetK={effectiveTargetK} mode={mode} />
          </div>
          <div style={cs}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 10 }}>오늘 먹은 것 ({meals.length}건)</div>
            {!meals.length && <div style={{ fontSize: 13, color: "#4a4a4a", textAlign: "center", padding: 16 }}>식단 탭에서 기록 추가</div>}
            {groupMealsByTime(meals).map((group) => {
              const gP = Math.round(group.meals.reduce((s, m) => s + m.p * m.serving, 0));
              const gC = Math.round(group.meals.reduce((s, m) => s + m.c * m.serving, 0));
              const gF = Math.round(group.meals.reduce((s, m) => s + m.f * m.serving, 0));
              const gK = Math.round(group.meals.reduce((s, m) => s + m.k * m.serving, 0));
              return (
                <div key={group.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.meals.length}건)</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "#707070" }}>P{gP} C{gC} F{gF} · {gK}kcal</span>
                  </div>
                  {group.meals.map((m, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 5px 8px", borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 13 }}>
                      <div><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(m.hour || 0).padStart(2, "0")}시</span>{m.n}{m.serving !== 1 && <span style={{ color: "#707070", marginLeft: 4 }}>×{m.serving}</span>}</div>
                      <span style={{ color: "#707070", fontFamily: "monospace", fontSize: 12 }}>{Math.round(m.k * m.serving)}kcal</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={cs}>
            <div style={{ fontSize: 13, color: "#707070", marginBottom: 10 }}>오늘 운동 ({exercises.length}건)</div>
            {!exercises.length && <div style={{ fontSize: 13, color: "#4a4a4a", textAlign: "center", padding: 16 }}>운동 탭에서 기록 추가</div>}
            {groupExercisesByTime(exercises).map((group) => {
              const gKcal = Math.round(group.items.reduce((s, e) => s + (e.kcal || 0), 0));
              const gMin = group.items.reduce((s, e) => s + (e.duration || 0), 0);
              return (
                <div key={group.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.items.length}건)</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "#707070" }}>{gMin}분 · -{gKcal}kcal</span>
                  </div>
                  {group.items.map((e, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 5px 8px", borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 13 }}>
                      <div><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(e.hour || 0).padStart(2, "0")}시</span>{e.n} · {e.duration}분</div>
                      <span style={{ color: "#4a8fc9", fontFamily: "monospace", fontSize: 12 }}>-{e.kcal}kcal</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>)}

        {/* DIET */}
        {tab === "diet" && (<>
          {/* 입력 화면 상단 통계 (맨 위 고정): 다음 끼니 → 구성비 → 시간대 리듬 */}
          <NextMealTip totals={totals} meals={meals} nowHour={nowHour()} tP={TARGETS.p} tC={adjustedC} tK={effectiveTargetK} />
          <MacroRatioBar totals={totals} targets={TARGETS} />
          <IntakeRhythm meals={meals} />
          {/* 기간 통계(D1): 칼로리 vs 목표 밴드 라인 */}
          <CalorieBandChart allDays={allDays} targetsByMode={targetsByMode} mode={mode} />
          {/* 시간 선택 (먼저) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: "#1e1e1e", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 13, color: "#707070" }}>식사 시간</span>
            <select value={mealHour} onChange={e => setMealHour(parseInt(e.target.value))}
              style={{ flex: 1, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, fontFamily: "monospace" }}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {periodOf(h).name}</option>
              ))}
            </select>
            <button onClick={() => setMealHour(nowHour())} style={{ padding: "6px 10px", background: "#2a2a2a", border: "none", borderRadius: 6, color: "#8a8a8a", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>지금</button>
          </div>

          {/* 어제 식단 빠른 복사 */}
          {yesterdayData.meals.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 13, color: "#707070", marginBottom: 8 }}>어제 먹은 것</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[...new Map(yesterdayData.meals.map(m => [m.n + "_" + m.serving, m])).values()].map((m, i) => (
                  <div key={i} onClick={() => copyMealFromYesterday(m)}
                    style={{ background: "#252525", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 20, padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#f5f5f0" }}>
                    <span>{m.n}{m.serving !== 1 ? ` ×${m.serving}` : ""}</span>
                    <span style={{ color: "#4a8fc9", fontSize: 14 }}>+</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 이전 기록 가져오기 — 한 줄 (컨셉 D: 라벨 + 칩) */}
          {(yesterdayData.meals.length > 0 || hasDietCopySrc) && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, color: "#8a8a8a" }}>이전 기록 가져오기</span>
              <div style={{ display: "flex", gap: 7 }}>
                {yesterdayData.meals.length > 0 && (
                  <span onClick={copyAllMealsFromYesterday} title="어제 식단 전체 복사"
                    style={{ background: "#2a2a2a", border: "1px solid rgba(74,143,201,0.28)", borderRadius: 20, padding: "7px 14px", fontSize: 12, color: "#4a8fc9", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", whiteSpace: "nowrap" }}>↓ 어제</span>
                )}
                {hasDietCopySrc && (
                  <span onClick={() => openDateCopy("diet")}
                    style={{ background: "#2a2a2a", border: "1px solid rgba(74,143,201,0.28)", borderRadius: 20, padding: "7px 14px", fontSize: 12, color: "#4a8fc9", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", whiteSpace: "nowrap" }}>📅 날짜</span>
                )}
              </div>
            </div>
          )}

          {/* 검색 + 카메라 */}
          <input type="file" accept="image/*" capture="environment" id="photoInput" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) { analyzePhoto(e.target.files[0]); e.target.value = ""; } }} />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="text" placeholder="음식 검색... (예: 앤티앤스 프레즐 1개)" value={search} onChange={e => { setSearch(e.target.value); setAiResult(null); setAiError(""); }} style={{ flex: 1, padding: "10px 12px", background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box" }} />
            <div onClick={() => document.getElementById("photoInput").click()}
              style={{ width: 42, height: 42, background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.3)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="14" rx="2.5" stroke="#d4af37" strokeWidth="1.5"/><circle cx="12" cy="13.5" r="3.5" stroke="#d4af37" strokeWidth="1.5"/><rect x="9" y="3.5" width="6" height="2.5" rx="1" fill="#d4af37"/></svg>
            </div>
          </div>

          {/* 사진 분석 모드 */}
          {photoMode && (
            <div style={{ marginBottom: 16 }}>
              {/* 사진 미리보기 */}
              {photoPreview && (
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <img src={photoPreview} alt="음식 사진" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 10, background: "#252525" }} />
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                    <span onClick={() => document.getElementById("photoInput").click()} style={{ fontSize: 10, color: "#d4af37", cursor: "pointer" }}>다시 촬영</span>
                    <span onClick={() => { setPhotoMode(false); setPhotoResults(null); setPhotoPreview(null); setPhotoError(""); }} style={{ fontSize: 10, color: "#555", cursor: "pointer" }}>취소</span>
                  </div>
                </div>
              )}

              {/* 로딩 */}
              {photoLoading && (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <div style={{ fontSize: 14, color: "#d4af37", fontWeight: 500, marginBottom: 6 }}>음식을 분석하고 있어요...</div>
                  <div style={{ fontSize: 11, color: "#707070" }}>음식 인식 + 영양소 계산 중</div>
                </div>
              )}

              {/* 에러 */}
              {photoError && (
                <div style={{ background: "rgba(224,82,82,0.1)", border: "1px solid rgba(224,82,82,0.2)", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: "#e05252" }}>{photoError}</div>
                  <div onClick={() => document.getElementById("photoInput").click()} style={{ fontSize: 11, color: "#4a8fc9", marginTop: 6, cursor: "pointer" }}>다른 사진으로 다시 시도</div>
                </div>
              )}

              {/* 결과 체크리스트 */}
              {photoResults && photoResults.length > 0 && (
                <div style={{ background: "#1e1e1e", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 12, padding: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: "#d4af37", fontWeight: 500, marginBottom: 10 }}>{photoResults.length}개 인식 — 추가할 항목을 선택하세요</div>

                  {photoResults.map((f, i) => {
                    const grams = f.adjG ?? f.g ?? 100;
                    const p = f.adjP ?? f.p, c = f.adjC ?? f.c, fat = f.adjF ?? f.f, k = f.adjK ?? f.k;
                    return (
                      <div key={i} style={{ padding: "8px 0", borderBottom: i < photoResults.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", opacity: f.checked ? 1 : 0.4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div onClick={() => togglePhotoCheck(i)}
                            style={{ width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, cursor: "pointer", flexShrink: 0,
                              background: f.checked ? "#5a9e6f" : "transparent", border: f.checked ? "none" : "1.5px solid #555", color: "#fff" }}>
                            {f.checked ? "V" : ""}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 13, color: "#f5f5f0", fontWeight: 500 }}>{f.n}</span>
                              <span style={{ fontSize: 11, color: "#d4af37" }}>{k}kcal</span>
                            </div>
                            <div style={{ display: "flex", gap: 10, marginTop: 3 }}>
                              <span style={{ fontSize: 10, color: "#4a8fc9" }}>단 {p}g</span>
                              <span style={{ fontSize: 10, color: "#d4af37" }}>탄 {c}g</span>
                              <span style={{ fontSize: 10, color: "#e05252" }}>지 {fat}g</span>
                            </div>
                          </div>
                        </div>
                        {f.checked && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginLeft: 26 }}>
                            <span style={{ fontSize: 10, color: "#707070" }}>중량:</span>
                            <div style={{ display: "flex", alignItems: "center", background: "#252525", borderRadius: 6, overflow: "hidden" }}>
                              <span onClick={() => adjustPhotoWeight(i, Math.max(10, grams - 10))} style={{ padding: "4px 10px", fontSize: 13, color: "#999", cursor: "pointer", userSelect: "none" }}>-</span>
                              <span style={{ padding: "4px 10px", fontSize: 12, color: "#f5f5f0", minWidth: 40, textAlign: "center" }}>{grams}g</span>
                              <span onClick={() => adjustPhotoWeight(i, grams + 10)} style={{ padding: "4px 10px", fontSize: 13, color: "#999", cursor: "pointer", userSelect: "none" }}>+</span>
                            </div>
                            <span style={{ fontSize: 8, color: "#555" }}>AI 추정</span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontSize: 10, color: "#999" }}>선택 합계</span>
                    <span style={{ fontSize: 13, color: "#d4af37", fontWeight: 500 }}>
                      {photoResults.filter(f => f.checked).reduce((s, f) => s + (f.adjK ?? f.k), 0)}kcal
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button onClick={() => { setPhotoMode(false); setPhotoResults(null); setPhotoPreview(null); }}
                      style={{ flex: 1, padding: 10, background: "#252525", border: "none", borderRadius: 8, color: "#999", fontSize: 12, cursor: "pointer" }}>취소</button>
                    <button onClick={addPhotoMeals} disabled={!photoResults.some(f => f.checked)}
                      style={{ flex: 2, padding: 10, background: photoResults.some(f => f.checked) ? "#4a8fc9" : "#2a2a2a", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 500, cursor: photoResults.some(f => f.checked) ? "pointer" : "not-allowed" }}>
                      {photoResults.filter(f => f.checked).length}개 추가 ({photoResults.filter(f => f.checked).reduce((s, f) => s + (f.adjK ?? f.k), 0)}kcal)
                    </button>
                  </div>

                  <div style={{ fontSize: 9, color: "#555", textAlign: "center", marginTop: 6 }}>중량은 AI 추정값입니다. -/+ 버튼으로 수정하세요</div>
                </div>
              )}
            </div>
          )}

          {!photoMode && <div style={{ maxHeight: 420, overflowY: "auto", marginBottom: 16 }}>
            {/* 1단계: 로컬 DB */}
            {filteredFoods.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#707070", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#5a9e6f" }}></span> 내 DB ({filteredFoods.length})
                </div>
                {filteredFoods.map((f, i) => (
                  <div key={"l"+i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{f.n}</div>
                      <div style={{ fontSize: 11, color: "#707070", fontFamily: "monospace", marginTop: 2 }}>P{f.p} · C{f.c} · F{f.f} · {f.k}kcal</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" step="0.1" min="0.1" placeholder="1" value={qty[i] || ""} onChange={e => setQty({ ...qty, [i]: e.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <button onClick={() => addMeal(f, qty[i] || "1")} style={{ padding: "6px 14px", background: "#4a8fc9", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 2단계: 공용 DB */}
            {filteredShared.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#707070", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#d4af37" }}></span> 공용 DB ({filteredShared.length})
                </div>
                {filteredShared.map((f, i) => (
                  <div key={"s"+i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{f.n} {f.source === "ai" && <span style={{ fontSize: 9, color: "#d4af37", background: "rgba(212,175,55,0.12)", padding: "1px 5px", borderRadius: 4, marginLeft: 4 }}>AI</span>}</div>
                      <div style={{ fontSize: 11, color: "#707070", fontFamily: "monospace", marginTop: 2 }}>P{f.p} · C{f.c} · F{f.f} · {f.k}kcal</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" step="0.1" min="0.1" placeholder="1" value={qty["s"+i] || ""} onChange={e => setQty({ ...qty, ["s"+i]: e.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <button onClick={() => addMeal(f, qty["s"+i] || "1")} style={{ padding: "6px 14px", background: "#d4af37", border: "none", borderRadius: 6, color: "#141414", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 3단계: AI 분석 */}
            {search.trim() && filteredFoods.length === 0 && filteredShared.length === 0 && !aiResult && (
              <div style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 13, color: "#4a4a4a", marginBottom: 12 }}>DB에서 찾을 수 없습니다</div>
                <button
                  onClick={() => analyzeFood(search.trim())}
                  disabled={aiLoading}
                  className="dbp-btn"
                  style={{ padding: "10px 20px", background: aiLoading ? "#252525" : "rgba(212,175,55,0.15)", border: "1px solid rgba(212,175,55,0.3)", borderRadius: 10, color: aiLoading ? "#707070" : "#d4af37", fontSize: 13, fontWeight: 500, cursor: aiLoading ? "wait" : "pointer", marginBottom: 8 }}>
                  {aiLoading ? "AI 분석 중..." : `"${search.trim()}" AI 분석`}
                </button>
                {aiError && <div style={{ fontSize: 12, color: "#e05252", marginTop: 8 }}>{aiError}</div>}
              </div>
            )}

            {/* 검색 결과 있지만 원하는 게 없을 때도 AI 분석 가능 */}
            {search.trim() && (filteredFoods.length > 0 || filteredShared.length > 0) && !aiResult && (
              <div style={{ textAlign: "center", padding: 8 }}>
                <button
                  onClick={() => analyzeFood(search.trim())}
                  disabled={aiLoading}
                  style={{ padding: "6px 14px", background: "transparent", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 8, color: "#d4af37", fontSize: 11, cursor: aiLoading ? "wait" : "pointer" }}>
                  {aiLoading ? "분석 중..." : "원하는 음식이 없나요? AI 분석"}
                </button>
              </div>
            )}

            {/* AI 분석 결과 */}
            {aiResult && (
              <div style={{ background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 16, padding: 16, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#d4af37", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#d4af37" }}></span> AI 분석 결과
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{aiResult.n}</div>
                    <div style={{ fontSize: 12, color: "#707070", fontFamily: "monospace", marginTop: 4 }}>
                      P{aiResult.p} · C{aiResult.c} · F{aiResult.f} · {aiResult.k}kcal
                    </div>
                    <div style={{ fontSize: 10, color: "#4a4a4a", marginTop: 4 }}>공용 DB에 자동 저장됩니다</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" step="0.1" min="0.1" placeholder="1" value={qty["ai"] || ""} onChange={e => setQty({ ...qty, ai: e.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                    <button onClick={() => addMealFromAI(aiResult, qty["ai"] || "1")} style={{ padding: "6px 14px", background: "#d4af37", border: "none", borderRadius: 6, color: "#141414", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                  </div>
                </div>
              </div>
            )}

            {/* 직접 추가 안내 */}
            {search.trim() && !aiLoading && (
              <div style={{ textAlign: "center", padding: 8 }}>
                <button onClick={() => setShowAddFood(true)} style={{ padding: "8px 16px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#707070", fontSize: 12, cursor: "pointer" }}>
                  직접 입력하기
                </button>
              </div>
            )}
          </div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#707070" }}>오늘 기록 (섭취: {Math.round(totals.k).toLocaleString()}kcal)</span>
            {meals.length > 0 && <span style={{ fontSize: 10, color: "#4a4a4a" }}>꾹 눌러서 수정/삭제</span>}
          </div>
          {groupMealsByTime(meals).map((group) => {
            const gP = Math.round(group.meals.reduce((s, m) => s + m.p * m.serving, 0));
            const gC = Math.round(group.meals.reduce((s, m) => s + m.c * m.serving, 0));
            const gF = Math.round(group.meals.reduce((s, m) => s + m.f * m.serving, 0));
            const gK = Math.round(group.meals.reduce((s, m) => s + m.k * m.serving, 0));
            return (
              <div key={group.key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.meals.length}건)</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "#707070" }}>P{gP} C{gC} F{gF} · {gK}kcal</span>
                </div>
                {group.meals.map((m) => (
                  <div key={m._idx}>
                    <div className={`dbp-lp-item ${lpMeal.selectedIdx === m._idx ? "dbp-lp-selected" : ""}`} {...lpMeal.bind(m._idx)} onClick={() => { if (!lpMeal.wasLongPress()) setEditMealIdx(m._idx); }} style={{ ...cs, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: lpMeal.selectedIdx === m._idx ? 0 : 12, borderRadius: lpMeal.selectedIdx === m._idx ? "16px 16px 0 0" : 16, borderBottom: lpMeal.selectedIdx === m._idx ? "none" : cs.border }}>
                      <div style={{ flex: 1 }}><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(m.hour || 0).padStart(2, "0")}시</span><span style={{ fontSize: 13 }}>{m.n}</span><span style={{ color: "#707070", fontSize: 12, marginLeft: 4 }}>×{m.serving}</span><div style={{ fontSize: 11, color: "#4a4a4a", fontFamily: "monospace" }}>P{Math.round(m.p * m.serving)} C{Math.round(m.c * m.serving)} F{Math.round(m.f * m.serving)} · {Math.round(m.k * m.serving)}kcal</div></div>
                      <div style={{ fontSize: 13, color: "#d4af37", fontFamily: "monospace", fontWeight: 500 }}>{Math.round(m.k * m.serving)}</div>
                    </div>
                    {lpMeal.selectedIdx === m._idx && (
                      <div style={{ ...cs, padding: 0, marginTop: 0, borderRadius: "0 0 16px 16px", overflow: "hidden", borderTop: "none" }}>
                        <LongPressActionBar onEdit={() => { lpMeal.clear(); setEditMealIdx(m._idx); }} onDelete={() => { lpMeal.clear(); removeMeal(m._idx); }} onCancel={lpMeal.clear} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </>)}

        {/* EXERCISE */}
        {tab === "exercise" && (<>
          {/* 입력 화면 상단 통계: 오늘 운동 도장 & 스트릭 → 시간대 분포 */}
          <WorkoutStamp date={date} exercises={exercises} exTotal={exTotal} allDays={allDays} todayStr={today()} />
          <ExerciseRhythm exercises={exercises} />
          {/* 기간 통계(E9): 요일별 운동 밸런스 레이더 */}
          <WeekdayRadar allDays={allDays} />
          {/* 시간 선택 (먼저) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: "#1e1e1e", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 13, color: "#707070" }}>운동 시간</span>
            <select value={exHour} onChange={e => setExHour(parseInt(e.target.value))}
              style={{ flex: 1, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 14, fontFamily: "monospace" }}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 {periodOf(h).name}</option>
              ))}
            </select>
            <button onClick={() => setExHour(nowHour())} style={{ padding: "6px 10px", background: "#2a2a2a", border: "none", borderRadius: 6, color: "#8a8a8a", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>지금</button>
          </div>

          {/* 어제 운동 빠른 복사 */}
          {yesterdayData.exercises.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 13, color: "#707070", marginBottom: 8 }}>어제 운동</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {yesterdayData.exercises.map((e, i) => (
                  <div key={i} onClick={() => copyExFromYesterday(e)}
                    style={{ background: "#252525", border: "1px solid rgba(90,158,111,0.2)", borderRadius: 20, padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#f5f5f0" }}>
                    <span>{e.n} {e.duration}분</span>
                    <span style={{ color: "#5a9e6f", fontSize: 14 }}>+</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 이전 기록 가져오기 — 한 줄 (컨셉 D: 라벨 + 칩) */}
          {(yesterdayData.exercises.length > 0 || hasExCopySrc) && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, color: "#8a8a8a" }}>이전 기록 가져오기</span>
              <div style={{ display: "flex", gap: 7 }}>
                {yesterdayData.exercises.length > 0 && (
                  <span onClick={copyAllExFromYesterday} title="어제 운동 전체 복사"
                    style={{ background: "#2a2a2a", border: "1px solid rgba(90,158,111,0.28)", borderRadius: 20, padding: "7px 14px", fontSize: 12, color: "#5a9e6f", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", whiteSpace: "nowrap" }}>↓ 어제</span>
                )}
                {hasExCopySrc && (
                  <span onClick={() => openDateCopy("exercise")}
                    style={{ background: "#2a2a2a", border: "1px solid rgba(90,158,111,0.28)", borderRadius: 20, padding: "7px 14px", fontSize: 12, color: "#5a9e6f", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", whiteSpace: "nowrap" }}>📅 날짜</span>
                )}
              </div>
            </div>
          )}

          {/* 검색 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="text" placeholder="운동 검색..." value={exSearch} onChange={e => setExSearch(e.target.value)} style={{ flex: 1, padding: "10px 12px", background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#f5f5f0", fontSize: 14, boxSizing: "border-box" }} />
          </div>
          <div style={{ maxHeight: 400, overflowY: "auto", marginBottom: 16 }}>
            {/* 내 DB 결과 */}
            {filteredEx.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#5a9e6f", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#5a9e6f" }}></span> 내 DB ({filteredEx.length})
                </div>
                {filteredEx.map((e, i) => (
                  <div key={i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{e.n}</div>
                      <div style={{ fontSize: 11, color: "#707070" }}>MET {e.m} {e.memo && `· ${e.memo}`}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" min="5" step="5" placeholder="30" value={exMin["db_"+i] || ""} onChange={ev => setExMin({ ...exMin, ["db_"+i]: ev.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <span style={{ fontSize: 11, color: "#4a4a4a" }}>분</span>
                      <button onClick={() => addExercise(e, exMin["db_"+i] || "30")} style={{ padding: "6px 14px", background: "#5a9e6f", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 공용 DB 결과 */}
            {filteredSharedEx.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#4a8fc9", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#4a8fc9" }}></span> 공용 DB ({filteredSharedEx.length})
                </div>
                {filteredSharedEx.map((e, i) => (
                  <div key={i} style={{ ...cs, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{e.n} {e.source === "ai" && <span style={{ fontSize: 9, color: "#4a8fc9", background: "rgba(74,143,201,0.12)", padding: "1px 5px", borderRadius: 4, marginLeft: 4 }}>AI</span>}</div>
                      <div style={{ fontSize: 11, color: "#707070" }}>MET {e.m} {e.memo && `· ${e.memo}`}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" min="5" step="5" placeholder="30" value={exMin["sh_"+i] || ""} onChange={ev => setExMin({ ...exMin, ["sh_"+i]: ev.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <span style={{ fontSize: 11, color: "#4a4a4a" }}>분</span>
                      <button onClick={() => addExercise(e, exMin["sh_"+i] || "30")} style={{ padding: "6px 14px", background: "#5a9e6f", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* DB에 없을 때 AI 분석 버튼 */}
            {exSearch.trim() && filteredEx.length === 0 && filteredSharedEx.length === 0 && !aiExResults && (
              <div style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 13, color: "#4a4a4a", marginBottom: 12 }}>DB에서 찾을 수 없습니다</div>
                <button
                  onClick={() => analyzeExercise(exSearch.trim())}
                  disabled={aiExLoading}
                  className="dbp-btn"
                  style={{ padding: "10px 20px", background: aiExLoading ? "#252525" : "rgba(74,143,201,0.15)", border: "1px solid rgba(74,143,201,0.3)", borderRadius: 10, color: aiExLoading ? "#707070" : "#4a8fc9", fontSize: 13, fontWeight: 500, cursor: aiExLoading ? "wait" : "pointer", marginBottom: 8 }}>
                  {aiExLoading ? "AI 분석 중..." : `"${exSearch.trim()}" AI 분석`}
                </button>
                {aiExError && <div style={{ fontSize: 12, color: "#e05252", marginTop: 8 }}>{aiExError}</div>}
              </div>
            )}

            {/* 검색 결과 있지만 원하는 게 없을 때도 AI 분석 가능 */}
            {exSearch.trim() && (filteredEx.length > 0 || filteredSharedEx.length > 0) && !aiExResults && (
              <div style={{ textAlign: "center", padding: 8 }}>
                <button
                  onClick={() => analyzeExercise(exSearch.trim())}
                  disabled={aiExLoading}
                  style={{ padding: "6px 14px", background: "transparent", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 8, color: "#4a8fc9", fontSize: 11, cursor: aiExLoading ? "wait" : "pointer" }}>
                  {aiExLoading ? "분석 중..." : "원하는 운동이 없나요? AI 분석"}
                </button>
              </div>
            )}

            {/* AI 분석 결과 (복수 강도) */}
            {aiExResults && (
              <div style={{ background: "rgba(74,143,201,0.06)", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 16, padding: 16, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#4a8fc9", marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "#4a8fc9" }}></span> AI 분석 결과 ({aiExResults.length}개 강도)
                </div>
                {aiExResults.map((ex, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < aiExResults.length - 1 ? "1px solid rgba(74,143,201,0.1)" : "none" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{ex.n}</div>
                      <div style={{ fontSize: 11, color: "#707070", fontFamily: "monospace", marginTop: 2 }}>
                        MET {ex.m} · 30분 시 약 {Math.round((ex.m * TARGETS.weight * 30) / 60)}kcal
                      </div>
                      {ex.memo && <div style={{ fontSize: 10, color: "#4a4a4a", marginTop: 2 }}>{ex.memo}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" min="5" step="5" placeholder="30" value={exMin["ai_"+i] || ""} onChange={ev => setExMin({ ...exMin, ["ai_"+i]: ev.target.value })} style={{ width: 50, padding: "6px 8px", background: "#252525", border: "1px solid rgba(74,143,201,0.2)", borderRadius: 6, color: "#f5f5f0", fontSize: 13, textAlign: "center" }} />
                      <span style={{ fontSize: 11, color: "#4a4a4a" }}>분</span>
                      <button onClick={() => { addExerciseFromAI(ex, exMin["ai_"+i] || "30"); setAiExResults(null); }} style={{ padding: "6px 14px", background: "#4a8fc9", border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+</button>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 10, color: "#4a4a4a", marginTop: 8 }}>선택한 운동이 공용 DB에 자동 저장됩니다</div>
              </div>
            )}

            {/* 직접 추가 */}
            {exSearch.trim() && !aiExLoading && (
              <div style={{ textAlign: "center", padding: 8 }}>
                <button onClick={() => setShowAddEx(true)} style={{ padding: "8px 16px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#707070", fontSize: 12, cursor: "pointer" }}>
                  직접 입력하기
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#707070" }}>오늘 운동 (소모: {exTotal}kcal)</span>
            {exercises.length > 0 && <span style={{ fontSize: 10, color: "#4a4a4a" }}>꾹 눌러서 수정/삭제</span>}
          </div>
          {groupExercisesByTime(exercises).map((group) => {
            const gKcal = Math.round(group.items.reduce((s, e) => s + (e.kcal || 0), 0));
            const gMin = group.items.reduce((s, e) => s + (e.duration || 0), 0);
            return (
              <div key={group.key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{group.label} ({group.items.length}건)</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "#707070" }}>{gMin}분 · -{gKcal}kcal</span>
                </div>
                {group.items.map((e) => (
                  <div key={e._idx}>
                    <div className={`dbp-lp-item ${lpEx.selectedIdx === e._idx ? "dbp-lp-selected" : ""}`} {...lpEx.bind(e._idx)} onClick={() => { if (!lpEx.wasLongPress()) setEditExIdx(e._idx); }} style={{ ...cs, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginBottom: lpEx.selectedIdx === e._idx ? 0 : 12, borderRadius: lpEx.selectedIdx === e._idx ? "16px 16px 0 0" : 16, borderBottom: lpEx.selectedIdx === e._idx ? "none" : cs.border }}>
                      <div style={{ flex: 1 }}><span style={{ color: "#4a8fc9", fontSize: 11, marginRight: 6, fontFamily: "monospace" }}>{String(e.hour || 0).padStart(2, "0")}시</span><span style={{ fontSize: 13 }}>{e.n}</span><span style={{ color: "#707070", fontSize: 12, marginLeft: 4 }}>{e.duration}분</span><div style={{ fontSize: 11, color: "#4a8fc9", fontFamily: "monospace" }}>-{e.kcal} kcal</div></div>
                    </div>
                    {lpEx.selectedIdx === e._idx && (
                      <div style={{ ...cs, padding: 0, marginTop: 0, borderRadius: "0 0 16px 16px", overflow: "hidden", borderTop: "none" }}>
                        <LongPressActionBar onEdit={() => { lpEx.clear(); setEditExIdx(e._idx); }} onDelete={() => { lpEx.clear(); removeExercise(e._idx); }} onCancel={lpEx.clear} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </>)}

        {tab === "body" && <BodyTab bodyLog={bodyLog} addBody={addBody} date={date} onEditBody={editBody} onDeleteBody={deleteBody} user={user} goals={goals} onSaveGoals={saveGoals} allDays={allDays} />}
        {tab === "stats" && <StatsTab bodyLog={bodyLog} allDays={allDays} goals={goals} onSaveGoals={saveGoals} appTargets={TARGETS} targetsByMode={targetsByMode} mode={mode} appAdjust={appAdjust} tdeeHistory={tdeeHistory} />}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "rgba(20,20,20,0.95)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderTop: `1px solid ${THEME.border}`, display: "flex", zIndex: 10 }}>
        {[["home", "홈"], ["diet", "식단"], ["exercise", "운동"], ["body", "체성분"], ["stats", "통계"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={tabStyle(k)}>{l}</button>
        ))}
      </div>

      {/* Modals */}
      <Modal open={showAddFood} onClose={() => setShowAddFood(false)} title="새 음식 추가">
        <AddFoodForm initialName={search} onSave={saveCustomFood} onCancel={() => setShowAddFood(false)} />
      </Modal>
      <Modal open={showAddEx} onClose={() => setShowAddEx(false)} title="새 운동 추가">
        <AddExForm initialName={exSearch} onSave={saveCustomEx} onCancel={() => setShowAddEx(false)} weight={TARGETS.weight} />
      </Modal>
      <Modal open={showHealth} onClose={() => setShowHealth(false)} title="🩹 컨디션 기록">
        <HealthEvents events={healthEvents} onChange={saveHealthEvents} todayStr={today()} />
      </Modal>
      <Modal open={showManage} onClose={() => setShowManage(false)} title="설정 / 데이터">
        <div style={{ display: "flex", gap: 0, marginBottom: 14, borderRadius: 8, overflow: "hidden" }}>
          <button onClick={() => setManageTab("goal")} style={{ flex: 1, padding: 9, fontSize: 12, fontWeight: 500, background: manageTab === "goal" ? "#d4af37" : "#2a2a2a", color: manageTab === "goal" ? "#141414" : "#8a8a8a", border: "none", cursor: "pointer", borderRadius: "8px 0 0 8px" }}>목표</button>
          <button onClick={() => setManageTab("freq")} style={{ flex: 1, padding: 9, fontSize: 12, fontWeight: 500, background: manageTab === "freq" ? "#d4af37" : "#2a2a2a", color: manageTab === "freq" ? "#141414" : "#8a8a8a", border: "none", cursor: "pointer" }}>자주 사용</button>
          <button onClick={() => setManageTab("food")} style={{ flex: 1, padding: 9, fontSize: 12, fontWeight: 500, background: manageTab === "food" ? "#d4af37" : "#2a2a2a", color: manageTab === "food" ? "#141414" : "#8a8a8a", border: "none", cursor: "pointer" }}>내 DB</button>
          <button onClick={() => setManageTab("data")} style={{ flex: 1, padding: 9, fontSize: 12, fontWeight: 500, background: manageTab === "data" ? "#d4af37" : "#2a2a2a", color: manageTab === "data" ? "#141414" : "#8a8a8a", border: "none", cursor: "pointer" }}>데이터</button>
          <button onClick={() => setManageTab("reminders")} style={{ flex: 1, padding: 9, fontSize: 12, fontWeight: 500, background: manageTab === "reminders" ? "#d4af37" : "#2a2a2a", color: manageTab === "reminders" ? "#141414" : "#8a8a8a", border: "none", cursor: "pointer", borderRadius: "0 8px 8px 0" }}>알림</button>
        </div>

        {/* 탭 0: 목표 모드 (감량/유지) */}
        {manageTab === "goal" && (() => {
          const TC = targetsByMode.cut, TM = targetsByMode.maintain;
          const opt = (key, on, label, t, sub, note) => (
            <div onClick={() => saveGoals({ ...goals, mode: key })}
              style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", padding: 14, marginBottom: 10,
                borderRadius: 14, background: on ? "rgba(90,158,111,0.07)" : "#1e1e1e",
                border: on ? "1.5px solid #5a9e6f" : "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", marginTop: 2, flexShrink: 0, border: `2px solid ${on ? "#5a9e6f" : "#4a4a4a"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {on && <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#5a9e6f" }} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: on ? 600 : 500, color: on ? "#5a9e6f" : "#f5f5f0" }}>{label}</span>
                  <span style={{ fontSize: 13, fontFamily: "monospace", color: on ? "#5a9e6f" : "#8a8a8a" }}>목표 {t.k.toLocaleString()} kcal</span>
                </div>
                <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 6, lineHeight: 1.5 }}>{sub}<br/>P {t.p} · C {t.c} · F {t.f} (휴식일 기준)</div>
                <div style={{ fontSize: 10, color: on ? "#5a9e6f" : "#d4af37", marginTop: 6 }}>{note}</div>
              </div>
            </div>
          );
          return (<>
            <div style={{ fontSize: 11, color: "#707070", marginBottom: 10 }}>목표 모드 — 칼로리·매크로 계산 방식</div>
            {opt("cut", mode === "cut", "감량 모드", TC, "기초적자 −175 · 운동 50% 되먹기", "평균 적자 ~400/일 · 주 약 0.37kg 감량")}
            {opt("maintain", mode === "maintain", "유지 모드", TM, "적자 0 · 운동 100% 되먹기", "에너지 균형 · 체중·근육 유지 (체지방 목표 도달 후)")}
            <div style={{ background: "#252525", borderRadius: 10, padding: 12, marginTop: 4 }}>
              <div style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.6 }}>
                <b style={{ color: "#f5f5f0" }}>차이는 딱 두 가지</b><br/>
                ① 휴식일 적자 <span style={{ fontFamily: "monospace", color: "#e05252" }}>−175</span> → <span style={{ fontFamily: "monospace", color: "#5a9e6f" }}>0</span><br/>
                ② 운동 되먹기 <span style={{ fontFamily: "monospace", color: "#e05252" }}>×0.5</span> → <span style={{ fontFamily: "monospace", color: "#5a9e6f" }}>×1.0</span><br/>
                단백질 2.2g/kg · 지방 0.6g/kg는 동일. 탄수가 자동으로 늘어납니다(+{TM.c - TC.c}g).
              </div>
              <div style={{ fontSize: 10, color: "#707070", marginTop: 8, lineHeight: 1.5 }}>전환은 오늘부터 적용됩니다. 과거 기록은 그 날의 모드 그대로 판정돼요.</div>
            </div>
            <div style={{ fontSize: 11, color: "#707070", margin: "16px 0 10px" }}>실측 자동 보정</div>
            <AdaptiveTdeeCard estimate={tdeeEstimate} adaptiveOn={adaptiveOn} currentAdjust={appAdjust} proposal={adaptiveProposal} onToggle={setAdaptiveOn} onApply={applyAdaptive} onRevert={revertAdaptive} />
          </>);
        })()}

        {/* 탭 1: 자주 사용 */}
        {manageTab === "freq" && (<>
          {freqData.foods.length > 0 ? (<>
            <div style={{ fontSize: 11, color: "#707070", marginBottom: 6 }}>자주 먹는 음식 TOP {freqData.foods.length}</div>
            <div style={{ background: "#252525", borderRadius: 10, marginBottom: 14 }}>
              {freqData.foods.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: i < freqData.foods.length - 1 ? "0.5px solid rgba(255,255,255,0.04)" : "none" }}>
                  <span style={{ fontSize: 11, color: i < 3 ? "#d4af37" : "#707070", fontWeight: 600, minWidth: 20 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#f5f5f0" }}>{f.n}</div>
                    <div style={{ fontSize: 10, color: "#4a4a4a", fontFamily: "monospace" }}>P{Math.round(f.p)} C{Math.round(f.c)} F{Math.round(f.f)} · {Math.round(f.k)}kcal</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 500, fontFamily: "monospace", color: i < 3 ? "#d4af37" : "#707070" }}>{f.count}회</span>
                </div>
              ))}
            </div>
          </>) : <div style={{ fontSize: 12, color: "#4a4a4a", textAlign: "center", padding: 16 }}>식단 기록이 없습니다</div>}
          {freqData.exercises.length > 0 ? (<>
            <div style={{ fontSize: 11, color: "#707070", marginBottom: 6 }}>자주 하는 운동 TOP {freqData.exercises.length}</div>
            <div style={{ background: "#252525", borderRadius: 10 }}>
              {freqData.exercises.map((e, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: i < freqData.exercises.length - 1 ? "0.5px solid rgba(255,255,255,0.04)" : "none" }}>
                  <span style={{ fontSize: 11, color: i < 3 ? "#4a8fc9" : "#707070", fontWeight: 600, minWidth: 20 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#f5f5f0" }}>{e.n}</div>
                    <div style={{ fontSize: 10, color: "#4a4a4a" }}>MET {e.m}</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 500, fontFamily: "monospace", color: i < 3 ? "#4a8fc9" : "#707070" }}>{e.count}회</span>
                </div>
              ))}
            </div>
          </>) : <div style={{ fontSize: 12, color: "#4a4a4a", textAlign: "center", padding: 16 }}>운동 기록이 없습니다</div>}
          <div style={{ fontSize: 9, color: "#4a4a4a", textAlign: "center", marginTop: 8 }}>전체 기록 기반 자동 집계</div>
        </>)}

        {/* 탭 2: 내 DB */}
        {manageTab === "food" && (<>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {[
              { l: "기본", v: DEFAULT_FOODS.length, c: "#707070" },
              { l: "직접 추가", v: customFoods.length, c: "#d4af37" },
              { l: "AI 분석", v: sharedFoods.filter(f => f.source === "ai").length, c: "#4a8fc9" }
            ].map((x, i) => (
              <div key={i} style={{ flex: 1, background: "#252525", borderRadius: 8, padding: "6px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 9, color: x.c }}>{x.l}</div>
                <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace", color: x.c === "#707070" ? "#f5f5f0" : x.c }}>{x.v}</div>
                <div style={{ fontSize: 9, color: "#4a4a4a" }}>음식</div>
              </div>
            ))}
          </div>
          {customFoods.length > 0 && (<>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#d4af37" }}>직접 추가 ({customFoods.length})</span>
              <span style={{ fontSize: 9, color: "#4a4a4a" }}>삭제 버튼으로 제거</span>
            </div>
            {customFoods.map((f, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "0.5px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{f.n}</div>
                  <div style={{ fontSize: 11, color: "#707070", fontFamily: "monospace" }}>P{f.p} C{f.c} F{f.f} · {f.k}kcal</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 99, background: "rgba(212,175,55,0.12)", color: "#d4af37" }}>직접</span>
                  <button onClick={() => deleteCustomFood(i)} style={{ padding: "4px 8px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 10, cursor: "pointer" }}>삭제</button>
                </div>
              </div>
            ))}
          </>)}
          <div style={{ marginTop: 10, marginBottom: 10, height: 0.5, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ fontSize: 11, color: "#707070", marginBottom: 6 }}>운동 DB (기본 {DEFAULT_EX.length} + 직접 {customEx.length})</div>
          {customEx.length > 0 && customEx.map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "0.5px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{e.n}</div>
                <div style={{ fontSize: 11, color: "#707070" }}>MET {e.m}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 99, background: "rgba(212,175,55,0.12)", color: "#d4af37" }}>직접</span>
                <button onClick={() => deleteCustomEx(i)} style={{ padding: "4px 8px", background: "rgba(224,82,82,0.15)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, color: "#e05252", fontSize: 10, cursor: "pointer" }}>삭제</button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <button onClick={() => { setShowManage(false); setShowAddFood(true); }} style={{ flex: 1, padding: 10, background: "#d4af37", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>+ 음식 추가</button>
            <button onClick={() => { setShowManage(false); setShowAddEx(true); }} style={{ flex: 1, padding: 10, background: "#4a8fc9", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>+ 운동 추가</button>
          </div>
        </>)}

        {/* 탭 3: 데이터 */}
        {manageTab === "data" && (<>
          <div style={{ fontSize: 11, color: "#707070", marginBottom: 8 }}>데이터 현황</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 14 }}>
            {[
              { l: "기록 일수", v: Object.keys(allDays).length, c: "#f5f5f0" },
              { l: "체성분", v: bodyLog.length, c: "#5a9e6f" },
              { l: "음식 DB", v: FOOD_DB.length, c: "#4a8fc9" },
              { l: "운동 DB", v: EX_DB.length, c: "#d4af37" }
            ].map((x, i) => (
              <div key={i} style={{ background: "#252525", borderRadius: 8, padding: "8px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace", color: x.c }}>{x.v}</div>
                <div style={{ fontSize: 8, color: "#707070" }}>{x.l}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#707070", marginBottom: 8 }}>백업 / 내보내기</div>
          <div style={{ background: "#252525", borderRadius: 10, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}>
              <div>
                <div style={{ fontSize: 12, color: "#f5f5f0" }}>Firestore 동기화</div>
                <div style={{ fontSize: 10, color: "#5a9e6f", marginTop: 2 }}>실시간 · 정상</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#5a9e6f" }} />
            </div>
            <div onClick={exportJson} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "0.5px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 12, color: "#f5f5f0" }}>JSON 전체 백업</div>
                <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>모든 기록·설정 포함 · 복원 가능한 유일한 형태</div>
              </div>
              <span style={{ fontSize: 12, color: "#5a9e6f" }}>💾</span>
            </div>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "0.5px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 12, color: "#f5f5f0" }}>JSON 복원 (가져오기)</div>
                <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>백업 파일로 전체 되살리기 · 복원 전 안전본 자동 저장</div>
              </div>
              <span style={{ fontSize: 12, color: "#d4af37" }}>📂</span>
              <input type="file" accept=".json,application/json" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importJsonFile(f); }} />
            </label>
            <div onClick={doBackup} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "0.5px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 12, color: "#f5f5f0" }}>CSV 내보내기</div>
                <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>엑셀 열람용 (복원 불가)</div>
              </div>
              <span style={{ fontSize: 12, color: "#4a8fc9" }}>📥</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px" }}>
              <div>
                <div style={{ fontSize: 12, color: "#f5f5f0" }}>마지막 백업</div>
                <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>{lastBackup ? `${backupDaysAgo}일 전 · ${lastBackup}` : "없음"}</div>
              </div>
              <div onClick={() => { exportJson(); setShowManage(false); }} style={{ background: "#d4af37", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#fff", fontWeight: 500, cursor: "pointer" }}>백업</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#707070", marginBottom: 8 }}>데이터 관리</div>
          <div style={{ background: "#252525", borderRadius: 10 }}>
            <div onClick={() => { try { const uid = getCurrentUserId(); localStorage.removeItem("dt_" + uid + "_body-coaching"); alert("AI 코칭 캐시가 초기화되었습니다."); } catch {} }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 12, color: "#f5f5f0" }}>AI 분석 캐시 정리</div>
                <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>AI 코칭 캐시 삭제 (재분석 유도)</div>
              </div>
              <span style={{ fontSize: 11, color: "#707070" }}>→</span>
            </div>
          </div>
        </>)}

        {/* 탭 4: 알림 */}
        {manageTab === "reminders" && (
          <ReminderSettings reminders={goals.reminders} onChange={saveReminders} pushReady={pushReady} onEnablePush={doEnablePush} onDisablePush={doDisablePush} />
        )}
      </Modal>

      {/* Edit Meal Modal */}
      <Modal open={editMealIdx !== null} onClose={() => setEditMealIdx(null)} title="식단 수정">
        {editMealIdx !== null && meals[editMealIdx] && <EditMealForm meal={meals[editMealIdx]} onSave={(updated) => editMeal(editMealIdx, updated)} onCancel={() => setEditMealIdx(null)} onDelete={() => { removeMeal(editMealIdx); setEditMealIdx(null); }} />}
      </Modal>

      {/* Edit Exercise Modal */}
      <Modal open={editExIdx !== null} onClose={() => setEditExIdx(null)} title="운동 수정">
        {editExIdx !== null && exercises[editExIdx] && <EditExForm exercise={exercises[editExIdx]} onSave={(updated) => editExercise(editExIdx, updated)} onCancel={() => setEditExIdx(null)} onDelete={() => { removeExercise(editExIdx); setEditExIdx(null); }} weight={TARGETS.weight} />}
      </Modal>

      {/* 날짜별 복사 모달 (컨셉 3 끼니 시트) */}
      <Modal open={dateCopyType !== null} onClose={() => setDateCopyType(null)} title={dateCopyType === "exercise" ? "날짜별 운동 가져오기" : "날짜별 식단 가져오기"}>
        {dateCopyType !== null && (
          <DateCopySheet
            type={dateCopyType}
            allDays={allDays}
            todayStr={today()}
            srcDate={dateCopySrc}
            onPickDate={setDateCopySrc}
            onCopyItem={copyDateItem}
            onCopyGroup={copyDateGroup}
            onCopyAll={copyDateGroup}
          />
        )}
      </Modal>

      {/* 레거시 데이터 가져오기 (운영자 전용) — 프로필 선택 시절 uid의 Firestore 데이터를 Auth uid로 복사 */}
      <Modal open={showMigrate} onClose={() => { if (!migrateBusy) { setShowMigrate(false); setMigrateMsg(null); } }} title="기존 데이터 가져오기">
        <div style={{ fontSize: 12, color: "#707070", lineHeight: 1.7, marginBottom: 12 }}>
          프로필 선택 방식(구버전)에서 쓰던 ID의 데이터를 현재 계정으로 복사해요.<br />
          기존 데이터는 지워지지 않으며, 같은 키는 가져온 값으로 덮어써요.
        </div>
        <div style={{ fontSize: 12, color: "#707070", marginBottom: 4 }}>이전 프로필 ID</div>
        <input value={migrateId} onChange={e => { setMigrateId(e.target.value); setMigrateMsg(null); }}
          placeholder="예: daniel"
          style={{ width: "100%", padding: 12, background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#f5f5f0", fontSize: 15, boxSizing: "border-box", marginBottom: 8 }} />
        {migrateMsg && <div style={{ fontSize: 12, color: migrateMsg.ok ? "#5a9e6f" : "#e05252", marginBottom: 8, lineHeight: 1.6 }}>{migrateMsg.text}</div>}
        <button onClick={runMigrate} disabled={migrateBusy || !migrateId.trim()}
          style={{ width: "100%", padding: 13, background: migrateBusy ? "#2a2a2a" : "#d4af37", border: "none", borderRadius: 12, color: migrateBusy ? "#666" : "#141414", fontSize: 14, fontWeight: 600, cursor: migrateBusy ? "wait" : "pointer" }}>
          {migrateBusy ? "가져오는 중... (닫지 마세요)" : "가져오기 시작"}
        </button>
      </Modal>

      {/* 되돌리기 스낵바 (컨셉 4) — 모달 위에도 보이도록 높은 z-index */}
      {copyUndo && (
        <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 78, zIndex: 10000, width: "calc(100% - 32px)", maxWidth: 448, background: "#1e2a20", border: "1px solid rgba(90,158,111,0.35)", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
          <span style={{ fontSize: 13, color: "#5a9e6f" }}>✓ {copyUndo.text}</span>
          <span onClick={undoCopy} style={{ fontSize: 13, color: "#f5f5f0", fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>되돌리기</span>
        </div>
      )}
    </div>
  );
}
