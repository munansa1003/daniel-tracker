// Firebase Firestore 기반 저장소 (기기 간 동기화)
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

// 고유 사용자 ID (기기 공통으로 같은 데이터 접근)
function getUserId() {
  let uid = localStorage.getItem("dt_userId");
  if (!uid) {
    uid = "user_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("dt_userId", uid);
  }
  return uid;
}

// 다른 기기에서 같은 데이터를 보려면 같은 userId 설정
export function setUserId(id) {
  localStorage.setItem("dt_userId", id);
}

export function getCurrentUserId() {
  return getUserId();
}

const store = {
  async get(key) {
    try {
      const uid = getUserId();
      const docRef = doc(db, "users", uid, "data", key);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data().value;
      }
      // Fallback: localStorage 마이그레이션
      const local = localStorage.getItem("dt_" + key);
      if (local) {
        const parsed = JSON.parse(local);
        await setDoc(docRef, { value: parsed, updatedAt: new Date().toISOString() });
        return parsed;
      }
      return null;
    } catch (e) {
      console.error("Firebase get error:", e);
      const local = localStorage.getItem("dt_" + key);
      return local ? JSON.parse(local) : null;
    }
  },

  async set(key, value) {
    try {
      const uid = getUserId();
      const docRef = doc(db, "users", uid, "data", key);
      await setDoc(docRef, { value, updatedAt: new Date().toISOString() });
      localStorage.setItem("dt_" + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error("Firebase set error:", e);
      localStorage.setItem("dt_" + key, JSON.stringify(value));
      return false;
    }
  },

  async delete(key) {
    try {
      const uid = getUserId();
      await deleteDoc(doc(db, "users", uid, "data", key));
      localStorage.removeItem("dt_" + key);
      return true;
    } catch { return false; }
  },

  async list(prefix) {
    try {
      const uid = getUserId();
      const colRef = collection(db, "users", uid, "data");
      const snap = await getDocs(colRef);
      const keys = [];
      snap.forEach(d => {
        if (d.id.startsWith(prefix)) keys.push(d.id);
      });
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("dt_" + prefix)) {
          const cleanKey = k.replace("dt_", "");
          if (!keys.includes(cleanKey)) keys.push(cleanKey);
        }
      }
      return keys;
    } catch (e) {
      console.error("Firebase list error:", e);
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("dt_" + prefix)) {
          keys.push(k.replace("dt_", ""));
        }
      }
      return keys;
    }
  }
};

export default store;
