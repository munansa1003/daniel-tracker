// src/migrationBanners.js — 원점 이전(Vercel → Firebase Hosting) 안내 배너의 판단 로직.
//
// 순수 함수만 둔다. 배너는 "언제 보이는가"가 전부이고, 그 조건이 틀리면 두 방향으로 아프다:
//   · 너무 안 보임 → 사용자가 옛 주소에 남아 알림·자동 유입이 조용히 끊긴다
//   · 너무 자주 보임 → 매일 같은 안내를 닫아야 하는 앱이 된다
// 그래서 조건을 컴포넌트 안에 흩지 않고 여기서 테스트 가능한 형태로 고정한다.

// 닫음 표시는 origin별 localStorage에 남긴다(원점이 다르면 저장소도 다르므로,
// 새 원점에서는 애초에 이 배너가 뜨지 않는다 — 아래 조건 ②).
export const ORIGIN_BANNER_DISMISS_KEY = "dt_originBannerDismissed";

/**
 * 새 주소 안내 배너를 보일 것인가.
 *
 * ① `newOrigin`(VITE_NEW_ORIGIN)이 설정돼 있어야 한다.
 *    빌드 변수가 없으면 아예 렌더하지 않는다 — Vercel 빌드에는 이 변수를 두지 않으므로
 *    **현재 운영 중인 앱은 이 커밋으로 아무것도 달라지지 않는다**(병행 호환 불변식).
 * ② 지금 보고 있는 주소가 옛 원점(`vercel.app`)이어야 한다. 새 원점에서 "새 주소로
 *    가세요"라고 말하면 안 된다.
 * ③ 오늘 이미 닫았으면 보이지 않는다(하루 1회). 영구히 숨기지 않는 이유: 이 안내를 못 보면
 *    옛 앱에 남게 되고, 병행 기간이 끝나면 알림·AI·자동 유입이 조용히 죽는다.
 */
// 지금 보고 있는 주소가 **옛 원점**인가. 접미사가 아니라 라벨 경계로 본다 —
// `notvercel.app`·`vercel.app.evil.com` 같은 호스트에 속지 않기 위해서다.
export function isOldOrigin(hostname) {
  return typeof hostname === "string" && /(^|\.)vercel\.app$/i.test(hostname);
}

export function shouldShowOriginBanner({ newOrigin, hostname, dismissedOn, todayStr } = {}) {
  if (!newOrigin) return false;
  if (!isOldOrigin(hostname)) return false;
  if (dismissedOn && dismissedOn === todayStr) return false;
  return true;
}

/**
 * "알림 다시 켜기" 배너를 보일 것인가 (02 §1 #4 · DR-9).
 *
 * 푸시 구독은 **원점(서비스워커 등록 단위)에 묶인다**. 새 주소는 구독이 없는 상태로 시작하고,
 * 서버가 보내는 알림은 계속 **옛 원점의 서비스워커**로 간다. 옛 앱을 지우면 그 구독이
 * 404/410으로 죽어 크론이 정리하고 — 알림이 완전히 끊긴다. 사용자 눈에는 아무 일도
 * 안 일어난다. 그래서 "이전에 알림을 쓰던 사람"에게만, 새 원점에서 한 번 밀어 준다.
 *
 * 조건:
 *   ① **이전이 진행 중이고(`newOrigin` 설정) 지금이 새 원점이다.** 이 두 겹이 없으면
 *      배너가 **현재 운영 중인 Vercel 앱에도 뜬다** — 거기서는 "알림을 다시 켜세요"가
 *      틀린 말일 뿐 아니라(구독은 멀쩡하다), 병행 호환 불변식("변수가 없으면 무변경")을
 *      깨는 실제 동작 변화다. 옛 원점에도 `VITE_NEW_ORIGIN`을 넣게 되므로(원점 배너용)
 *      변수 하나만으로는 부족하고 "새 원점에 있다"까지 봐야 한다.
 *   ② 이 브라우저에서 백그라운드 푸시가 가능(`pushConfigured()`)
 *   ③ 이 원점에 **현재 구독이 없다** (있으면 이미 켠 것이다)
 *   ④ 이전에 리마인더를 설정한 적이 있다 — `goals.reminders`가 저장된 객체이고 하나라도 켜져
 *      있는 상태. 이 값은 Firestore에 있어 원점을 넘어 따라오고, 앱이 서버 `push:state`로
 *      올리는 것과 같은 값이다(`push-sync.js`). 한 번도 알림을 만진 적 없는 사람에게는
 *      뜨지 않는다.
 *
 * `hasSubscription`이 `null`(아직 확인 중)이면 보이지 않는다 — 확인 전에 띄웠다가 이미
 * 구독된 사람에게 깜빡이는 편보다 한 박자 늦는 편이 낫다.
 */
export function shouldShowPushBanner({ newOrigin, hostname, pushReady, hasSubscription, reminders } = {}) {
  if (!newOrigin) return false;
  if (isOldOrigin(hostname)) return false;
  if (!pushReady) return false;
  if (hasSubscription !== false) return false;
  if (!reminders || typeof reminders !== "object") return false;
  return Object.values(reminders).some((v) => v === true);
}

// localStorage 접근은 전부 감싼다 — 사파리 프라이빗·저장소 가득참에서 던진다.
export function readDismissedOn(storage) {
  try {
    return (storage || globalThis.localStorage)?.getItem(ORIGIN_BANNER_DISMISS_KEY) || null;
  } catch { return null; }
}

export function writeDismissedOn(todayStr, storage) {
  try {
    (storage || globalThis.localStorage)?.setItem(ORIGIN_BANNER_DISMISS_KEY, todayStr);
  } catch { /* 저장 못 해도 배너는 이번 세션 동안 닫힌 상태로 둔다 */ }
}
