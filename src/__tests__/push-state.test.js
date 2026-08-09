// 크론 스냅샷의 단조 병합 — 2026-08 감사 R-44.
//
// 서버는 Firestore 자격증명을 갖지 않으므로(의도된 보안 태세) 크론은 앱이 올려둔 KV 스냅샷으로
// 판단한다. 그 스냅샷을 통째로 덮어쓰던 옛 동작에서는 기기가 둘일 때 날짜가 과거로 되돌아갔다:
// 폰A에서 오늘 기록 → 며칠 만에 켠 폰B가 옛 스냅샷을 올림 → 그날 밤 "오늘 기록하세요" 푸시.
// "마지막 ○○한 날"은 전부 단조 증가 값이므로 필드별 최댓값을 취한다.
import { describe, it, expect } from "vitest";
import { mergePushState } from "../../api/_lib/push-state.js";

const snap = (o = {}) => ({
  lastRecordDate: null, lastWeighDate: null, lastBackup: null,
  accountCreatedAt: null, weekReport: null, reminders: {}, ...o,
});

describe("mergePushState — 오래된 기기가 날짜를 되돌리지 못한다 (R-44)", () => {
  it("옛 스냅샷이 나중에 와도 날짜는 뒤로 가지 않는다", () => {
    const fresh = snap({ lastRecordDate: "2026-08-09", lastWeighDate: "2026-08-09", lastBackup: "2026-08-08" });
    const stale = snap({ lastRecordDate: "2026-08-03", lastWeighDate: "2026-08-02", lastBackup: "2026-08-01" });
    const m = mergePushState(fresh, stale);
    expect(m.lastRecordDate).toBe("2026-08-09");
    expect(m.lastWeighDate).toBe("2026-08-09");
    expect(m.lastBackup).toBe("2026-08-08");
  });

  it("새 스냅샷이 실제로 더 최신이면 당연히 앞으로 간다 (정상 경로를 막지 않는다)", () => {
    const prev = snap({ lastRecordDate: "2026-08-03" });
    const next = snap({ lastRecordDate: "2026-08-09" });
    expect(mergePushState(prev, next).lastRecordDate).toBe("2026-08-09");
  });

  it("필드별로 독립 — 한쪽만 최신이어도 각자 최댓값을 남긴다", () => {
    const prev = snap({ lastRecordDate: "2026-08-09", lastWeighDate: "2026-08-01" });
    const next = snap({ lastRecordDate: "2026-08-02", lastWeighDate: "2026-08-08" });
    const m = mergePushState(prev, next);
    expect(m.lastRecordDate).toBe("2026-08-09");
    expect(m.lastWeighDate).toBe("2026-08-08");
  });

  it("null은 값을 지우지 않는다 (기기가 아직 모르는 것뿐)", () => {
    const prev = snap({ lastRecordDate: "2026-08-09", lastBackup: "2026-08-05" });
    const m = mergePushState(prev, snap({ lastRecordDate: "2026-08-09" }));
    expect(m.lastBackup).toBe("2026-08-05");
  });

  it("계정 생성일은 한 번 알아낸 값을 유지 — 새 기기에서 비어 와도 백업 리마인더가 꺼지지 않게", () => {
    const prev = snap({ accountCreatedAt: "2026-01-15" });
    expect(mergePushState(prev, snap({ accountCreatedAt: null })).accountCreatedAt).toBe("2026-01-15");
    // 아직 모르던 상태라면 새로 들어온 값을 받는다
    expect(mergePushState(snap(), snap({ accountCreatedAt: "2026-02-01" })).accountCreatedAt).toBe("2026-02-01");
  });

  it("주간 성적표는 더 나중 주차의 것을 남긴다", () => {
    const prev = snap({ weekReport: { weekStart: "2026-08-03", recorded: 7 } });
    const next = snap({ weekReport: { weekStart: "2026-07-27", recorded: 2 } });
    expect(mergePushState(prev, next).weekReport.weekStart).toBe("2026-08-03");
    expect(mergePushState(next, prev).weekReport.weekStart).toBe("2026-08-03");
  });

  it("알림 토글은 방금 바꾼 값이 이긴다 (날짜가 아니라 설정이다)", () => {
    const prev = snap({ reminders: { record: true, weigh: true } });
    const next = snap({ reminders: { record: false } });
    expect(mergePushState(prev, next).reminders).toEqual({ record: false });
  });

  it("이전 값이 없거나 깨져 있어도 이번 것으로 정상 구성된다", () => {
    const next = snap({ lastRecordDate: "2026-08-09" });
    expect(mergePushState(null, next).lastRecordDate).toBe("2026-08-09");
    expect(mergePushState("깨진 값", next).lastRecordDate).toBe("2026-08-09");
    expect(mergePushState(undefined, undefined).lastRecordDate).toBe(null);
  });
});
