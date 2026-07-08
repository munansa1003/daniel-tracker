// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// store는 firebase에 붙으므로 사진 함수만 목킹 (접힌 상태 렌더는 호출 안 하지만 import 안전화)
vi.mock("../store.js", () => ({
  listProgressPhotos: vi.fn(async () => []),
  saveProgressPhoto: vi.fn(async () => "id"),
  deleteProgressPhoto: vi.fn(async () => true),
}));

import { ProgressPhotos } from "../components/ProgressPhotos.jsx";

describe("ProgressPhotos 렌더 스모크", () => {
  it("접힌 섹션 헤더가 크래시 없이 렌더", () => {
    const h = renderToStaticMarkup(<ProgressPhotos date="2026-07-08" bodyLog={[{ date: "2026-07-01", weight: 77.9 }]} />);
    expect(h).toContain("진행 사진");
    expect(h).toContain("▼"); // 접힘 상태
  });
});
