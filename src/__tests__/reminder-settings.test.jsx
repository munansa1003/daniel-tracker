import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReminderSettings } from "../components/ReminderSettings.jsx";

const noop = () => {};

describe("ReminderSettings", () => {
  it("세 가지 리마인더 항목을 모두 렌더", () => {
    const h = renderToStaticMarkup(<ReminderSettings reminders={{ record: true, weight: true, backup: true }} onChange={noop} />);
    expect(h).toContain("기록 리마인더");
    expect(h).toContain("체중 측정");
    expect(h).toContain("백업 알림");
  });

  it("예약 푸시 시각·iOS 설치 안내", () => {
    const h = renderToStaticMarkup(<ReminderSettings reminders={undefined} onChange={noop} pushReady={true} onEnablePush={noop} onDisablePush={noop} />);
    expect(h).toContain("밤 8시");
    expect(h).toContain("설치");
  });
});
