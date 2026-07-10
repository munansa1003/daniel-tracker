// src/auth.js — Firebase Auth 래퍼 (경로 B: 프로필 선택 → 진짜 로그인 전환).
// App.jsx·push.js가 firebase/auth를 직접 만지지 않고 이 모듈만 바라보게 하는 얇은 seam.
// (테스트는 이 모듈을 통째로 mock — happy-dom에서 firebase/auth를 로드하지 않기 위함)
import { auth } from "./firebase.js";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from "firebase/auth";

// 운영자(관리자) 이메일 — 초대 코드 없이 가입되고, 공용 DB 쓰기·레거시 마이그레이션 권한을 가진다.
// firestore.rules의 isOwner()와 반드시 같은 값이어야 함 (규칙은 env를 못 읽어 하드코딩).
export const OWNER_EMAIL = import.meta.env.VITE_OWNER_EMAIL || "munansa@gmail.com";

export function isOwnerEmail(email) {
  return !!email && email.toLowerCase() === OWNER_EMAIL.toLowerCase();
}

// 로그인 상태 구독. cb(firebaseUser | null). 반환값은 해지 함수.
// 오프라인 재시작 시에도 indexedDB에 저장된 세션으로 즉시 발화한다(offline-first 유지).
// onError: 리다이렉트 폴백 복귀가 실패했을 때(네트워크 등) 로그인 화면에 표시할 기회 제공.
export function watchAuth(cb, onError) {
  // 리다이렉트 폴백 복귀 시 결과 소모(로그인 자체는 onAuthStateChanged가 반영)
  getRedirectResult(auth).catch((e) => {
    console.error("redirect login error:", e);
    if (onError) onError(e);
  });
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // 팝업이 불가능한 환경(iOS PWA 등)만 리다이렉트로 폴백. 사용자가 닫은 경우는 그대로 전파.
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

export function signOutUser() {
  return signOut(auth);
}

// 서버(푸시 등)에 보낼 ID 토큰. 미로그인/오프라인 갱신 실패면 null (호출측은 조용히 스킵).
export async function getIdToken() {
  try {
    return auth.currentUser ? await auth.currentUser.getIdToken() : null;
  } catch {
    return null;
  }
}
