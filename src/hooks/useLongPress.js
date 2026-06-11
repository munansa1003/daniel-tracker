import { useState, useEffect, useCallback, useRef } from "react";

// useLongPress 훅
export function useLongPress(delay = 400) {
  const [selectedIdx, setSelectedIdx] = useState(null);
  const timerRef = useRef(null);
  const movedRef = useRef(false);
  const firedRef = useRef(false);
  const touchedRef = useRef(false);

  // 언마운트 시 타이머 정리
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const bind = useCallback((idx) => ({
    onTouchStart: () => {
      touchedRef.current = true;
      movedRef.current = false;
      firedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!movedRef.current) { firedRef.current = true; setSelectedIdx(prev => prev === idx ? null : idx); }
      }, delay);
    },
    onTouchMove: () => { movedRef.current = true; if (timerRef.current) clearTimeout(timerRef.current); },
    onTouchEnd: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onMouseDown: () => {
      if (touchedRef.current) { touchedRef.current = false; return; }
      movedRef.current = false;
      firedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { firedRef.current = true; setSelectedIdx(prev => prev === idx ? null : idx); }, delay);
    },
    onMouseUp: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onMouseLeave: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onContextMenu: (e) => e.preventDefault(),
  }), [delay]);

  const wasLongPress = useCallback(() => {
    if (firedRef.current) { firedRef.current = false; return true; }
    return false;
  }, []);

  const clear = useCallback(() => setSelectedIdx(null), []);

  return { selectedIdx, bind, wasLongPress, clear };
}
