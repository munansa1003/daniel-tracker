import { useMemo, useState } from "react";
import { PERIODS, resolvePeriod, buildAnalysisPackage, packageMeta, shiftDays } from "../analysisExport.js";

// 클로드 분석용 내보내기 — 데이터 탭 행 + 펼침 패널(기간 선택 → 복사/공유/.md).
// 데이터는 이미 브라우저에 있으므로 서버·API 비용 0, 오프라인 동작.
export function ClaudeExport({ state, todayStr }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState("3m"); // 기본 3개월
  const [custom, setCustom] = useState({ start: shiftDays(todayStr, -30), end: todayStr });
  const [done, setDone] = useState(""); // 복사/저장 완료 피드백

  const range = useMemo(() => resolvePeriod(period, todayStr, state.allDays, custom), [period, todayStr, state.allDays, custom]);
  const pkg = useMemo(() => (open ? buildAnalysisPackage(state, range, todayStr) : ""), [open, state, range, todayStr]);
  const meta = useMemo(() => (open ? packageMeta(pkg, state, range) : null), [open, pkg, state, range]);

  const flash = (msg) => { setDone(msg); setTimeout(() => setDone(""), 2500); };

  const copyPkg = async () => {
    try {
      await navigator.clipboard.writeText(pkg);
      flash("복사 완료 — claude.ai에 붙여넣으세요 ✓");
    } catch {
      // 클립보드 실패(권한 등) → 파일 저장 폴백
      savePkg();
    }
  };
  const sharePkg = async () => {
    try { await navigator.share({ title: "Body Plan 분석 요청", text: pkg }); }
    catch { /* 사용자 취소 — 무시 */ }
  };
  const savePkg = () => {
    const blob = new Blob([pkg], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `bodyplan_analysis_${range.start}_${range.end}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    flash(".md 저장됨 — claude.ai에 첨부하세요 ✓");
  };

  const dateStyle = { flex: 1, minWidth: 0, background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 9, color: "#f5f5f0", fontSize: 12.5, padding: "8px 10px", fontFamily: "inherit", colorScheme: "dark" };
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "0.5px solid rgba(255,255,255,0.04)", cursor: "pointer", background: open ? "rgba(212,175,55,0.06)" : "transparent" }}>
        <div>
          <div style={{ fontSize: 12, color: open ? "#d4af37" : "#f5f5f0", fontWeight: open ? 600 : 400 }}>클로드 분석용 내보내기</div>
          <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>기간 요약+분석 프롬프트를 한 번에 — 붙여넣으면 끝</div>
        </div>
        <span style={{ fontSize: 12, color: "#d4af37" }}>📋</span>
      </div>

      {open && (
        <div style={{ padding: "12px 12px 14px", borderBottom: "0.5px solid rgba(255,255,255,0.04)", background: "rgba(212,175,55,0.03)" }}>
          <div style={{ fontSize: 11, color: "#8a8a8a", fontWeight: 500, marginBottom: 8 }}>분석 기간</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PERIODS.map((p) => {
              const on = period === p.key;
              return (
                <span key={p.key} onClick={() => setPeriod(p.key)}
                  style={{ padding: "7px 12px", borderRadius: 18, fontSize: 12, cursor: "pointer", background: on ? "#d4af37" : "#2a2a2a", color: on ? "#141414" : "#8a8a8a", fontWeight: on ? 600 : 400, border: `1px solid ${on ? "#d4af37" : "rgba(255,255,255,0.08)"}` }}>
                  {p.label}
                </span>
              );
            })}
          </div>
          {period === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10 }}>
              <input type="date" value={custom.start} max={todayStr} onChange={(e) => setCustom({ ...custom, start: e.target.value })} style={dateStyle} />
              <span style={{ color: "#707070", fontSize: 13 }}>~</span>
              <input type="date" value={custom.end} max={todayStr} onChange={(e) => setCustom({ ...custom, end: e.target.value })} style={dateStyle} />
            </div>
          )}

          {meta && (
            <div style={{ display: "flex", gap: 12, marginTop: 11, fontSize: 10.5, fontFamily: "monospace", color: "#707070", flexWrap: "wrap" }}>
              <span>기록 <b style={{ color: "#8a8a8a" }}>{meta.days}일</b></span>
              <span>체중 <b style={{ color: "#8a8a8a" }}>{meta.weighs}건</b></span>
              <span>컨디션 <b style={{ color: "#8a8a8a" }}>{meta.conds}건</b></span>
              <span>약 <b style={{ color: "#8a8a8a" }}>{meta.kb}KB</b></span>
            </div>
          )}

          <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
            <button onClick={copyPkg} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 4px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: "#d4af37", color: "#141414", border: "none", cursor: "pointer" }}><span style={{ fontSize: 15 }}>📋</span>복사</button>
            {canShare && <button onClick={sharePkg} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 4px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: "#2a2a2a", color: "#8a8a8a", border: "1px solid rgba(255,255,255,0.09)", cursor: "pointer" }}><span style={{ fontSize: 15 }}>📤</span>공유</button>}
            <button onClick={savePkg} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 4px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: "#2a2a2a", color: "#8a8a8a", border: "1px solid rgba(255,255,255,0.09)", cursor: "pointer" }}><span style={{ fontSize: 15 }}>💾</span>.md 저장</button>
          </div>
          <div style={{ fontSize: 9.5, color: done ? "#5a9e6f" : "#4a4a4a", marginTop: 8, textAlign: "center", lineHeight: 1.5, fontWeight: done ? 600 : 400 }}>
            {done || "복사 후 claude.ai에 붙여넣기 · 공유 = 공유 시트로 클로드 앱에 바로 전달"}
          </div>
        </div>
      )}
    </>
  );
}
