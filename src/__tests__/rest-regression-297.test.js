// R4 회귀 스냅샷 — dayType이 전혀 없는 합성 297일 데이터의 분석 내보내기 전문(요약본+상세본)이
// 휴식일 프리셋 도입 "이전 커밋(68c55be)"의 출력과 바이트 단위로 동일함을 고정한다.
// 해시는 감사 시점에 이전 커밋 워크트리와 현재 코드 양쪽에서 산출해 일치를 확인한 값.
// 이 테스트가 깨지면: (a) 과거 데이터 판정·집계가 변한 회귀이거나 (b) 내보내기 문서 형식을
// 의도적으로 바꾼 것이다 — (b)라면 이전 커밋 기준 재산출 근거와 함께 해시를 갱신하라.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildAnalysisPackage, resolvePeriod } from "../analysisExport.js";
import { buildSynthState, SYNTH_TODAY } from "./fixtures/synth297.js";

// 2026-08 구조 감사 R-05에서 의도적으로 갱신 (위 주석의 (b) 경로).
//   이전 기준선: 4e5f41243c6898710ece73bdfeac78551e986710eea5890ec1483f181a2bc6e4
//   변경 사유  : '운동 구성(주간)' 표에 **근력 열**을 추가했다. 워치 자동 수신이 근력
//                세션을 "근력 운동" 한 덩어리로 보내는데 부위 키워드가 없어 전부 '기타'로
//                떨어졌고, 그 결과 표가 상체/하체/코어 0%를 출력해 "그 부위를 전혀 안 했다"로
//                읽혔다(거짓 진술).
//   diff 검증  : 이전 커밋 출력과 줄 단위 대조 — 요약본 412→412줄, 상세본 834→834줄로
//                줄 수 불변, 다른 줄 44개(헤더 1 + 주간 행 43)이며 **전부 근력 열 삽입뿐**이다.
//                판정(✓/✗)·유효목표·기존 유산소/상체/하체/코어/기타 % 값은 한 글자도 바뀌지 않았다.
//                (합성 데이터에는 근력 기록이 없어 근력 열은 전부 0이고 각주도 붙지 않는다)
const BASELINE_SHA256 = "fe51f7ce49d5fe3973765d8d333adc6c4f1fd348e8411b553bea5d6e2ebe0bde";

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
