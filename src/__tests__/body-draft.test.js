// 체성분 "완성 대기 초안" — 병합·잠금·LBM 가드 계약 테스트 (골든셋, 앱 계층).
// 스펙: docs/prompts/body-import-api-prompt.md §1.3·§3 (계약 7·8·9·10·13).
// 핵심 불변 조건 — "muscle 미입력 초안이 골격근 통계에 0으로 오염되면 절대 안 됨" — 은
// 구조로 증명한다: 초안은 bodylog 밖(body-drafts)에 살고, 확정(draftToRecord)은 muscle>0
// 없이는 레코드를 만들지 않으며, 병합 모듈은 bodylog를 아예 반환하지 않는다.
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/golden-sample.json";
import { mergeBodyDrafts, draftToRecord, checkSmmLbm, DRAFT_RETENTION_DAYS, lastMeasuredDate } from "../bodyDraft.js";
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

  // 계약 변경 (2026-08 감사 R-04): 예전에는 "부가 필드가 출력 형식을 바꾸지 않는다"가 계약이었다.
  // 그 결과 분석 계약이 자동 측정과 손입력을 구분할 근거를 전혀 갖지 못했고(백업은 무손실인데
  // 분석만 전손), 다음 시즌 분석이 조용히 틀릴 수 있었다. 이제 **출처는 반드시 드러난다**.
  it("유입 출처가 체성분 섹션에 드러난다 (자동확정/자동수신/손입력 구분)", () => {
    const line = (pkg) => section(pkg).split("\n")[1];
    const auto = { ...state, bodyLog: [{ ...REC("2026-08-05"), source: "import", auto: true }] };
    const received = { ...state, bodyLog: [{ ...REC("2026-08-05"), source: "import" }] };
    const manual = { ...state, bodyLog: [REC("2026-08-05")] };
    expect(line(buildAnalysisPackage(auto, period, TODAY))).toContain("[자동확정]");
    expect(line(buildAnalysisPackage(received, period, TODAY))).toContain("[자동수신]");
    // 손입력은 표기 없음 — 자동 유입 이전 데이터의 출력이 그대로 유지된다
    expect(line(buildAnalysisPackage(manual, period, TODAY))).not.toContain("[");
  });

  it("측정 시각(sampleTs)이 병기되고, 실행 환경 타임존에 흔들리지 않는다", () => {
    const withTs = {
      ...state,
      bodyLog: [{ ...REC("2026-08-05"), source: "import", auto: true, sampleTs: Date.parse("2026-08-05T21:40:00+09:00") }],
    };
    // 유입이 쓴 고정 오프셋(+09:00) 기준 벽시계 — 브라우저든 서버리스(UTC)든 같은 값이어야 한다
    expect(section(buildAnalysisPackage(withTs, period, TODAY))).toContain("08-05 21:40 73.9kg");
    // 시각이 없는 옛 레코드는 표기도 없다
    expect(section(buildAnalysisPackage({ ...state, bodyLog: [REC("2026-08-05")] }, period, TODAY)))
      .toContain("08-05 73.9kg");
  });

  it("자동 수신 레코드가 있으면 측정 규칙 줄이 문서에 실린다 (시즌 간 규칙 차이 전달)", () => {
    const auto = { ...state, bodyLog: [{ ...REC("2026-08-05"), source: "import", auto: true }] };
    const pkg = buildAnalysisPackage(auto, period, TODAY);
    expect(pkg).toContain("체성분 측정 규칙(2026-08-08~)");
    expect(pkg).toContain("마지막 측정이 그 날 값");
    // 손입력만 있던 기간에는 붙지 않는다
    expect(buildAnalysisPackage({ ...state, bodyLog: [REC("2026-08-05")] }, period, TODAY))
      .not.toContain("체성분 측정 규칙");
  });
});

/* 버린 초안이 되살아나지 않는다 — 2026-08 감사 R-27.
   폐기해도 그 항목의 ack가 실패하면 사서함에 남아 다음 pull에서 다시 내려왔고,
   잠글 확정 레코드가 없으니 그대로 재착지했다. */
describe("R-27 — 폐기한 측정의 재착지 차단", () => {
  const E = (date, ts, extra = {}) => ({ key: `${date}|${ts}|cloud`, date, sampleTs: ts, weight: 75, ...extra });

  it("버린 측정은 다시 내려와도 착지하지 않고 ack만 된다", () => {
    const r = mergeBodyDrafts({}, [], [E("2026-08-09", 100)], {
      todayStr: "2026-08-09", discarded: new Set(["2026-08-09|100"]),
    });
    expect(r.drafts["2026-08-09"]).toBeUndefined();
    expect(r.ackKeys).toEqual(["2026-08-09|100|cloud"]);
  });

  it("같은 날 다시 재면(새 sampleTs) 정상적으로 들어온다 — 날짜가 아니라 측정 단위로 기억", () => {
    const r = mergeBodyDrafts({}, [], [E("2026-08-09", 200)], {
      todayStr: "2026-08-09", discarded: new Set(["2026-08-09|100"]),
    });
    expect(r.drafts["2026-08-09"].sampleTs).toBe(200);
  });

  it("폐기 목록이 없으면 기존과 똑같이 동작", () => {
    const r = mergeBodyDrafts({}, [], [E("2026-08-09", 100)], { todayStr: "2026-08-09" });
    expect(r.drafts["2026-08-09"].weight).toBe(75);
  });
});

/* "마지막으로 몸을 잰 날"에 미확정 초안도 포함 — 감사 R-21.
   옛 동작은 bodyLog(확정분)만 봤다. LBM 가드 보류나 클라우드 장애로 초안만 쌓이면
   사용자는 매일 쟀는데도 "체중을 재세요" 독촉을 계속 받았다 — 자동화가 고장난 바로 그때
   유일하게 받는 신호가 틀린 메시지였다. */
describe("lastMeasuredDate — 확정분과 초안 중 최신 (R-21)", () => {
  const log = [{ date: "2026-08-01", weight: 75.1 }, { date: "2026-08-03", weight: 75.0 }];

  it("초안이 더 최근이면 초안 날짜를 쓴다", () => {
    expect(lastMeasuredDate(log, { "2026-08-07": { weight: 74.8 } })).toBe("2026-08-07");
  });
  it("확정분이 더 최근이면 확정분 날짜를 쓴다", () => {
    expect(lastMeasuredDate(log, { "2026-07-20": { weight: 76.0 } })).toBe("2026-08-03");
  });
  it("초안이 없으면 기존 동작과 같다", () => {
    expect(lastMeasuredDate(log, {})).toBe("2026-08-03");
    expect(lastMeasuredDate(log, null)).toBe("2026-08-03");
  });
  it("둘 다 없으면 null — '잰 적 없음'은 그대로 유지", () => {
    expect(lastMeasuredDate([], {})).toBe(null);
    expect(lastMeasuredDate(null, null)).toBe(null);
  });
  it("값이 하나도 없는 빈 초안은 '쟀다'로 치지 않는다", () => {
    expect(lastMeasuredDate(log, { "2026-08-09": {} })).toBe("2026-08-03");
    expect(lastMeasuredDate(log, { "2026-08-09": { sampleTs: 123 } })).toBe("2026-08-03");
  });
  it("체중이 없어도 근육량·체지방률만 있으면 잰 것으로 본다 (부분 수신)", () => {
    expect(lastMeasuredDate(log, { "2026-08-09": { muscle: 39.2 } })).toBe("2026-08-09");
    expect(lastMeasuredDate(log, { "2026-08-10": { fatPct: 18.4 } })).toBe("2026-08-10");
  });
});
