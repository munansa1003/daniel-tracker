// @vitest-environment happy-dom
// 체성분 기록 삭제 경로 — 실제 클릭으로 배선을 검증한다(정적 마크업으로는 수정 폼이 안 열림).
//
// 배경: 삭제는 원래 "행을 400ms 꾹 누르기 → 액션바"에만 있었다. 그런데 짧은 탭은 곧바로
// 수정 폼을 열기 때문에, 탭으로 수정에 도달한 사용자는 삭제를 영영 만나지 못했다(실사용 신고).
// 식사(EditMealForm)·운동(EditExForm) 수정 폼에는 삭제가 있는데 체성분만 없던 비일관도 있었다.
// 그래서 수정 폼에 삭제를 넣었고, 여기서 그 경로와 인덱스 매핑을 고정한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../store.js", () => ({
  default: { getLocalAll: () => ({}), get: async () => null, set: async () => {}, getAllData: async () => ({}), flushPendingSync: async () => 0 },
  getCurrentUserId: () => "uid-1",
  listProgressPhotos: async () => [],
  saveProgressPhoto: async () => ({}),
  deleteProgressPhoto: async () => {},
}));

import { BodyTab } from "../components/BodyTab.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// bodyLog는 오름차순, 화면은 최신순(slice(-N).reverse()) — 표시 0번 = 배열 마지막.
const LOG = [
  { date: "2026-07-01", weight: 78.0, muscle: 39.1, fatPct: 21.6, score: 86 },
  { date: "2026-07-05", weight: 77.9, muscle: 39.2, fatPct: 21.5, score: 88 },
];

async function mount(extra = {}) {
  const onDeleteBody = vi.fn();
  const onDiscardDraft = vi.fn();
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(<BodyTab bodyLog={LOG} addBody={() => {}} date="2026-07-05" onEditBody={() => {}}
      onDeleteBody={onDeleteBody} onDiscardDraft={onDiscardDraft} user={{ height: 175, age: 35 }}
      goals={{ mode: "cut" }} onSaveGoals={() => {}} allDays={{}} {...extra} />);
  });
  return { div, root, onDeleteBody, onDiscardDraft };
}

const btn = (div, label) => [...div.querySelectorAll("button")].find((b) => b.textContent === label);
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };

describe("체성분 기록 삭제 (수정 폼 경로)", () => {
  beforeEach(() => { document.body.innerHTML = ""; globalThis.confirm = vi.fn(() => true); });

  it("히스토리 행을 탭하면 수정 폼이 열리고 그 안에 삭제 버튼이 있다", async () => {
    const { div, root } = await mount();
    expect(btn(div, "삭제"), "폼 열기 전에는 삭제 버튼 없음").toBeFalsy();
    await click(div.querySelectorAll(".dbp-lp-item")[0]);
    expect(div.textContent).toContain("2026-07-05 수정");
    expect(btn(div, "삭제"), "수정 폼의 삭제 버튼").toBeTruthy();
    await act(async () => { root.unmount(); });
  });

  it("삭제 → 표시 인덱스가 실제 bodyLog 인덱스로 변환되어 전달된다", async () => {
    const { div, root, onDeleteBody } = await mount();
    await click(div.querySelectorAll(".dbp-lp-item")[0]); // 최신(2026-07-05) = bodyLog[1]
    await click(btn(div, "삭제"));
    expect(onDeleteBody).toHaveBeenCalledWith(1);
    await act(async () => { root.unmount(); });
  });

  it("과거 기록도 올바른 인덱스로 삭제된다(역순 매핑 회귀 방어)", async () => {
    const { div, root, onDeleteBody } = await mount();
    await click(div.querySelectorAll(".dbp-lp-item")[1]); // 2026-07-01 = bodyLog[0]
    await click(btn(div, "삭제"));
    expect(onDeleteBody).toHaveBeenCalledWith(0);
    await act(async () => { root.unmount(); });
  });

  it("확인창에 날짜·체중이 담기고, 취소하면 삭제되지 않으며 폼도 닫히지 않는다", async () => {
    globalThis.confirm = vi.fn(() => false);
    const { div, root, onDeleteBody } = await mount();
    await click(div.querySelectorAll(".dbp-lp-item")[0]);
    await click(btn(div, "삭제"));
    expect(globalThis.confirm.mock.calls[0][0]).toContain("2026-07-05");
    expect(globalThis.confirm.mock.calls[0][0]).toContain("77.9");
    expect(onDeleteBody).not.toHaveBeenCalled();
    expect(div.textContent, "취소했으므로 수정 폼 유지").toContain("2026-07-05 수정");
    await act(async () => { root.unmount(); });
  });

  it("삭제되면 수정 폼이 닫힌다 — 남은 목록에서 같은 인덱스가 다른 기록을 가리키는 사고 방지", async () => {
    const { div, root } = await mount();
    await click(div.querySelectorAll(".dbp-lp-item")[0]);
    await click(btn(div, "삭제"));
    expect(div.textContent).not.toContain("2026-07-05 수정");
    await act(async () => { root.unmount(); });
  });

  it("안내 문구가 실제 도달 경로를 가리킨다", async () => {
    const { div, root } = await mount();
    expect(div.textContent).toContain("탭하면 수정·삭제");
    await act(async () => { root.unmount(); });
  });
});

describe("자동 수신 초안 버리기", () => {
  const drafts = { "2026-07-06": { weight: 73.6, fatPct: 18.7, lbm: 60.5, sampleTs: 1 } };
  beforeEach(() => { document.body.innerHTML = ""; globalThis.confirm = vi.fn(() => true); });

  it("초안 카드에 버리기 버튼이 있고 초안 날짜로 폐기를 호출한다", async () => {
    const { div, root, onDiscardDraft } = await mount({ bodyDrafts: drafts });
    await click(btn(div, "버리기"));
    expect(onDiscardDraft).toHaveBeenCalledWith("2026-07-06");
    await act(async () => { root.unmount(); });
  });

  it("확인창을 취소하면 폐기되지 않는다", async () => {
    globalThis.confirm = vi.fn(() => false);
    const { div, root, onDiscardDraft } = await mount({ bodyDrafts: drafts });
    await click(btn(div, "버리기"));
    expect(onDiscardDraft).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });

  it("확정 버튼은 그대로 남아 있다(버리기 추가가 기존 경로를 밀어내지 않음)", async () => {
    const { div, root } = await mount({ bodyDrafts: drafts });
    expect(btn(div, "확정 (잠금)")).toBeTruthy();
    await act(async () => { root.unmount(); });
  });
});
