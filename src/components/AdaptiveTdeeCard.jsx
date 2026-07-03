// 적응형 유지칼로리 카드 (설정 › 목표 탭) — 실측 TDEE 표시 + 보정 제안(적용) + 되돌리기.
// 되돌리기 2단계: ① 토글 OFF = 공식 복귀 ② '공식으로 되돌리기' = 오늘부터 보정 0(과거 보존).
export function AdaptiveTdeeCard({ estimate, adaptiveOn, currentAdjust, proposal, onToggle, onApply, onRevert }) {
  const card = { background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 1px 6px rgba(0,0,0,0.2)" };
  const Toggle = () => (
    <div onClick={() => onToggle(!adaptiveOn)} style={{ width: 42, height: 24, borderRadius: 12, background: adaptiveOn ? "#5a9e6f" : "#3a3a3a", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}>
      <div style={{ position: "absolute", top: 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", left: adaptiveOn ? 21 : 3, transition: "left .15s" }} />
    </div>
  );
  const head = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: adaptiveOn ? 14 : 0 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>적응형 유지칼로리</div>
        <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>최근 4주 데이터로 실제 소모를 역산해 보정</div>
      </div>
      <Toggle />
    </div>
  );

  if (!adaptiveOn) {
    return (
      <div style={card}>
        {head}
        <div style={{ fontSize: 10, color: "#707070", marginTop: 10, lineHeight: 1.6 }}>꺼짐 — 목표는 공식(BMR×1.05) 기준. 켜면 섭취·체중 추세로 유지칼로리를 측정해 <b style={{ color: "#8a8a8a" }}>제안형</b>으로 미세보정합니다.</div>
      </div>
    );
  }

  // 켜짐: 데이터 부족이면 안내, 충분하면 실측 + 제안/되돌리기
  const enough = estimate && estimate.valid;
  const formulaTDEE = enough ? estimate.formulaMaint + estimate.avgExercise : 0;
  const conf = !enough ? "부족" : estimate.confident ? "높음" : "보통";
  const confColor = conf === "높음" ? "#5a9e6f" : conf === "보통" ? "#d4af37" : "#707070";
  const pct = estimate ? Math.min(100, Math.round((estimate.loggedDays / estimate.windowDays) * 100)) : 0;

  return (
    <div style={card}>
      {head}

      {!enough ? (
        <div style={{ fontSize: 11.5, color: "#8a8a8a", lineHeight: 1.6 }}>
          데이터가 더 쌓이면 켜집니다 — 기록 <b className="mono" style={{ color: "#f5f5f0" }}>{estimate?.loggedDays ?? 0}/{estimate?.windowDays ?? 28}일</b> · 체중 <b style={{ color: "#f5f5f0" }}>{estimate?.weighIns ?? 0}회</b>. 그때까진 공식(BMR×1.05)을 씁니다.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "#707070" }}>실측 유지칼로리 (TDEE)</div>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "monospace", color: "#5a9e6f", lineHeight: 1 }}>{estimate.measuredTDEE.toLocaleString()}<span style={{ fontSize: 12, color: "#707070", fontWeight: 400 }}> kcal</span></div>
            </div>
            <div style={{ paddingBottom: 3 }}>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: "#707070" }}>공식 추정 {formulaTDEE.toLocaleString()}</div>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: estimate.delta === 0 ? "#707070" : "#d4af37" }}>{estimate.delta > 0 ? "▲" : estimate.delta < 0 ? "▼" : "="} {Math.abs(estimate.delta)} kcal</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, margin: "12px 0 5px" }}>
            <span style={{ color: "#8a8a8a" }}>데이터 신뢰도</span>
            <span style={{ fontFamily: "monospace", color: confColor }}>기록 {estimate.loggedDays}/{estimate.windowDays}일 · 체중 {estimate.weighIns}회 · {conf}</span>
          </div>
          <div style={{ height: 8, background: "#2a2a2a", borderRadius: 4, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: confColor }} /></div>

          {proposal && (
            <div style={{ marginTop: 14, background: "rgba(90,158,111,0.07)", border: "1px solid rgba(90,158,111,0.25)", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 12, color: "#c8c8c0", lineHeight: 1.6 }}>
                목표를 <b style={{ fontFamily: "monospace" }}>{proposal.current.k.toLocaleString()} → {proposal.proposed.k.toLocaleString()}</b>로 조정할까요?
                <span style={{ color: "#707070" }}> (탄수 {proposal.current.c}→{proposal.proposed.c}g · 단백질·지방 유지)</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                <button onClick={() => onApply(proposal.delta)} style={{ flex: 1, padding: 9, background: "#5a9e6f", border: "none", borderRadius: 8, color: "#0d1b12", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>적용</button>
                <button onClick={() => onToggle(true)} style={{ flex: 1, padding: 9, background: "#252525", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#8a8a8a", fontSize: 12, cursor: "pointer" }}>나중에</button>
              </div>
            </div>
          )}

          {currentAdjust !== 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 11 }}>
              <span style={{ color: "#707070", fontFamily: "monospace" }}>보정 {currentAdjust > 0 ? "+" : ""}{currentAdjust}kcal 적용 중</span>
              <span onClick={onRevert} style={{ color: "#e05252", cursor: "pointer", textDecoration: "underline" }}>공식으로 되돌리기</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
