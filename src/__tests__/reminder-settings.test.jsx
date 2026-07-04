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

  it("앱 닫아도 오는 푸시는 다음 단계(FCM) 안내", () => {
    const h = renderToStaticMarkup(<ReminderSettings reminders={undefined} onChange={noop} />);
    expect(h).toContain("FCM");
  });
});
