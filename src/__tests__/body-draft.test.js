// 체성분 "완성 대기 초안" — 병합·잠금·LBM 가드 계약 테스트 (골든셋, 앱 계층).
// 스펙: docs/prompts/body-import-api-prompt.md §1.3·§3 (계약 7·8·9·10·13).
// 핵심 불변 조건 — "muscle 미입력 초안이 골격근 통계에 0으로 오염되면 절대 안 됨" — 은
// 구조로 증명한다: 초안은 bodylog 밖(body-drafts)에 살고, 확정(draftToRecord)은 muscle>0
// 없이는 레코드를 만들지 않으며, 병합 모듈은 bodylog를 아예 반환하지 않는다.
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/golden-sample.json";
import { mergeBodyDrafts, draftToRecord, checkSmmLbm, DRAFT_RETENTION_DAYS } from "../bodyDraft.js";
import { bodyMetrics } from "../bodyMetrics.js";
import { estimateTDEE } from "../adaptiveTDEE.js";
import { buildAnalysisPackage } from "../analysisExport.js";

const TODAY = "2026-08-07";
const TS = Date.parse("2026-08-07T08:24:00+09:00");
const E = (over = {}) => ({ key: `2026-08-07|${TS}`, date: "2026-08-07", sampleTs: TS, weight: 73.6, fatPct: 18.7, lbm: 60.5, ...over });
const REC = (date, over = {}) => ({ date, weight: 73.9, muscle: 34.7, fatPct: 18.9, score: 84, ...over });

describe("계약 7·8 — 잠금: 확정된 날짜의 초안·갱신은 병합 계층에서 폐기", () => {
  it("7) 골격근 입력 확정 후 늦은 초안 도착 → 폐기 + ack, 값 불변", () => {
    const log = [REC("2026-08-07", { source: "import", lbm: 60.5 })];
    const r = mergeBodyDrafts({}, log, [E({ sampleTs: TS + 60000, key: `2026-08-07|${TS + 60000}`, weight: 73.4 })], { todayStr: TODAY });
    expect(r.drafts["2026-08-07"]).toBeUndefined();               // 착지 없음
    expect(r.ackKeys).toEqual([`2026-08-07|${TS + 60000}`]);      // 사서함만 비움
  });

  it("8) 수동 선입력한 날 초안 도착 → 같은 잠금으로 폐기 (마커 불필요 — 레코드 존재 = 잠금)", () => {
    const log = [REC("2026-08-07")]; // source 없음 = 수동 입력
    const r = mergeBodyDrafts({}, log, [E()], { todayStr: TODAY });
    expect(r.drafts["2026-08-07"]).toBeUndefined();
    expect(r.ackKeys).toEqual([E().key]);
  });

  it("다중 기기 유령 청소 — 다른 기기가 확정한 날짜의 잔존 초안은 재동기화 스윕에서 제거", () => {
    const drafts = { "2026-08-07": { weight: 73.6, sampleTs: TS } };
    const r = mergeBodyDrafts(drafts, [REC("2026-08-07")], [], { todayStr: TODAY });
    expect(r.drafts["2026-08-07"]).toBeUndefined();
    expect(r.changed).toBe(true);
  });
});

describe("B2 갱신 — 같은 날 더 최신 sampleTs만 초안 값을 갱신(필드별 겹침)", () => {
  it("최신 항목이 weight만 담고 있어도 기존 fatPct·lbm은 유지된다(부분 수신 B8)", () => {
    const drafts = { "2026-08-07": { weight: 73.8, fatPct: 18.7, lbm: 60.5, sampleTs: TS } };
    const r = mergeBodyDrafts(drafts, [], [{ key: `2026-08-07|${TS + 60000}`, date: "2026-08-07", sampleTs: TS + 60000, weight: 73.6 }], { todayStr: TODAY });
    expect(r.drafts["2026-08-07"]).toMatchObject({ weight: 73.6, fatPct: 18.7, lbm: 60.5, sampleTs: TS + 60000 });
  });

  it("더 오래된 항목은 초안을 되돌리지 못하고 ack만 된다(ack 유실 재pull 멱등)", () => {
    const drafts = { "2026-08-07": { weight: 73.6, fatPct: 18.7, sampleTs: TS } };
    const r = mergeBodyDrafts(drafts, [], [{ key: `2026-08-07|${TS - 60000}`, date: "2026-08-07", sampleTs: TS - 60000, weight: 74.2 }], { todayStr: TODAY });
    expect(r.drafts["2026-08-07"]).toMatchObject({ weight: 73.6, sampleTs: TS });
    expect(r.ackKeys).toEqual([`2026-08-07|${TS - 60000}`]);
  });

  it("보존 기한(30일) 밖 — 초안은 스윕, 항목은 착지 없이 ack (무한 적체 방지)", () => {
    const old = "2026-07-01"; // TODAY-30일(=07-08)보다 과거
    const drafts = { [old]: { weight: 73.6, sampleTs: TS } };
    const r = mergeBodyDrafts(drafts, [], [{ key: `${old}|${TS}`, date: old, sampleTs: TS, weight: 73.6 }], { todayStr: TODAY });
    expect(Object.keys(r.drafts)).toHaveLength(0);
    expect(r.ackKeys).toEqual([`${old}|${TS}`]);
    expect(DRAFT_RETENTION_DAYS).toBe(30);
  });

  it("구조적 쓰레기 — 필드 없는 항목은 ack로 정리, key 없는 항목은 건너뜀", () => {
    const r = mergeBodyDrafts({}, [], [
      { key: "2026-08-07|1", date: "2026-08-07", sampleTs: 1 },   // 필드 없음
      { date: "2026-08-07", sampleTs: TS, weight: 73.6 },          // key 없음 — ack 대상 특정 불가
    ], { todayStr: TODAY });
    expect(r.ackKeys).toEqual(["2026-08-07|1"]);
    expect(Object.keys(r.drafts)).toHaveLength(0);
  });
});

