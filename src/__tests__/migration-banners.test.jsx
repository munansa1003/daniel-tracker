// 원점 이전 안내 배너 2종 — 언제 보이고 언제 보이지 않는가.
//
// 이 배너의 실패는 양쪽이 다 아프다:
//   · 안 보이면 → 사용자가 옛 주소에 남아 알림·AI·자동 유입이 조용히 끊긴다(02 §1 #1·#4)
//   · 늘 보이면 → 매일 같은 안내를 닫아야 하는 앱이 된다
// 그리고 가장 중요한 조건: **빌드 변수가 없으면 아무것도 렌더하지 않는다.**
// 지금 운영 중인 Vercel 빌드에는 그 변수가 없으므로, 이 커밋은 현재 앱을 바꾸지 않는다.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MigrationBanners } from "../components/MigrationBanners.jsx";
import {
  shouldShowOriginBanner,
  shouldShowPushBanner,
  readDismissedOn,
  writeDismissedOn,
  ORIGIN_BANNER_DISMISS_KEY,
} from "../migrationBanners.js";

const ORIGIN = "https://bodyplan.example";
const TODAY = "2026-09-07";

describe("shouldShowOriginBanner — 새 주소 안내", () => {
  it("옛 원점(vercel.app)에서 변수가 있으면 보인다", () => {
    expect(shouldShowOriginBanner({ newOrigin: ORIGIN, hostname: "daniel-tracker.vercel.app", todayStr: TODAY })).toBe(true);
  });

  it("VITE_NEW_ORIGIN이 없으면 절대 보이지 않는다 — 현재 운영 앱 무영향", () => {
    for (const v of [undefined, "", null]) {
      expect(shouldShowOriginBanner({ newOrigin: v, hostname: "daniel-tracker.vercel.app", todayStr: TODAY })).toBe(false);
    }
  });

  it("이미 새 원점이면 보이지 않는다 — 여기서 '새 주소로 가세요'는 말이 안 된다", () => {
    for (const h of ["bodyplan.example", "daniel-tracker-cb781.web.app", "localhost"]) {
      expect(shouldShowOriginBanner({ newOrigin: ORIGIN, hostname: h, todayStr: TODAY }), h).toBe(false);
    }
  });

  it("vercel.app을 흉내낸 호스트에는 속지 않는다", () => {
    // 접미사 일치가 아니라 **라벨 경계**를 본다 — 'notvercel.app'·'vercel.app.evil.com'은 아니다.
    for (const h of ["notvercel.app", "vercel.app.evil.com", "myvercel.appx"]) {
      expect(shouldShowOriginBanner({ newOrigin: ORIGIN, hostname: h, todayStr: TODAY }), h).toBe(false);
    }
    expect(shouldShowOriginBanner({ newOrigin: ORIGIN, hostname: "vercel.app", todayStr: TODAY })).toBe(true);
  });

  it("오늘 닫았으면 오늘은 안 보이고, 날이 바뀌면 다시 보인다", () => {
    const base = { newOrigin: ORIGIN, hostname: "daniel-tracker.vercel.app", todayStr: TODAY };
    expect(shouldShowOriginBanner({ ...base, dismissedOn: TODAY })).toBe(false);
    expect(shouldShowOriginBanner({ ...base, dismissedOn: "2026-09-06" })).toBe(true);
  });
});

describe("shouldShowPushBanner — 알림 다시 켜기 (DR-9)", () => {
  const on = { record: true, weight: false };

  it("푸시 가능 · 이 원점에 구독 없음 · 예전에 리마인더를 켰던 사람 → 보인다", () => {
    expect(shouldShowPushBanner({ pushReady: true, hasSubscription: false, reminders: on })).toBe(true);
  });

  it("이미 구독돼 있으면 보이지 않는다", () => {
    expect(shouldShowPushBanner({ pushReady: true, hasSubscription: true, reminders: on })).toBe(false);
  });

  it("아직 확인 전(null)이면 보이지 않는다 — 깜빡이느니 한 박자 늦는 편이 낫다", () => {
    expect(shouldShowPushBanner({ pushReady: true, hasSubscription: null, reminders: on })).toBe(false);
  });

  it("이 브라우저가 푸시를 못 하면 보이지 않는다 — 켤 수 없는 것을 권하지 않는다", () => {
    expect(shouldShowPushBanner({ pushReady: false, hasSubscription: false, reminders: on })).toBe(false);
  });

  it("리마인더를 한 번도 켠 적 없으면 보이지 않는다", () => {
    for (const r of [undefined, null, {}, { record: false, weight: false }]) {
      expect(shouldShowPushBanner({ pushReady: true, hasSubscription: false, reminders: r })).toBe(false);
    }
  });
});

