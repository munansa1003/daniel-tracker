import { useState } from "react";
import { THEME } from "../theme.jsx";
import { APP_NAME } from "../data.js";

// ── 인앱 브라우저 감지 (카톡·인스타·페북·네이버·라인 등) ──
// Google OAuth는 WebView 로그인을 전면 차단한다(403 disallowed_useragent — 호스트 앱이
// 로그인 화면을 읽거나 조작할 수 있는 구조라 피싱 방지 차원). 초대 링크가 주로 카톡으로
// 전달되므로, 감지 시 배너 + 외부 브라우저 탈출 버튼을 보여준다.
function getInAppBrowser() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  if (/KAKAOTALK/i.test(ua)) return "kakao";
  if (/Instagram|FBAN|FBAV|FB_IAB/i.test(ua)) return "meta";
  if (/NAVER\(inapp|DaumApps|Line\//i.test(ua)) return "portal";
  if (/; wv\)/.test(ua)) return "webview"; // 안드로이드 일반 WebView 마커
  return null;
}

// 외부(기본) 브라우저로 현재 주소 열기 — 카톡은 공식 스킴, 안드로이드는 Chrome intent.
// iOS의 기타 인앱은 강제 이동 수단이 없어 주소 복사 버튼이 폴백.
function openExternalBrowser() {
  const url = window.location.href;
  const ua = navigator.userAgent || "";
  if (/KAKAOTALK/i.test(ua)) {
    window.location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(url);
    return;
  }
  if (/android/i.test(ua)) {
    window.location.href = "intent://" + window.location.host + window.location.pathname + "#Intent;scheme=https;package=com.android.chrome;end";
  }
}

// 로그인 화면 (경로 B · 컨셉 G+C 확정) — 실측 철학 카피가 히어로(좌측 정렬, C안),
// 하단엔 체중 라인 + 7일 이동평균 + 목표 밴드의 정적 추세 그래픽(G안)을 은은하게 깐다.
// 인증·세션은 Firebase Auth가 전담하고, 이 컴포넌트는 버튼과 오류 표시만 담당한다.
// 이전 구현의 프로필 목록·PBKDF2 비밀번호·마스터키(/api/verify-master)는 Auth 도입으로 제거됨.

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// 추세 띠 — 체중 라인(흰) + 7일 이동평균(골드) + 목표 밴드. 데이터 없이 그려지는
// 결정적 장식(무작위 아님). 로그인은 앱 본체보다 먼저 뜨는 화면이라 recharts를 끌어오지
// 않고 정적 SVG로 그린다. 카피와 버튼 "사이"의 독립 블록이라 어떤 요소와도 겹치지 않고,
// 위·아래 페이드로 배경에 떠 있는 것처럼 섞인다.
function TrendStrip() {
  return (
    <div aria-hidden="true" style={{ position: "relative", height: 140, margin: "0 -24px 20px", pointerEvents: "none" }}>
      <svg width="100%" height="140" viewBox="0 0 300 250" preserveAspectRatio="none" style={{ display: "block" }}>
        {[60, 110, 160, 210].map(y => <line key={y} x1="0" y1={y} x2="300" y2={y} stroke="rgba(255,255,255,0.05)" />)}
        <polygon points="0,88 300,158 300,216 0,142" fill="rgba(212,175,55,0.09)" />
        <polyline points="0,96 30,128 60,106 90,146 120,124 150,160 180,138 210,170 240,150 270,184 300,164" fill="none" stroke="rgba(245,245,240,0.38)" strokeWidth="1.5" />
        <polyline points="0,110 50,118 100,130 150,142 200,154 250,164 300,172" fill="none" stroke="#d4af37" strokeWidth="2" opacity="0.65" />
        <circle cx="90" cy="146" r="2" fill="rgba(245,245,240,0.55)" />
        <circle cx="180" cy="138" r="2" fill="rgba(245,245,240,0.55)" />
        <circle cx="300" cy="172" r="3.5" fill="#d4af37" opacity="0.85" />
      </svg>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #141414 0%, rgba(20,20,20,0) 38%, rgba(20,20,20,0) 62%, #141414 100%)" }} />
    </div>
  );
}