describe("계약 9 — 불변 조건: 초안은 골격근 통계의 입력(bodylog)에 존재하지 않는다", () => {
  const bodylog = fixture.data.bodylog;
  const latest = bodylog[bodylog.length - 1];
  const prev = bodylog[bodylog.length - 2];
  const drafts = { "2026-06-29": { weight: 73.6, fatPct: 18.7, lbm: 60.5, sampleTs: TS } };

  it("병합 모듈은 bodylog를 만들지도 반환하지도 않는다(구조 증명)", () => {
    const r = mergeBodyDrafts(drafts, bodylog, [], { todayStr: "2026-07-01" });
    expect(Object.keys(r).sort()).toEqual(["ackKeys", "changed", "drafts"]);
  });

  it("초안 존재 상태에서 골든 파생 지표(bodyMetrics)·TDEE 역산이 골든 고정값 그대로", () => {
    // 초안은 어떤 계산에도 주입되지 않는다 — 골든셋(golden.test.js)과 동일 값으로 재확인
    expect(bodyMetrics(latest, prev, { height: 175, age: 35 })).toMatchObject({ dM: 0.1, bmr: 1699 });
    const bmr = bodyMetrics(latest, prev, { height: 175, age: 35 }).bmr;
    expect(estimateTDEE(bodylog, fixture.data.days, "2026-07-01", bmr, 28)).toMatchObject({ measuredTDEE: 1973, delta: -47 });
    // 골격근 시리즈 입력에 0이 없다 — 초안이 bodylog 밖이므로 구조적으로 성립
    expect(bodylog.every((b) => b.muscle > 0)).toBe(true);
  });

  it("확정(draftToRecord)은 muscle>0 없이는 레코드를 만들지 않는다 — muscle:0 유입 계약 차단", () => {
    const draft = { weight: 73.6, fatPct: 18.7, lbm: 60.5, sampleTs: TS };
    expect(draftToRecord("2026-08-07", draft, "", "85")).toBe(null);
    expect(draftToRecord("2026-08-07", draft, "0", "85")).toBe(null);
    expect(draftToRecord("2026-08-07", draft, "-1", "85")).toBe(null);
    expect(draftToRecord("2026-08-07", { fatPct: 18.7 }, "34.7", "85")).toBe(null); // weight 없는 초안도 확정 불가
  });
});

describe("계약 10 — LBM 오타 가드(경고 전용, 저장 차단 아님)", () => {
  it("muscle 43.7 ÷ lbm 60.5 = 0.72 → 경고 (34.7 오타를 43.7로 친 사고 재현)", () => {
    expect(checkSmmLbm(43.7, 60.5)).toEqual({ ratio: 0.72, warn: true });
  });
  it("정상 비율 34.7/60.5 ≈ 0.57 → 경고 없음 (297일 실측 0.56~0.58 대역)", () => {
    expect(checkSmmLbm(34.7, 60.5)).toEqual({ ratio: 0.57, warn: false });
  });
  it("lbm이 없는 날은 가드 생략", () => {
    expect(checkSmmLbm(34.7, 0)).toEqual({ ratio: null, warn: false });
    expect(checkSmmLbm(NaN, 60.5)).toEqual({ ratio: null, warn: false });
  });
  it("가드는 저장을 막지 않는다 — 경고 비율이어도 확정 레코드는 생성된다", () => {
    const rec = draftToRecord("2026-08-07", { weight: 73.6, fatPct: 18.7, lbm: 60.5, sampleTs: TS }, "43.7", "85");
    expect(rec).toMatchObject({ date: "2026-08-07", weight: 73.6, muscle: 43.7, fatPct: 18.7, score: 85, lbm: 60.5, source: "import" });
  });
});

describe("계약 13 — 공유 링크(analysisExport): 초안 미확정 날은 제외(구조적) — 규칙을 계약으로 고정", () => {
  const state = {
    allDays: {},
    bodyLog: [REC("2026-08-05", { source: "import", lbm: 60.4 })], // 확정 레코드(자동 수신 출신)
    goals: {}, user: { height: 175, age: 35 }, mode: "cut",
    targets: { k: 1609, p: 171, c: 126, f: 47 }, targetsByMode: {}, appAdjust: 0, tdeeHistory: [], healthEvents: [],
  };
  const period = { start: "2026-08-01", end: "2026-08-07" };
  const section = (pkg) => {
    const from = pkg.indexOf("## 체성분 기록");
    const to = pkg.indexOf("##", from + 2);
    return pkg.slice(from, to === -1 ? undefined : to);
  };

  it("확정 레코드만 체성분 섹션에 나가고, 초안만 있는 날(08-06)은 나가지 않는다", () => {
    // 초안(body-drafts)은 buildAnalysisPackage의 입력(state.bodyLog)에 아예 없다 — 그게 규칙이다
    const pkg = buildAnalysisPackage(state, period, TODAY);
    const sec = section(pkg);
    expect(sec).toContain("체성분 기록 (1건)");
    expect(sec).toContain("08-05 73.9kg");
    expect(sec).toContain("골격근 34.7kg");
    expect(sec).not.toContain("08-06");
  });

  it("확정 레코드의 부가 필드(lbm·source)는 직렬화 형식을 바꾸지 않는다(회귀 방지)", () => {
    const plain = { ...state, bodyLog: [REC("2026-08-05")] }; // 부가 필드 없는 수동 레코드
    expect(section(buildAnalysisPackage(state, period, TODAY)))
      .toBe(section(buildAnalysisPackage(plain, period, TODAY)));
  });
});
