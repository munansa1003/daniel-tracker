// @vitest-environment happy-dom
// 운동 스트릭이 휴식일 도장을 본다 — 2026-08 감사 R-20.
//
// 쉬기로 도장을 찍은 날은 계획의 일부지 실패가 아니다. 옛 동작은 그 날을 "끊김"으로 세서
// 계획대로 쉰 사용자에게 "안 하면 🔥N일 끊김" 경고를 띄웠다 — 도장 기능의 의미와 정면으로
// 어긋난다. 여기서 고정하는 계약:
//   ① 휴식일은 연속을 **잇는다**(끊지 않는다)
//   ② 휴식일이 스스로 운동일로 세어지지는 않는다(숫자를 부풀리지 않는다)
//   ③ 오늘이 휴식일이면 독촉 대신 "연속 유지" 안내가 뜬다
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { WorkoutStamp } from "../components/WorkoutStamp.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ex = () => ({ meals: [], exercises: [{ n: "조깅", duration: 30, m: 7, kcal: 260 }] });
const rest = () => ({ meals: [], exercises: [], dayType: "rest" });
const empty = () => ({ meals: [], exercises: [] });

async function show(allDays, date, todayStr = date) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  await act(async () => {
    createRoot(div).render(
      <WorkoutStamp date={date} exercises={allDays[date]?.exercises || []} exTotal={0} allDays={allDays} todayStr={todayStr} />
    );
  });
  return div.textContent;
}
const streakOf = (text) => Number(/🔥\s*(\d+)일/.exec(text)?.[1]);

describe("스트릭 — 휴식일 도장 (R-20)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("휴식일이 사이에 끼어도 연속이 끊기지 않는다", async () => {
    const allDays = {
      "2026-08-04": ex(), "2026-08-05": ex(), "2026-08-06": rest(),
      "2026-08-07": ex(), "2026-08-08": ex(),
    };
    // 실제로 운동한 날은 4일 — 휴식일은 이어주기만 하고 스스로 세어지지 않는다
    expect(streakOf(await show(allDays, "2026-08-08"))).toBe(4);
  });

  it("휴식일은 스스로 스트릭을 올리지 않는다 (도장만 찍고 쉬어도 숫자는 그대로)", async () => {
    expect(streakOf(await show({ "2026-08-07": ex(), "2026-08-08": rest() }, "2026-08-08"))).toBe(1);
  });

  it("도장 없이 그냥 빈 날이면 예전처럼 끊긴다 (완화가 아니라 도장에만 주는 예외)", async () => {
    const allDays = { "2026-08-05": ex(), "2026-08-06": empty(), "2026-08-07": ex() };
    expect(streakOf(await show(allDays, "2026-08-07"))).toBe(1);
  });

  it("오늘이 휴식일이면 '끊김' 독촉 대신 유지 안내가 뜬다", async () => {
    const text = await show({ "2026-08-06": ex(), "2026-08-07": ex(), "2026-08-08": rest() }, "2026-08-08");
    expect(text).toContain("휴식일");
    expect(text).not.toContain("끊김");
  });

  it("오늘이 그냥 미기록이면 기존 독촉은 그대로 뜬다", async () => {
    const text = await show({ "2026-08-06": ex(), "2026-08-07": ex(), "2026-08-08": empty() }, "2026-08-08");
    expect(text).toContain("끊김");
  });

  it("휴식일에도 운동이 기록돼 있으면 그냥 운동일이다 (도장은 있어도 실제로 했다)", async () => {
    const allDays = { "2026-08-07": ex(), "2026-08-08": { ...rest(), exercises: ex().exercises } };
    expect(streakOf(await show(allDays, "2026-08-08"))).toBe(2);
  });
});
