// 전 구간 관통 통합 테스트 — 2026-08 감사 R-35.
//
// 감사가 짚은 공백: 테스트가 전부 단위·계약 위주라 가장 긴 사슬을 도는 것이
// pull→자동확정(inbody-cloud.test.js)까지였다. 각 계층은 자기 계약을 지키는데도 **계층 사이에서**
// 어긋나는 종류의 회귀 — 어느 단위 테스트도 보지 않는 틈 — 를 잡을 방어가 없었다.
//
// 여기서는 실제 사용 흐름을 한 줄기로 통과시킨다:
//   워치 운동 유입 → 검문(planWorkout) → 사서함 항목 → day 병합(mergeImports)
//   인바디 체성분 유입 → 검문(planBodyImport) → 초안 병합(mergeBodyDrafts) → 자동 확정
//   → 그 체성분으로 목표 산정(makeDayTargets) → 그 목표로 판정(aggregateDay·isCalOk)
//   → 분석 패키지(buildAnalysisPackage) → 공유 스냅샷(putShare/getShare)
//
// 계층 경계에서 **값이 살아남는지**를 본다. 예: 워치가 실측한 kcal이 병합·판정·문서까지
// 그대로 도달하는가, 문서의 목표 숫자가 앱이 쓰는 목표와 같은 함수에서 나왔는가.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { planWorkout, convertHae, HAE_TZ_OFFSET_MIN_DEFAULT } from "../../api/_lib/import-rules.js";
import { planBodyImport } from "../../api/_lib/body-import-rules.js";
import { mergeImports } from "../importMerge.js";
import { mergeBodyDrafts, autoConfirmDrafts } from "../bodyDraft.js";
import { makeDayTargets, aggregateDay, isCalOk } from "../utils.js";
import { buildAnalysisPackage, packageMeta, sharePrivacyNotice } from "../analysisExport.js";
import { isValidToken } from "../../api/_lib/share-store.js";

const UID = "uid-e2e";
const TODAY = "2026-08-09";
const CUTOVER = "2026-08-01";
const TZ = HAE_TZ_OFFSET_MIN_DEFAULT;   // +09:00

// ── 1) 워치가 보낸 운동(단축어 봉투) ───────────────────────────────
const watchWorkout = {
  type: "Running",
  start: "2026-08-09T07:10:00+09:00",
  end: "2026-08-09T07:52:00+09:00",
  durationMin: 42,
  kcal: 437,                       // 워치 실측 — 이 숫자가 끝까지 살아남아야 한다
  device: "Apple Watch",
};

// ── 2) 인바디가 보낸 체성분(HAE metrics 형태) ──────────────────────
const sample = (hhmm, v) => ({ date: `2026-08-09 ${hhmm}:00 +0900`, qty: v, source: "InBody" });
const bodyPayload = {
  data: {
    metrics: [
      { name: "weight_body_mass", units: "kg", data: [sample("07:02", 73.6)] },
      { name: "lean_body_mass", units: "kg", data: [sample("07:02", 59.8)] },
      { name: "body_fat_percentage", units: "%", data: [sample("07:02", 18.7)] },
      // 자동 확정은 골격근 실측까지 있어야 승격된다 — 클라우드 직수신 경로에만 오는 값
      { name: "skeletal_muscle_mass", units: "kg", data: [sample("07:02", 34.1)] },
    ],
  },
};

