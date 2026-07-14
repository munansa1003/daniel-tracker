import { useState, useEffect } from "react";

// 가로(landscape) 여부 — 가로모드 전용 레이아웃 분기의 단일 소스.
// matchMedia가 없는 환경(SSR·renderToStaticMarkup)에서는 항상 세로(false)로 폴백해
// 기존 세로 UI가 기본 경로로 유지된다. 레이아웃 전용 훅 — 계산·데이터와 무관.
const QUERY = "(orientation: landscape)";

const hasMatchMedia = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

export function useOrientation() {
  const [landscape, setLandscape] = useState(() => (hasMatchMedia() ? window.matchMedia(QUERY).matches : false));

  useEffect(() => {
    if (!hasMatchMedia()) return undefined;
    const mql = window.matchMedia(QUERY);
    const onChange = (e) => setLandscape(e.matches);
    setLandscape(mql.matches);
    // iOS 13 이하 사파리는 addEventListener 미지원 → addListener 폴백
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  return landscape;
}
