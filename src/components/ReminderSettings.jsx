import { useState } from "react";

const ITEMS = [
  { key: "record", ico: "🍱", n: "기록 리마인더", d: "오늘 식단·운동을 아직 안 적었으면 밤 8시에 알림 (인앱 배너도)" },
  { key: "weight", ico: "⚖️", n: "체중 측정", d: "7일 이상 체중을 안 쟀으면 알림 (추세·적응형 정확도용)" },
  { key: "backup", ico: "💾", n: "백업 알림", d: "15일 이상 백업이 없으면 알림" },
  { key: "report", ico: "🎯", n: "주간 성적표", d: "월요일 밤 8시, 지난 주 요약(기록·칼로리·단백질·운동)을 푸시로" },
];

// 알림 설정 — 권한/구독 + 테스트 발송 + 켤 리마인더 토글.
//  pushReady   : 백그라운드 푸시 가능(브라우저+VAPID 설정) 여부
//  onEnablePush: 구독 생성+서버 저장 (async → 성공 bool)
//  onDisablePush: 구독 해제
export function ReminderSettings({ reminders, onChange, pushReady, onEnablePush, onDisablePush }) {
  const cur = { record: true, weight: true, backup: true, report: true, ...(reminders || {}) };
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [perm, setPerm] = useState(supported ? window.Notification.permission : "unsupported");
  const [busy, setBusy] = useState(false);
  const [subError, setSubError] = useState(""); // 권한은 승인됐는데 서버 구독 저장이 실패한 경우

  const requestPerm = async () => {
    if (!supported) return;
    setBusy(true); setSubError("");
    try {
      if (pushReady && onEnablePush) {
        const ok = await onEnablePush();
        setPerm(ok ? "granted" : window.Notification.permission);
        // 권한 granted인데 서버 저장 실패 → 그대로 두면 "켜짐 ✓"로 보이면서 크론 푸시는
        // 영영 안 오는 침묵 실패가 됨 — 명시적으로 알린다
        if (!ok && window.Notification.permission === "granted") {
          setSubError("알림 서버 등록에 실패했어요 — 잠시 후 '알림 끄기' 후 다시 켜주세요");
        }
      } else {
        setPerm(await window.Notification.requestPermission());
      }
    } catch { /* 사용자 취소 */ }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true);
    try { if (onDisablePush) await onDisablePush(); } catch { /* 무시 */ }
    setPerm(supported ? window.Notification.permission : "unsupported");
    setBusy(false);
  };
  const test = () => {
    if (perm === "granted") { try { new window.Notification("Daniel Body Plan", { body: "테스트 알림이에요 🔔" }); } catch { /* ignore */ } }
  };
  const toggle = (k) => onChange({ ...cur, [k]: !cur[k] });

  const Tog = ({ on, onClick }) => (
    <div onClick={onClick} style={{ width: 42, height: 24, borderRadius: 12, background: on ? "#5a9e6f" : "#3a3a3a", position: "relative", cursor: "pointer", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", left: on ? 21 : 3 }} />
    </div>
  );

  const granted = perm === "granted";

  return (
    <div>
      {/* 권한 / 구독 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: granted ? "rgba(90,158,111,0.08)" : "#252525", border: `1px solid ${granted ? "rgba(90,158,111,0.22)" : "rgba(255,255,255,0.06)"}`, borderRadius: 12, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: granted ? "#5a9e6f" : "#f5f5f0" }}>
            {granted ? "알림 켜짐 ✓" : perm === "denied" ? "알림 차단됨" : perm === "unsupported" ? "이 브라우저는 알림 미지원" : "알림 꺼짐"}
          </div>
          <div style={{ fontSize: 10, color: "#707070", marginTop: 2, lineHeight: 1.4 }}>
            {perm === "denied" ? "브라우저 설정에서 이 사이트 알림을 허용하세요"
              : granted ? (pushReady ? "밤 8시에 앱을 닫아도 알림이 옵니다" : "인앱 배너로 알려줘요")
              : "켜면 앱을 닫아도 밤 8시에 리마인더가 옵니다"}
          </div>
        </div>
        {granted && <button onClick={test} disabled={busy} style={{ background: "#2a2a2a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#8a8a8a", fontSize: 12, padding: "8px 12px", cursor: "pointer", flexShrink: 0 }}>테스트</button>}
        {!granted && perm !== "denied" && perm !== "unsupported" && <button onClick={requestPerm} disabled={busy} style={{ background: "#d4af37", border: "none", borderRadius: 8, color: "#141414", fontSize: 12, fontWeight: 600, padding: "8px 14px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, flexShrink: 0 }}>{busy ? "…" : "알림 켜기"}</button>}
      </div>
      {subError && <div style={{ fontSize: 11, color: "#e05252", margin: "-6px 0 12px", lineHeight: 1.5 }}>{subError}</div>}

      {/* 토글 */}
      <div style={{ background: "#1e1e1e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden" }}>
        {ITEMS.map((it, i) => (
          <div key={it.key} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 14, borderBottom: i < ITEMS.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "#252525", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{it.ico}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{it.n}</div>
              <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 3, lineHeight: 1.45 }}>{it.d}</div>
            </div>
            <Tog on={cur[it.key] !== false} onClick={() => toggle(it.key)} />
          </div>
        ))}
      </div>

      {granted && pushReady && (
        <div onClick={turnOff} style={{ textAlign: "center", fontSize: 11, color: "#707070", marginTop: 10, cursor: "pointer", textDecoration: "underline" }}>알림 끄기(구독 해제)</div>
      )}

      <div style={{ fontSize: 10, color: "#707070", marginTop: 10, lineHeight: 1.6 }}>
        예약 푸시는 <b style={{ color: "#8a8a8a" }}>매일 밤 8시(KST)</b>에 한 번, 조건에 맞는 알림만 보냅니다. <b style={{ color: "#8a8a8a" }}>아이폰</b>은 홈 화면에 <b style={{ color: "#8a8a8a" }}>"설치"</b>해야 알림이 와요(iOS 16.4+). 안드로이드·데스크톱은 설치 없이도 동작.
      </div>
    </div>
  );
}