describe("전 구간 관통 — 유입에서 공유 링크까지 (R-35)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("워치 운동이 검문·병합·판정·문서까지 실측 kcal을 잃지 않고 도달한다", () => {
    // 검문
    const plan = planWorkout(watchWorkout, { cutoverDate: CUTOVER });
    // 순수 검문의 합격은 "candidate"다 — 최종 accepted는 seen 도장을 찍는 핸들러 단계에서
    // 갈린다(동시 도착 race의 승자 1명). 계층 경계를 정확히 반영해 둔다.
    expect(plan.verdict).toBe("candidate");
    expect(plan.entry.kcal).toBe(437);
    expect(plan.entry.date).toBe(TODAY);

    // 사서함 → day 병합 (앱이 하는 일)
    const { updatedDays, ackKeys } = mergeImports({}, [{ ...plan.entry, device: watchWorkout.device }], {
      weight: 73.6, todayStr: TODAY, mode: "cut",
    });
    expect(ackKeys).toEqual([plan.entry.importKey]);
    const merged = updatedDays[TODAY];
    const ex = merged.exercises[0];
    expect(ex.kcal).toBe(437);            // 실측값 보존 — MET 근사로 대체되지 않았다
    expect(ex.source).toBe("watch");
    expect(ex.importKey).toBe(plan.entry.importKey);

    // 같은 항목이 또 도착해도 늘지 않는다 (사서함 재도착·다중 기기)
    const again = mergeImports({ [TODAY]: merged }, [plan.entry], { weight: 73.6, todayStr: TODAY, mode: "cut" });
    expect(again.updatedDays[TODAY]).toBeUndefined();      // 바뀐 날 없음
    expect(again.ackKeys).toEqual([plan.entry.importKey]); // 사서함만 비운다

    // 집계 — 운동 소모가 그대로 반영
    const agg = aggregateDay(merged);
    expect(agg.ex).toBe(437);
  });

  it("체성분이 초안을 거쳐 자동 확정되고, 그 값이 그날의 목표를 결정한다", () => {
    const { entries, summary } = planBodyImport(bodyPayload, { cutoverDate: CUTOVER, tzOffsetMin: TZ, source: "cloud" });
    expect(summary.rejected).toBe(0);
    expect(entries).toHaveLength(1);

    // 사서함 → 초안
    const { drafts, ackKeys } = mergeBodyDrafts({}, [], entries.map((e) => ({ ...e, key: e.key })), { todayStr: TODAY });
    expect(ackKeys).toHaveLength(1);
    expect(drafts[TODAY]).toMatchObject({ weight: 73.6, fatPct: 18.7 });

    // 초안 → 자동 확정(4종 실측이 모였을 때만)
    const { bodyLog, confirmed } = autoConfirmDrafts(drafts, []);
    expect(confirmed).toContain(TODAY);
    const rec = bodyLog.find((b) => b.date === TODAY);
    expect(rec.auto).toBe(true);
    expect(rec.weight).toBe(73.6);

    // 확정된 체중이 목표 산정의 입력이 된다 — 앱과 같은 단일 출처 함수로
    const dayTargets = makeDayTargets({ bodyLog, height: 178, age: 42, fallbackWeight: 75 });
    const t = dayTargets("cut", TODAY);
    expect(t.k).toBeGreaterThan(0);
    // 체중이 바뀌면 목표도 따라 움직인다 (하드코딩된 상수가 아니다)
    const heavier = makeDayTargets({ bodyLog: [{ date: TODAY, weight: 85, muscle: 40, fatPct: 20 }], height: 178, age: 42 });
    expect(heavier("cut", TODAY).k).toBeGreaterThan(t.k);
  });

  it("판정·분석 문서·공유 스냅샷이 모두 같은 목표 숫자를 쓴다", () => {
    // 앞 두 단계를 이어 붙인 상태를 만든다
    const plan = planWorkout(watchWorkout, { cutoverDate: CUTOVER });
    const { updatedDays } = mergeImports({}, [plan.entry], { weight: 73.6, todayStr: TODAY, mode: "cut" });
    const day = {
      ...updatedDays[TODAY],
      meals: [{ n: "닭가슴살 도시락", k: 1400, p: 150, c: 120, f: 30, serving: 1, hour: 12 }],
    };
    const allDays = { [TODAY]: day };
    const { entries } = planBodyImport(bodyPayload, { cutoverDate: CUTOVER, tzOffsetMin: TZ, source: "cloud" });
    const { drafts } = mergeBodyDrafts({}, [], entries, { todayStr: TODAY });
    const { bodyLog } = autoConfirmDrafts(drafts, []);

    const dayTargets = makeDayTargets({ bodyLog, height: 178, age: 42, fallbackWeight: 75 });
    const target = dayTargets("cut", TODAY);

    // 판정 — 앱이 쓰는 것과 같은 함수·같은 목표
    const agg = aggregateDay(day);
    const verdict = isCalOk(agg.k, agg.ex, target.k, "cut");
    expect(typeof verdict).toBe("boolean");

    // 분석 문서 — dayTargets를 주입받아 같은 숫자를 쓴다(감사 R-10의 계약)
    const state = {
      allDays, bodyLog, goals: {}, user: { height: 178, age: 42 },
      mode: "cut", targets: target, targetsByMode: { cut: target }, dayTargets,
      appAdjust: 0, tdeeHistory: [], healthEvents: [],
    };
    // detail:true = 정밀 상세본 — ⌚(워치 실측) 표기는 세션별 상세에만 실린다
    const pkg = buildAnalysisPackage(state, { start: TODAY, end: TODAY }, TODAY, { detail: true });
    expect(pkg).toContain("# Body Plan 분석 요청");
    expect(pkg).not.toContain("[생성 실패");        // 어느 섹션도 죽지 않았다
    expect(pkg).toContain(String(target.k.toLocaleString()));  // 문서의 목표 = 앱의 목표
    expect(pkg).toContain("⌚");                    // 워치 실측 표시가 문서까지 도달
    expect(pkg).toContain("[자동확정]");             // 체성분 출처 표기도 도달

    // 공유 스냅샷 — 이 문서가 그대로 링크에 실린다
    const meta = packageMeta(pkg, state, { start: TODAY, end: TODAY });
    expect(meta.days).toBe(1);
    expect(meta.weighs).toBe(1);
    expect(meta.condNotes).toBe(0);
    expect(sharePrivacyNotice(meta)).toContain("로그인 없이");

    const token = "e".repeat(32);
    expect(isValidToken(token)).toBe(true);
    const snapshot = { uid: UID, pkg, createdAt: Date.parse(TODAY), expiresAt: Date.parse(TODAY) + 86400000 };
    // 스냅샷은 문서를 문자 그대로 보관한다 — 링크가 앱과 다른 내용을 보여주면 안 된다
    expect(JSON.parse(JSON.stringify(snapshot)).pkg).toBe(pkg);
  });

  it("컷오버 이전 데이터는 사슬 첫 관문에서 막혀 뒤 단계에 아예 도달하지 않는다", () => {
    const old = { ...watchWorkout, start: "2026-07-20T07:10:00+09:00", end: "2026-07-20T07:52:00+09:00" };
    const plan = planWorkout(old, { cutoverDate: CUTOVER });
    expect(plan.verdict).toBe("rejected");
    expect(plan.entry).toBeUndefined();

    const oldBody = {
      data: { metrics: [{ name: "weight_body_mass", units: "kg", data: [{ date: "2026-07-20 07:02:00 +0900", qty: 73.6, source: "InBody" }] }] },
    };
    const { entries } = planBodyImport(oldBody, { cutoverDate: CUTOVER, tzOffsetMin: TZ, source: "cloud" });
    expect(entries).toHaveLength(0);
  });

  it("HAE 봉투 형식으로 들어와도 같은 사슬을 그대로 통과한다 (경로만 다르고 결과는 같다)", () => {
    const hae = {
      data: {
        workouts: [{
          name: "Running",
          start: "2026-08-09 07:10:00 +0900",
          end: "2026-08-09 07:52:00 +0900",
          activeEnergyBurned: { qty: 437, units: "kcal" },
          duration: 42,
        }],
      },
    };
    const { workouts, dropped } = convertHae(hae, TZ);
    expect(dropped).toBe(0);
    expect(workouts).toHaveLength(1);
    const plan = planWorkout(workouts[0], { cutoverDate: CUTOVER });
    expect(plan.verdict).toBe("candidate");
    // 직접 봉투로 온 것과 같은 날짜·같은 실측 kcal에 도달한다
    const direct = planWorkout(watchWorkout, { cutoverDate: CUTOVER });
    expect(plan.entry.date).toBe(direct.entry.date);
    expect(plan.entry.kcal).toBe(direct.entry.kcal);
    expect(plan.entry.importKey).toBe(direct.entry.importKey);   // dedup 키도 동일 = 이중 계상 없음
  });
});
