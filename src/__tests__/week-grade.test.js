// 주간 등급 산식의 단일 출처 — 2026-08 감사 R-34.
//
// 이 산식(단백질 40 · 칼로리 30 · 운동 30)이 StatsTab 안에 두 벌 복붙돼 있었다.
// 한쪽만 고치면 주간 카드와 8주 트렌드가 서로 다른 등급을 보여주는데, 그 어긋남은
// 두 화면을 나란히 놓기 전까지 보이지 않는다. 경계값을 여기서 고정한다.
import { describe, it, expect } from "vitest";
import { weekGrade } from "../components/StatsTab.jsx";

// n일 중 단백질 p일·칼로리 d일 달성, 운동 e회
const w = (n, pDays, dDays, eDays) => ({ n, pDays, dDays, eDays });

describe("weekGrade — 경계값", () => {
  it("전부 달성(운동 4회 이상)이면 A+", () => {
    expect(weekGrade(w(7, 7, 7, 4)).letter).toBe("A+");
    expect(weekGrade(w(7, 7, 7, 6)).letter).toBe("A+");   // 운동은 4회가 만점 — 더 해도 같다
  });
  it("경계 바로 위/아래에서 등급이 갈린다", () => {
    expect(weekGrade(w(10, 10, 10, 0)).letter).toBe("B+");  // 40+30+0 = 70 → B+ (경계 정확히)
    expect(weekGrade(w(10, 10, 9, 0)).letter).toBe("B");    // 40+27+0 = 67 → B  (경계 아래)
    expect(weekGrade(w(10, 10, 10, 1)).letter).toBe("B+");  // 40+30+7.5 = 77.5 → 아직 B+
    expect(weekGrade(w(10, 10, 10, 2)).letter).toBe("A");   // 40+30+15  = 85   → A
  });
  it("실제 점수 계산이 문서화된 가중치와 일치한다 (P40·C30·운동30)", () => {
    // 단백질만 전부: 40점 → C
    expect(weekGrade(w(7, 7, 0, 0)).letter).toBe("C");
    // 칼로리만 전부: 30점 → D
    expect(weekGrade(w(7, 0, 7, 0)).letter).toBe("D");
    // 운동 4회만: 30점 → D
    expect(weekGrade(w(7, 0, 0, 4)).letter).toBe("D");
    // 운동 2회만: 15점 → F
    expect(weekGrade(w(7, 0, 0, 2)).letter).toBe("F");
  });
  it("기록이 없는 주는 '—' + 호출부가 지정한 색", () => {
    expect(weekGrade(w(0, 0, 0, 0))).toEqual({ letter: "—", color: "#4a4a4a" });
    expect(weekGrade(w(0, 0, 0, 0), "#252525").color).toBe("#252525");
    expect(weekGrade(null).letter).toBe("—");
  });
});