export function LoginScreen({ onGoogle, externalError }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const inApp = getInAppBrowser(); // UA는 세션 중 불변 — 상태 불필요

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* 클립보드 미지원 인앱 — 안내 문구가 폴백 */ }
  };

  const handleClick = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await onGoogle();
      // 성공 — watchAuth의 멤버십 판정이 끝나 화면이 전환(언마운트)될 때까지 busy 유지.
      // 여기서 풀면 느린 네트워크에서 "로그인이 안 됐다"로 오인하고 재시도하게 된다.
      // (리다이렉트 폴백이면 페이지 이탈이라 어차피 무관)
    } catch (e) {
      const code = e && e.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // 사용자가 취소 — 오류 아님
      } else if (code === "auth/network-request-failed") {
        setError("네트워크 오류 — 온라인 상태를 확인하세요");
      } else {
        setError("로그인에 실패했어요. 잠시 후 다시 시도해주세요.");
        console.error("login error:", e);
      }
      setBusy(false);
    }
  };

  const shownError = error || externalError;

  return (
    <div style={{ background: THEME.bg, color: THEME.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", padding: "26px 24px 30px", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
      {/* 상단 브랜드 (초대·온보딩 화면과 공통 모티프) */}
      <div className="dbp-fade" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: THEME.gold }} />
        <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.5px" }}>{APP_NAME}</span>
      </div>

      {/* 히어로 카피 — 이 앱의 차별점(실측 캘리브레이션 철학)을 정면에 */}
      <div className="dbp-fade-d1" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 30, lineHeight: 1.42, fontWeight: 600, letterSpacing: "-0.8px" }}>
          공식을 믿지 말고,<br /><span style={{ color: THEME.gold }}>실측으로</span> 보정하라.
        </div>
        <div style={{ width: 34, height: 2, background: THEME.gold, opacity: 0.7, margin: "20px 0 14px" }} />
        <div style={{ fontSize: 12, color: THEME.sub, lineHeight: 1.75 }}>
          7개월의 실사용 데이터로 다듬은<br />식단 · 운동 · 체성분 기록 도구.
        </div>
      </div>

      {/* 추세 띠 — 카피와 버튼 사이 (버튼·안내문과 겹치지 않음) */}
      <TrendStrip />

      {/* 인앱 브라우저 경고 — Google이 WebView 로그인을 차단하므로 탈출 경로 제공 */}
      {inApp && (
        <div style={{ background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.35)", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: THEME.gold, marginBottom: 6 }}>
            {inApp === "kakao" ? "카카오톡" : "이 앱의 내장"} 브라우저에서는 Google 로그인이 차단돼요
          </div>
          <div style={{ fontSize: 11.5, color: THEME.sub, lineHeight: 1.65, marginBottom: 10 }}>
            Google 보안 정책이에요. Chrome이나 Safari 같은 일반 브라우저로 열면 정상 로그인됩니다.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(inApp === "kakao" || /android/i.test(navigator.userAgent || "")) && (
              <button onClick={openExternalBrowser} className="dbp-btn"
                style={{ flex: 1, padding: "11px 12px", background: THEME.gold, border: "none", borderRadius: 10, color: "#141414", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                기본 브라우저로 열기
              </button>
            )}
            <button onClick={copyUrl} className="dbp-btn"
              style={{ flex: 1, padding: "11px 12px", background: "transparent", border: `1px solid ${THEME.borderLight}`, borderRadius: 10, color: THEME.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {copied ? "복사됨! 브라우저에 붙여넣으세요" : "주소 복사"}
            </button>
          </div>
        </div>
      )}

      <div className="dbp-fade-d2">
        <button onClick={handleClick} disabled={busy} className="dbp-btn"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", padding: "14px 20px", background: "transparent", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 14, color: THEME.text, fontSize: 15, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>
          <GoogleLogo />
          {busy ? "로그인 중..." : "Google로 계속하기"}
        </button>
        {shownError && <div style={{ fontSize: 12, color: "#e05252", marginTop: 12, textAlign: "center" }}>{shownError}</div>}
        <div style={{ fontSize: 11, color: THEME.sub, marginTop: 16, lineHeight: 1.7, textAlign: "center" }}>
          초대받은 사용자만 이용할 수 있어요. 로그인 후 초대 코드를 입력합니다.
        </div>
      </div>
    </div>
  );
}
