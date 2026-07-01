import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: "AIzaSyDnY73MnZviHLP1W-hE7fsamOqL35lpyRc",
  authDomain: "daniel-tracker-cb781.firebaseapp.com",
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
