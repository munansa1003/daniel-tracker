/* ───── 디자인 시스템: Modern Library + Soft Card + Subtle Fade ───── */
export const THEME = {
  bg: "#141414", card: "#1e1e1e", inner: "#252525", surface: "#2a2a2a",
  text: "#f5f5f0", sub: "#707070", hint: "#4a4a4a", muted: "#8a8a8a",
  gold: "#d4af37", goldDim: "rgba(212,175,55,0.12)",
  border: "rgba(255,255,255,0.06)", borderLight: "rgba(255,255,255,0.08)",
  shadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)",
  font: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export function GlobalStyles() {
  return (
    <style>{`
      @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css');
      * { font-family: ${THEME.font}; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      body { margin: 0; background: ${THEME.bg}; }
      input, select, button { font-family: ${THEME.font}; }
      @keyframes dbp-fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes dbp-fadeIn { from { opacity: 0; } to { opacity: 1; } }
      .dbp-fade { animation: dbp-fadeUp 0.25s ease-out both; }
      .dbp-fade-d1 { animation: dbp-fadeUp 0.25s ease-out 0.04s both; }
      .dbp-fade-d2 { animation: dbp-fadeUp 0.25s ease-out 0.08s both; }
      .dbp-fade-in { animation: dbp-fadeIn 0.2s ease-out both; }
      .dbp-btn { transition: all 0.15s ease; }
      .dbp-btn:hover { box-shadow: 0 0 12px rgba(212,175,55,0.2); }
      .dbp-btn:active { transform: scale(0.97); }
      .dbp-card { transition: opacity 0.2s ease; }
      @keyframes dbp-actionBar { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      .dbp-lp-selected { background: rgba(212,175,55,0.06) !important; border-left: 3px solid #d4af37 !important; }
      .dbp-lp-bar { animation: dbp-actionBar 0.2s ease-out both; }
      .dbp-lp-item { transition: background 0.15s ease; -webkit-user-select: none; user-select: none; }
      input:focus, select:focus { outline: none; border-color: rgba(212,175,55,0.3) !important; }
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
    `}</style>
  );
}

// 프로필 색상 팔레트
export const PROFILE_COLORS = ["#4a8fc9", "#d4af37", "#5a9e6f", "#9b7dc9", "#e05252", "#d4c43a", "#4ac9a8", "#c94a7d"];
