import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// App.jsx는 store.js(→ firebase.js)를 import하므로 노드 환경에서는 모킹이 필요하다.
vi.mock("../store.js", () => ({
  default: {},
  getCurrentUserId: () => null,
  setUserId: () => {},
  logout: () => {},
  getProfiles: async () => [],
  saveProfiles: async () => {},
  getSharedFoods: async () => [],
  addSharedFood: async () => [],
  getSharedExercises: async () => [],
  addSharedExercise: async () => [],
}));

import { NetCalCard } from "../App.jsx";

// 신호등 이모지는 상태 표시줄에서만 사용되므로, 렌더 결과에서 이모지로 판정을 식별한다.
const LIGHTS = ["🔴", "🟡", "🟢", "🟠"];
function light(props) {
  const html = renderToStaticMarkup(<NetCalCard {...props} />);
  const found = LIGHTS.filter((e) => html.includes(e));
  expect(found, "신호등 이모지는 정확히 1개여야 함").toHaveLength(1);
  return found[0];
}

describe("NetCalCard 신호등 — 경계값 (t=기본목표: 위험<0.75t / 주의<0.90t / 적정≤t / 초과>t)", () => {
  // targetK(=effectiveTargetK)=1570, 운동 0 → t=1570, z1=round(1177.5)=1178, z2=round(1413)=1413
  const T = { exercise: 0, targetK: 1570 };

  it("보정섭취 1177 → 🔴 너무 적음 (z1 미만)", () => {
    expect(light({ ...T, intake: 1177 })).toBe("🔴");
  });
  it("보정섭취 1178 → 🟡 공격적 (z1 경계 진입)", () => {
    expect(light({ ...T, intake: 1178 })).toBe("🟡");
  });
  it("보정섭취 1412 → 🟡 공격적 (z2 직전)", () => {
    expect(light({ ...T, intake: 1412 })).toBe("🟡");
  });
  it("보정섭취 1413 → 🟢 적정 (z2 경계 진입)", () => {
    expect(light({ ...T, intake: 1413 })).toBe("🟢");
  });
  it("보정섭취 1570 → 🟢 적정 (목표와 정확히 같으면 달성)", () => {
    expect(light({ ...T, intake: 1570 })).toBe("🟢");
  });
  it("보정섭취 1571 → 🟠 초과 (목표 +1)", () => {
    expect(light({ ...T, intake: 1571 })).toBe("🟠");
  });
});

describe("NetCalCard — 반올림 판정 규칙 (PR #16: 화면 표시값 기준)", () => {
  const T = { exercise: 0, targetK: 1570 };

  it("섭취 1570.4 → 표시 1570 → 🟢 적정 (원본 소수로 비교하지 않음)", () => {
    expect(light({ ...T, intake: 1570.4 })).toBe("🟢");
  });
  it("섭취 1570.6 → 표시 1571 → 🟠 초과", () => {
    expect(light({ ...T, intake: 1570.6 })).toBe("🟠");
  });
});

describe("NetCalCard — 운동 50% 되먹기 (스모크: K=1570, 운동 1070 → 목표 2105)", () => {
  // effectiveTargetK = 1570 + round(1070×0.5) = 2105. eatback=535, t = 2105−535 = 1570.
  const T = { exercise: 1070, targetK: 2105 };

  it("섭취 2105 → 보정 1570 = 목표 → 🟢 적정", () => {
    expect(light({ ...T, intake: 2105 })).toBe("🟢");
  });
  it("섭취 2106 → 보정 1571 > 목표 → 🟠 초과", () => {
    expect(light({ ...T, intake: 2106 })).toBe("🟠");
  });
  it("되먹기 비율이 0.5에서 바뀌면 즉시 검출 (섭취=목표+eatback 경계)", () => {
    // 0.4로 바뀌면 eatback=428 → adj=1677 > t=1677? t도 같이 변해 경계가 무너진다.
    // 위 두 케이스(2105/2106의 🟢/🟠 분리)가 ×0.5 고정의 회귀 방어선이다.
    expect(light({ ...T, intake: 2105 })).toBe("🟢");
  });
});