describe("닫음 표시 저장 — 저장소가 던져도 앱이 죽지 않는다", () => {
  it("읽고 쓴다", () => {
    const mem = new Map();
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    expect(readDismissedOn(storage)).toBeNull();
    writeDismissedOn(TODAY, storage);
    expect(mem.get(ORIGIN_BANNER_DISMISS_KEY)).toBe(TODAY);
    expect(readDismissedOn(storage)).toBe(TODAY);
  });

  it("사파리 프라이빗·저장소 가득참처럼 던지는 경우도 조용히 넘어간다", () => {
    const boom = { getItem: () => { throw new Error("nope"); }, setItem: () => { throw new Error("nope"); } };
    expect(readDismissedOn(boom)).toBeNull();
    expect(() => writeDismissedOn(TODAY, boom)).not.toThrow();
  });
});

describe("MigrationBanners 렌더", () => {
  const base = {
    newOrigin: "",
    hostname: "daniel-tracker.vercel.app",
    todayStr: TODAY,
    onDismissOrigin: () => {},
    pushReady: false,
    hasSubscription: null,
    reminders: undefined,
    onEnablePush: () => {},
  };

  it("조건이 하나도 아니면 아무것도 렌더하지 않는다", () => {
    expect(renderToStaticMarkup(<MigrationBanners {...base} />)).toBe("");
  });

  it("원점 배너: 새 주소와 '홈 화면에 추가' 안내가 보이고, 링크가 새 주소를 가리킨다", () => {
    const h = renderToStaticMarkup(<MigrationBanners {...base} newOrigin={ORIGIN} />);
    expect(h).toContain(ORIGIN);
    expect(h).toContain("홈 화면에 추가");
    expect(h).toContain(`href="${ORIGIN}"`);
  });

  it("푸시 배너: '알림을 다시 켜' 안내에 **옛 앱 로그아웃이 먼저**라는 순서가 들어 있다", () => {
    // 순서를 거꾸로 하면(새 앱에서 먼저 켜고 옛 앱 로그아웃) 옛 앱의 로그아웃이 방금 만든
    // 새 구독을 지운다 — 안내 문구가 이 사고를 막는 유일한 장치다(02 §1 #4).
    const h = renderToStaticMarkup(
      <MigrationBanners {...base} pushReady hasSubscription={false} reminders={{ record: true }} />
    );
    expect(h).toContain("알림을 다시 켜주세요");
    expect(h).toContain("옛 앱에서 먼저 로그아웃");
    expect(h).toContain("켜기");
  });

  it("두 조건이 동시에 참이면 배너 두 개가 함께 나온다", () => {
    const h = renderToStaticMarkup(
      <MigrationBanners {...base} newOrigin={ORIGIN} pushReady hasSubscription={false} reminders={{ record: true }} />
    );
    expect(h).toContain("새 주소로 이동해 주세요");
    expect(h).toContain("알림을 다시 켜주세요");
  });

  it("닫기 버튼이 onDismissOrigin에 연결돼 있다", () => {
    const onDismissOrigin = vi.fn();
    // renderToStaticMarkup은 핸들러를 실행하지 않으므로 요소 트리에서 직접 확인한다.
    const el = MigrationBanners({ ...base, newOrigin: ORIGIN, onDismissOrigin });
    const json = JSON.stringify(el, (k, v) => (typeof v === "function" ? "FN" : v));
    expect(json).toContain("FN");
    expect(renderToStaticMarkup(<MigrationBanners {...base} newOrigin={ORIGIN} onDismissOrigin={onDismissOrigin} />))
      .toContain("오늘 하루 안 보기");
  });
});
