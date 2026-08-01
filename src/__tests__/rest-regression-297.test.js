// R4 회귀 스냅샷 — dayType이 전혀 없는 합성 297일 데이터의 분석 내보내기 전문(요약본+상세본)이
// 휴식일 프리셋 도입 "이전 커밋(68c55be)"의 출력과 바이트 단위로 동일함을 고정한다.
// 해시는 감사 시점에 이전 커밋 워크트리와 현재 코드 양쪽에서 산출해 일치를 확인한 값.
// 이 테스트가 깨지면: (a) 과거 데이터 판정·집계가 변한 회귀이거나 (b) 내보내기 문서 형식을
// 의도적으로 바꾼 것이다 — (b)라면 이전 커밋 기준 재산출 근거와 함께 해시를 갱신하라.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildAnalysisPackage, resolvePeriod } from "../analysisExport.js";
import { buildSynthState, SYNTH_TODAY } from "./fixtures/synth297.js";

const BASELINE_SHA256 = "4e5f41243c6898710ece73bdfeac78551e986710eea5890ec1483f181a2bc6e4";

describe("R4 — 과거 데이터(도장 없음) 회귀 스냅샷", () => {
  it("합성 297일 내보내기(요약+상세)가 기능 도입 전 커밋과 동일 (diff = 0)", () => {
    const state = buildSynthState();
    const range = resolvePeriod("all", SYNTH_TODAY, state.allDays);
    const summary = buildAnalysisPackage(state, range, SYNTH_TODAY);
    const detail = buildAnalysisPackage(state, range, SYNTH_TODAY, { detail: true });
    const hash = createHash("sha256").update(summary + "\n===DETAIL===\n" + detail).digest("hex");
    expect(hash).toBe(BASELINE_SHA256);
  });
  it("합성 데이터에 dayType이 하나도 없다 (전제 검증)", () => {
    const { allDays } = buildSynthState();
    expect(Object.values(allDays).every((d) => !("dayType" in d))).toBe(true);
    expect(Object.keys(allDays).length).toBeGreaterThan(250);
  });
});
