import { useMemo, useState } from "react";
import { PERIODS, resolvePeriod, buildAnalysisPackage, packageMeta, sharePrivacyNotice, shiftDays } from "../analysisExport.js";
import { TTL_CHOICES, shareUrlOf, remainingText, isExpired, createShareLink, revokeShareLink } from "../shareLink.js";

// 클로드 분석용 내보내기 — 데이터 탭 행 + 펼침 패널(기간 선택 → 복사/공유/.md).
// 패널을 열 때 onResync로 Firestore 최신본을 강제로 당겨온다 — 앱은 localStorage-first라
// 콜드 스타트 직후·다른 기기에서 열면 오래된 스냅샷으로 패키지가 만들어질 수 있기 때문.
export function ClaudeExport({ state, todayStr, onResync, shareLink, onShareLinkChange }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState("3m"); // 기본 3개월
  const [custom, setCustom] = useState({ start: shiftDays(todayStr, -30), end: todayStr });
  const [detail, setDetail] = useState(false); // 기본 코치 요약본 (문서 비대화 방지)
  const [done, setDone] = useState(""); // 복사/저장 완료 피드백
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  // 🔗 공유 링크 — 발급된 링크는 goals에 저장돼 기기 간 공유(폐기도 어느 기기서나)
  const [linkMode, setLinkMode] = useState(false);
  const [ttl, setTtl] = useState("24h");
  const [busyLink, setBusyLink] = useState(false);
  const [linkErr, setLinkErr] = useState("");
  const activeLink = !isExpired(shareLink) ? shareLink : null;
  const expiredLink = shareLink && isExpired(shareLink);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) { setOffline(true); return; }
      setOffline(false);
      if (onResync) {
        setSyncing(true);
        Promise.resolve(onResync()).catch(() => {}).then(() => setSyncing(false));
      }
    }
  };

  const range = useMemo(() => resolvePeriod(period, todayStr, state.allDays, custom), [period, todayStr, state.allDays, custom]);
  const pkg = useMemo(() => (open ? buildAnalysisPackage(state, range, todayStr, { detail }) : ""), [open, state, range, todayStr, detail]);
  const meta = useMemo(() => (open ? packageMeta(pkg, state, range) : null), [open, pkg, state, range]);
  // 최근 기록일 — 오래된 스냅샷 경고용(전체 데이터 기준, 기간 무관)
  const lastRecord = useMemo(() => {
    const ds = Object.keys(state.allDays || {}).filter((d) => d <= todayStr && (state.allDays[d]?.meals?.length || state.allDays[d]?.exercises?.length)).sort();
    return ds.length ? ds[ds.length - 1] : null;
  }, [state.allDays, todayStr]);
  const staleDays = lastRecord ? Math.round((new Date(todayStr + "T12:00:00") - new Date(lastRecord + "T12:00:00")) / 86400000) : null;

  const flash = (msg) => { setDone(msg); setTimeout(() => setDone(""), 2500); };

  // 빈/깨진 패키지의 침묵 배포 방지 — 어떤 경로로든 내용 없는 결과가 나가지 않게
  const pkgOk = () => {
    if (pkg && pkg.length > 200) return true;
    alert("패키지 생성에 문제가 있어요. 앱을 새로고침한 뒤 다시 시도해주세요.");
    return false;
  };

  const copyPkg = async () => {
    if (!pkgOk()) return;
    try {
      await navigator.clipboard.writeText(pkg);
      flash("복사 완료 — claude.ai에 붙여넣으세요 ✓");
    } catch {
      // 클립보드 실패(권한 등) → 파일 저장 폴백을 명시적으로 안내
      flash("클립보드 실패 — .md 파일로 대신 저장했어요");
      savePkg(true);
    }
  };
  const sharePkg = async () => {
    if (!pkgOk()) return;
    try { await navigator.share({ title: "Body Plan 분석 요청", text: pkg }); }
    catch (e) {
      // 사용자 취소(AbortError)는 무시, 그 외(용량 초과 등)는 안내 — 침묵 실패 금지
      if (!e || e.name !== "AbortError") flash("공유 실패 — '복사'를 사용해보세요");
    }
  };
  // ── 🔗 공유 링크 ──
  const openLinkMode = () => { setLinkErr(""); setLinkMode((v) => !v); };

  const makeLink = async () => {
    if (!pkgOk()) return;
    setBusyLink(true); setLinkErr("");
    try {
      // 만료된 링크의 토큰도 함께 넘긴다 — 만료 판정은 클라이언트 시계 기준이라
      // 서버에서는 아직 살아 있을 수 있다(기기 시계가 빠른 경우).
      const link = await createShareLink(pkg, ttl, shareLink?.token);
      onShareLinkChange?.(link);   // goals에 저장(기기 간 동기화)
      setLinkMode(false);
      flash("링크 생성 완료 — URL을 복사해 클로드에 전달하세요 ✓");
    } catch (e) {
      setLinkErr(e.message || "링크를 만들지 못했어요");
    }
    setBusyLink(false);
  };

  const dropLink = async () => {
    if (busyLink || !activeLink) return;
    if (!confirm("이 링크를 폐기할까요? 즉시 열람이 차단됩니다.")) return;
    setBusyLink(true); setLinkErr("");
    try {
      await revokeShareLink(activeLink.token);
      onShareLinkChange?.(null);
      flash("링크를 폐기했어요 ✓");
    } catch (e) {
      setLinkErr(e.message || "폐기하지 못했어요");
    }
    setBusyLink(false);
  };

  const copyLink = async () => {
    const url = shareUrlOf(activeLink.token);
    try { await navigator.clipboard.writeText(url); flash("URL 복사 완료 — 클로드에 붙여넣으세요 ✓"); }
    catch { setLinkErr("복사 실패 — 주소를 길게 눌러 직접 복사해주세요"); }
  };

  const shareLinkUrl = async () => {
    try { await navigator.share({ title: "Body Plan 분석 링크", url: shareUrlOf(activeLink.token) }); }
    catch (e) { if (!e || e.name !== "AbortError") setLinkErr("공유 실패 — 'URL 복사'를 사용해보세요"); }
  };

  const savePkg = (skipCheck) => {
    if (!skipCheck && !pkgOk()) return;
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
      <div onClick={toggleOpen} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "0.5px solid rgba(255,255,255,0.04)", cursor: "pointer", background: open ? "rgba(212,175,55,0.06)" : "transparent" }}>
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

          <div style={{ fontSize: 11, color: "#8a8a8a", fontWeight: 500, margin: "12px 0 8px" }}>문서 형식</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ v: false, l: "코치 요약본" }, { v: true, l: "정밀 상세본" }].map((o) => {
              const on = detail === o.v;
              return (
                <span key={o.l} onClick={() => setDetail(o.v)}
                  style={{ padding: "7px 12px", borderRadius: 18, fontSize: 12, cursor: "pointer", background: on ? "#5a9e6f" : "#2a2a2a", color: on ? "#141414" : "#8a8a8a", fontWeight: on ? 600 : 400, border: `1px solid ${on ? "#5a9e6f" : "rgba(255,255,255,0.08)"}` }}>
                  {o.l}
                </span>
              );
            })}
          </div>
          <div style={{ fontSize: 9.5, color: "#4a4a4a", marginTop: 6, lineHeight: 1.5 }}>
            {detail ? "상세본 = 요약본 + 날짜별 끼니·운동 세션 전체 (구간 심층 분석용, 용량 큼)" : "요약본 = 집계·판정 중심 (권장 — 문서가 짧아 분석 품질이 좋아요)"}
          </div>

          {syncing && (
            <div style={{ marginTop: 11, fontSize: 11, color: "#4a8fc9", fontWeight: 500 }}>⟳ 최신 데이터 동기화 중… (다른 기기 기록까지 반영)</div>
          )}
          {offline && (
            <div style={{ marginTop: 11, fontSize: 10.5, color: "#d4af37", lineHeight: 1.5 }}>⚠️ 오프라인 — 이 기기에 저장된 데이터 기준입니다. 다른 기기 기록이 빠질 수 있어요.</div>
          )}
          {meta && (
            <div style={{ display: "flex", gap: 12, marginTop: 11, fontSize: 10.5, fontFamily: "monospace", color: "#707070", flexWrap: "wrap" }}>
              <span>기록 <b style={{ color: "#8a8a8a" }}>{meta.days}일</b></span>
              <span>체중 <b style={{ color: "#8a8a8a" }}>{meta.weighs}건</b></span>
              <span>컨디션 <b style={{ color: "#8a8a8a" }}>{meta.conds}건</b></span>
              <span>약 <b style={{ color: "#8a8a8a" }}>{meta.kb}KB</b></span>
              {lastRecord && <span>최근기록 <b style={{ color: staleDays >= 2 ? "#e05252" : "#8a8a8a" }}>{lastRecord.slice(5)}</b></span>}
            </div>
          )}
          {!syncing && staleDays !== null && staleDays >= 2 && (
            <div style={{ marginTop: 8, fontSize: 10.5, color: "#e05252", lineHeight: 1.5 }}>⚠️ 최근 기록이 {staleDays}일 전이에요 — 어제·오늘 기록이 실제로 있는데 여기 안 보이면, 잠시 후 패널을 다시 열어보세요(동기화 재시도).</div>
          )}

          <div style={{ display: "flex", gap: 7, marginTop: 12, opacity: syncing ? 0.45 : 1 }}>
            <button onClick={copyPkg} disabled={syncing} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 4px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: "#d4af37", color: "#141414", border: "none", cursor: syncing ? "default" : "pointer" }}><span style={{ fontSize: 15 }}>📋</span>복사</button>
            {canShare && <button onClick={sharePkg} disabled={syncing} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 4px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: "#2a2a2a", color: "#8a8a8a", border: "1px solid rgba(255,255,255,0.09)", cursor: syncing ? "default" : "pointer" }}><span style={{ fontSize: 15 }}>📤</span>공유</button>}
            <button onClick={() => savePkg()} disabled={syncing} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 4px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: "#2a2a2a", color: "#8a8a8a", border: "1px solid rgba(255,255,255,0.09)", cursor: syncing ? "default" : "pointer" }}><span style={{ fontSize: 15 }}>💾</span>.md 저장</button>
            <button onClick={openLinkMode} disabled={syncing} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 4px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: "rgba(74,143,201,0.16)", color: "#4a8fc9", border: "1px solid rgba(74,143,201,0.45)", cursor: syncing ? "default" : "pointer" }}><span style={{ fontSize: 15 }}>🔗</span>링크</button>
          </div>
          <div style={{ fontSize: 9.5, color: done ? "#5a9e6f" : "#4a4a4a", marginTop: 8, textAlign: "center", lineHeight: 1.5, fontWeight: done ? 600 : 400 }}>
            {done || "복사 후 claude.ai에 붙여넣기 · 🔗 링크 = 클로드가 직접 읽는 주소"}
          </div>

          {/* 🔗 AI 공유 링크 — 유효기간 선택 → 발급 → URL 복사·폐기 */}
          {linkMode && !activeLink && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 11, color: "#8a8a8a", fontWeight: 500, marginBottom: 8 }}>링크 유효기간</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TTL_CHOICES.map((o) => {
                  const on = ttl === o.key;
                  return (
                    <span key={o.key} onClick={() => setTtl(o.key)}
                      style={{ padding: "7px 12px", borderRadius: 18, fontSize: 12, cursor: "pointer", background: on ? "#4a8fc9" : "#2a2a2a", color: on ? "#fff" : "#8a8a8a", fontWeight: on ? 600 : 400, border: `1px solid ${on ? "#4a8fc9" : "rgba(255,255,255,0.08)"}` }}>
                      {o.label}
                    </span>
                  );
                })}
              </div>
              <button onClick={makeLink} disabled={busyLink}
                style={{ width: "100%", marginTop: 11, padding: 11, borderRadius: 10, fontSize: 12.5, fontWeight: 600, background: "#4a8fc9", color: "#fff", border: "none", cursor: busyLink ? "default" : "pointer", opacity: busyLink ? 0.6 : 1 }}>
                {busyLink ? "만드는 중…" : "🔗 링크 만들기"}
              </button>
              {/* 발급 "직전"에 무엇이 누구에게 보이는지 알린다 — 감사 R-22 */}
              <div style={{ fontSize: 10, color: "#d9a441", marginTop: 8, lineHeight: 1.5, background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 8, padding: "8px 9px" }}>
                🔓 {meta ? sharePrivacyNotice(meta) : "이 URL을 가진 사람은 누구나 로그인 없이 내용을 볼 수 있어요."}
              </div>
              <div style={{ fontSize: 9.5, color: "#4a4a4a", marginTop: 7, lineHeight: 1.5 }}>
                지금 설정(기간·문서 형식)으로 만든 <b style={{ color: "#8a8a8a" }}>공유 시점 스냅샷</b>이 저장됩니다. 이후 기록을 추가하면 새 링크를 만들면 돼요.
                링크를 새로 만들면 <b style={{ color: "#8a8a8a" }}>이전 링크는 즉시 폐기</b>됩니다.
              </div>
              {linkErr && <div style={{ fontSize: 10.5, color: "#e05252", marginTop: 7 }}>{linkErr}</div>}
            </div>
          )}

          {activeLink && (
            <div style={{ marginTop: 12, background: "#1e1e1e", border: "1px solid rgba(90,158,111,0.35)", borderRadius: 11, padding: "11px 12px" }}>
              <div style={{ fontFamily: "monospace", fontSize: 10.5, color: "#cfe0f0", wordBreak: "break-all", lineHeight: 1.5, background: "#101010", borderRadius: 7, padding: "8px 9px", border: "1px solid rgba(255,255,255,0.06)" }}>
                {shareUrlOf(activeLink.token)}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 9, fontSize: 10.5, gap: 6, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#5a9e6f", fontWeight: 600 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#5a9e6f", display: "inline-block" }} />
                  활성 · {remainingText(activeLink.expiresAt) || "곧 만료"}
                </span>
                <span onClick={dropLink} style={{ fontSize: 11, color: "#e05252", textDecoration: "underline", cursor: busyLink ? "default" : "pointer" }}>
                  {busyLink ? "처리 중…" : "링크 폐기"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 7, marginTop: 11 }}>
                <button onClick={copyLink} style={{ flex: 1, padding: 10, borderRadius: 10, fontSize: 12, fontWeight: 600, background: "#4a8fc9", color: "#fff", border: "none", cursor: "pointer" }}>📋 URL 복사</button>
                {canShare && <button onClick={shareLinkUrl} style={{ flex: 1, padding: 10, borderRadius: 10, fontSize: 12, fontWeight: 600, background: "#2a2a2a", color: "#8a8a8a", border: "1px solid rgba(255,255,255,0.09)", cursor: "pointer" }}>📤 공유</button>}
              </div>
              <div style={{ fontSize: 9.5, color: "#d4af37", marginTop: 9, lineHeight: 1.5, background: "rgba(212,175,55,0.07)", border: "1px solid rgba(212,175,55,0.22)", borderRadius: 8, padding: "7px 9px" }}>
                {/* "무엇이 빠지는지"만 적으면 민감한 것이 없다고 읽힌다 — 실리는 것도 함께 적는다(감사 R-22) */}
                ⚠️ 이 주소를 아는 사람은 <b>로그인 없이</b> 내 기록 요약을 볼 수 있어요. 클로드 대화에만 붙여넣고, 끝나면 <b>폐기</b>하세요.
                진행 사진·이름은 포함되지 않지만, <b>직접 쓴 컨디션 메모(부상·질병 등)는 그대로 실립니다.</b>
              </div>
              {linkErr && <div style={{ fontSize: 10.5, color: "#e05252", marginTop: 7 }}>{linkErr}</div>}
            </div>
          )}

          {linkMode && !activeLink && expiredLink && (
            <div style={{ marginTop: 8, fontSize: 10.5, color: "#707070" }}>이전 링크는 만료됐어요 — 위에서 새로 만들 수 있습니다.</div>
          )}
        </div>
      )}
    </>
  );
}
