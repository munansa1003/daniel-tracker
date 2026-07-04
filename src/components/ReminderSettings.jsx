import { useState } from "react";

const ITEMS = [
  { key: "record", ico: "🍱", n: "기록 리마인더", d: "오늘 식단·운동을 아직 안 적었으면 앱 열 때 배너로 알림" },
  { key: "weight", ico: "⚖️", n: "체중 측정", d: "7일 이상 체중을 안 쟀으면 알림 (추세·적응형 정확도용)" },
  { key: "backup", ico: "💾", n: "백업 알림", d: "15일 이상 백업이 없으면 알림" },
];

// 알림 설정 — 권한 요청 + 테스트 발송 + 켤 리마인더 토글. (배너 자체는 홈에서 상태 기반으로 표시)
export function ReminderSettings({ reminders, onChange }) {
  const cur = { record: true, weight: true, backup: true, ...(reminders || {}) };
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [perm, setPerm] = useState(supported ? window.Notification.permission : "unsupported");

  const requestPerm = async () => {
    if (!supported) return;
    try { setPerm(await window.Notification.requestPermission()); } catch { /* 사용자 취소 */ }
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

  return (
    <div>
      {/* 권한 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: perm === "granted" ? "rgba(90,158,111,0.08)" : "#252525", border: `1px solid ${perm === "granted" ? "rgba(90,158,111,0.22)" : "rgba(255,255,255,0.06)"}`, borderRadius: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: perm === "granted" ? "#5a9e6f" : "#f5f5f0" }}>
            {perm === "granted" ? "알림 허용됨 ✓" : perm === "denied" ? "알림 차단됨" : perm === "unsupported" ? "이 브라우저는 알림 미지원" : "알림 권한 필요"}
          </div>
          <div style={{ fontSize: 10, color: "#707070", marginTop: 2 }}>
            {perm === "denied" ? "브라우저 설정에서 이 사이트 알림을 허용하세요" : "인앱 배너는 권한 없이도 떠요"}
          </div>
        </div>
        {perm === "granted" && <button onClick={test} style={{ background: "#2a2a2a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#8a8a8a", fontSize: 12, padding: "8px 12px", cursor: "pointer" }}>테스트</button>}
        {perm === "default" && <button onClick={requestPerm} style={{ background: "#d4af37", border: "none", borderRadius: 8, color: "#141414", fontSize: 12, fontWeight: 600, padding: "8px 14px", cursor: "pointer" }}>알림 켜기</button>}
      </div>

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
      <div style={{ fontSize: 10, color: "#707070", marginTop: 10, lineHeight: 1.6 }}>
        지금은 <b style={{ color: "#8a8a8a" }}>앱을 열 때</b> 상태에 맞춰 배너로 알려줘요. "저녁 8시"·"월요일 아침"처럼 <b style={{ color: "#8a8a8a" }}>앱을 닫아도 오는 푸시</b>는 다음 단계(FCM)입니다.
      </div>
    </div>
  );
}
