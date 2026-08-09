// scripts/r29-impact.mjs — R-29를 고쳤을 때 과거 판정이 얼마나 달라지는지 계산한다.
//
// 배경: `adaptiveOn`을 끄면 `tdeeHistory`가 통째로 무시돼(App.jsx:706) **과거 날짜의 목표·판정까지**
// 보정 없음으로 바뀐다. 다시 켜면 되살아난다. 코드가 명시한 의도("보정은 from 날짜로 과거를 보존")와
// 어긋나므로 고치는 것이 맞지만, 고치는 순간 화면에 보이는 과거 ✓/✗가 달라질 수 있다.
// 고치기 전에 "실제로 몇 건이 달라지는가"를 먼저 재는 도구.
//
// 데이터를 밖으로 내보내지 않는다 — 백업 JSON을 읽어 로컬에서 계산하고 숫자만 출력한다.
//
// 사용법:
//   1) 앱에서 설정 → 데이터 → "JSON 내보내기"로 백업 파일을 받는다
//   2) node scripts/r29-impact.mjs <백업파일경로>
//
// 예: node scripts/r29-impact.mjs C:\Users\me\Downloads\daniel_backup_2026-08-09.json
import { readFileSync } from "node:fs";
import { makeDayTargets, aggregateDay, isCalOk, effectiveDayMode, REST_K } from "../src/utils.js";

const path = process.argv[2];
if (!path) {
  console.error("사용법: node scripts/r29-impact.mjs <백업 JSON 경로>");
  process.exit(1);
}

let backup;
try {
  backup = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  console.error(`파일을 읽지 못했습니다: ${e.message}`);
  process.exit(1);
}

const d = backup?.data;
if (!d || typeof d !== "object") {
  console.error("이 앱의 백업 파일 형식이 아닙니다 (data 없음).");
  process.exit(1);
}

const allDays = d.days || {};
const bodyLog = Array.isArray(d.bodylog) ? d.bodylog : [];
const goals = d.goals || {};
const profile = d.profile || {};
const adaptiveOn = !!goals.adaptiveOn;
const history = Array.isArray(goals.tdeeHistory) ? goals.tdeeHistory : [];

const height = profile.height || 175;
const age = profile.age || 35;
const fallbackWeight = bodyLog.length ? bodyLog[bodyLog.length - 1].weight : 75;

// 지금 앱이 쓰는 이력 (App.jsx:706 — 꺼져 있으면 통째로 무시)
const currentHistory = adaptiveOn ? history : [];
// 고친 뒤의 이력 (항상 사용 — 과거는 그때의 보정을 유지)
const fixedHistory = history;

const mk = (h) => makeDayTargets({ bodyLog, height, age, fallbackWeight, tdeeHistory: h });
const nowTargets = mk(currentHistory);
const fixTargets = mk(fixedHistory);

// 판정은 앱과 같은 산식 — analysisExport.js:272-278과 동일하게 맞춘다
const verdict = (dayTargets, ds, rec) => {
  const a = aggregateDay(rec);
  const dM = effectiveDayMode(rec, a.ex, rec.mode || "cut");
  const k = dM === "rest" ? REST_K : dayTargets(dM, ds).k;
  return { ok: isCalOk(a.k, a.ex, k, dM), targetK: k, intake: Math.round(a.k) };
};

const recorded = Object.keys(allDays)
  .filter((ds) => allDays[ds] && ((allDays[ds].meals || []).length || (allDays[ds].exercises || []).length))
  .sort();

let targetChanged = 0, flipped = 0, maxDelta = 0;
const flips = [];
for (const ds of recorded) {
  const rec = allDays[ds];
  const a = verdict(nowTargets, ds, rec);
  const b = verdict(fixTargets, ds, rec);
  const delta = b.targetK - a.targetK;
  if (delta !== 0) {
    targetChanged++;
    if (Math.abs(delta) > Math.abs(maxDelta)) maxDelta = delta;
  }
  if (a.ok !== b.ok) {
    flipped++;
    flips.push({ ds, from: a.ok ? "✓" : "✗", to: b.ok ? "✓" : "✗", intake: a.intake, nowK: a.targetK, fixK: b.targetK });
  }
}

const fmt = (n) => (n > 0 ? `+${n}` : String(n));
console.log("");
console.log("── R-29 영향 분석 ────────────────────────────────────");
console.log(`백업 파일          : ${path}`);
console.log(`기록이 있는 날     : ${recorded.length}일 (${recorded[0] || "-"} ~ ${recorded[recorded.length - 1] || "-"})`);
console.log(`적응형 스위치      : ${adaptiveOn ? "켜짐(ON)" : "꺼짐(OFF)"}`);
console.log(`tdeeHistory 항목   : ${history.length}건`);
for (const h of history) console.log(`   · from ${h?.from}  adjust ${fmt(h?.adjust ?? 0)}kcal`);
console.log("");

if (adaptiveOn) {
  console.log("결론: **지금 바꿔도 과거 판정은 하나도 달라지지 않습니다.**");
  console.log("      적응형이 켜져 있어 이력이 이미 그대로 쓰이고 있기 때문입니다.");
  console.log("      이 수정은 '앞으로 토글을 껐을 때 과거가 흔들리지 않게' 하는 예방 성격입니다.");
} else if (history.length === 0) {
  console.log("결론: **바꿔도 달라지는 것이 없습니다.** 적응형 이력이 비어 있습니다.");
} else {
  console.log(`목표 kcal이 달라지는 날 : ${targetChanged}일 / ${recorded.length}일  (최대 변동 ${fmt(maxDelta)}kcal)`);
  console.log(`✓/✗ 판정이 뒤집히는 날  : ${flipped}일   ← 화면에서 눈에 보이는 변화`);
  if (flips.length) {
    console.log("");
    console.log("   판정이 뒤집히는 날 (최대 20건):");
    for (const f of flips.slice(0, 20)) {
      console.log(`   · ${f.ds}  ${f.from} → ${f.to}   섭취 ${f.intake} / 목표 ${f.nowK} → ${f.fixK}`);
    }
    if (flips.length > 20) console.log(`   … 외 ${flips.length - 20}건`);
  }
}
console.log("──────────────────────────────────────────────────────");
console.log("");
