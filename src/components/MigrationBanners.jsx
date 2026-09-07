// src/components/MigrationBanners.jsx — 원점 이전 안내 배너 2종 (홈 상단).
//
// 순수 표시 컴포넌트다. "언제 보이는가"는 src/migrationBanners.js의 순수 함수가 정하고,
// 여기서는 그 판단을 받아 그리기만 한다(홈의 다른 배너들과 같은 모양·같은 자리).
// 둘 다 조건이 아니면 아무것도 렌더하지 않는다 — 변수가 없는 현재 Vercel 앱은 무변경이다.
import { shouldShowOriginBanner, shouldShowPushBanner } from "../migrationBanners.js";

const CARD = {
  borderRadius: 16,
  padding: 12,
  marginBottom: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

export function MigrationBanners({
  newOrigin,
  hostname,
  dismissedOn,
  todayStr,
  onDismissOrigin,
  pushReady,
  hasSubscription,
  reminders,
  onEnablePush,
}) {
  const showOrigin = shouldShowOriginBanner({ newOrigin, hostname, dismissedOn, todayStr });
  const showPush = shouldShowPushBanner({ pushReady, hasSubscription, reminders });
  if (!showOrigin && !showPush) return null;

  return (
    <>
      {showOrigin && (
        <div style={{ ...CARD, background: "rgba(74,143,201,0.1)", border: "1px solid rgba(74,143,201,0.25)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "#4a8fc9", fontWeight: 500 }}>새 주소로 이동해 주세요</div>
            <div style={{ fontSize: 11, color: "#707070", marginTop: 2, lineHeight: 1.5, wordBreak: "break-all" }}>
              {newOrigin} · 새 주소에서 <b style={{ color: "#8a8a8a" }}>홈 화면에 추가</b>한 뒤 이 앱은 지워 주세요.
              이 주소는 곧 문을 닫습니다.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <a
              href={newOrigin}
              style={{ background: "#4a8fc9", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#fff", fontWeight: 500, textDecoration: "none" }}
            >
              열기
            </a>
            <button
              onClick={onDismissOrigin}
              aria-label="오늘 하루 안 보기"
              style={{ background: "#2a2a2a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#8a8a8a", fontSize: 12, padding: "8px 10px", cursor: "pointer" }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {showPush && (
        <div style={{ ...CARD, background: "rgba(212,175,55,0.1)", border: "1px solid rgba(212,175,55,0.25)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "#d4af37", fontWeight: 500 }}>알림을 다시 켜주세요</div>
            {/* 순서가 중요하다: 새 주소에서 먼저 켜고 옛 앱을 로그아웃하면, 옛 앱의 로그아웃이
                방금 만든 새 구독을 지운다(App의 로그아웃 경로가 disablePush를 부른다). */}
            <div style={{ fontSize: 11, color: "#707070", marginTop: 2, lineHeight: 1.5 }}>
              알림은 주소마다 따로 등록돼요. <b style={{ color: "#8a8a8a" }}>옛 앱에서 먼저 로그아웃</b>한 다음 여기서 켜주세요.
            </div>
          </div>
          <button
            onClick={onEnablePush}
            style={{ background: "#d4af37", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#141414", fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
          >
            켜기
          </button>
        </div>
      )}
    </>
  );
}
