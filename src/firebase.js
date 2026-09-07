import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// authDomain만 빌드 변수로 교체 가능하게 둔다(DR-12).
//
// 왜: Google 로그인의 **redirect 폴백**은 authDomain이 앱 도메인과 다르면 서드파티 저장소를
// 차단하는 브라우저(대표적으로 iOS 홈 화면 앱)에서 실패한다. Firebase Hosting 위에서는
// `/__/auth/**`가 예약 경로로 자동 제공되므로, 앱과 같은 도메인을 authDomain으로 두면
// 그 실패가 구조적으로 사라진다.
//
// 값이 없으면 기존 도메인 그대로다 — Vercel에는 이 변수를 두지 않으므로 옛 원점은 무변경.
// 값을 넣을 때는 [콘솔] 두 곳이 함께 가야 한다(둘 중 하나만 하면 로그인이 깨진다):
//   ① Firebase Authentication → Authorized domains 에 그 도메인
//   ② GCP OAuth 클라이언트의 승인된 리디렉션 URI에 https://<도메인>/__/auth/handler
const firebaseConfig = {
  apiKey: "AIzaSyDnY73MnZviHLP1W-hE7fsamOqL35lpyRc",
  authDomain: import.meta.env.VITE_AUTH_DOMAIN || "daniel-tracker-cb781.firebaseapp.com",
  projectId: "daniel-tracker-cb781",
  storageBucket: "daniel-tracker-cb781.firebasestorage.app",
  messagingSenderId: "418220594110",
  appId: "1:418220594110:web:9304a8af3673a917939fef"
};

const app = initializeApp(firebaseConfig);

// App Check (reCAPTCHA v3) — 외부 SDK 직접 호출 차단
// 환경변수 VITE_RECAPTCHA_SITE_KEY가 빌드 시 주입되어야 활성화됨
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

// 개발 환경에선 디버그 토큰 활성화 (브라우저 콘솔에 토큰 출력 → Firebase 콘솔에 등록)
if (import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

if (RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.error("App Check init failed:", e);
  }
} else if (import.meta.env.PROD) {
  console.warn("VITE_RECAPTCHA_SITE_KEY not set — App Check disabled");
}

export const db = getFirestore(app);
// Firebase Auth (경로 B: 프로필 선택 → 진짜 로그인). 세션은 기본 indexedDB 지속 —
// 오프라인 재시작 시에도 onAuthStateChanged가 저장된 사용자를 복원한다.
export const auth = getAuth(app);
