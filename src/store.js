// Firebase Firestore 기반 저장소 (다중 사용자 지원)
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

let _userId = null;

export function setUserId(id) {
  _userId = id;
  localStorage.setItem("dt_currentUser", id);
}

export function getCurrentUserId() {
  if (_userId) return _userId;
  const saved = localStorage.getItem("dt_currentUser");
  if (saved) { _userId = saved; return saved; }
  return null;
}

export function logout() {
  _userId = null;
  localStorage.removeItem("dt_currentUser");
}

// 프로필 목록 관리 (모든 사용자 공유 — 보안 규칙 호환 경로 사용)
export async function getProfiles() {
  try {
    const docRef = doc(db, "users", "_shared", "data", "profiles");
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const list = snap.data().list || [];
      localStorage.setItem("dt_profiles", JSON.stringify(list));
      return list;
    }
    // localStorage fallback
    const local = localStorage.getItem("dt_profiles");
    return local ? JSON.parse(local) : [];
  } catch (e) {
    console.error("getProfiles error:", e);
    const local = localStorage.getItem("dt_profiles");
    return local ? JSON.parse(local) : [];
  }
}

export async function saveProfiles(list) {
  try {
    await setDoc(doc(db, "users", "_shared", "data", "profiles"), { list, updatedAt: new Date().toISOString() });
    localStorage.setItem("dt_profiles", JSON.stringify(list));
  } catch (e) {
    console.error("saveProfiles error:", e);
    localStorage.setItem("dt_profiles", JSON.stringify(list));
  }
}

// 공용 음식 DB (모든 사용자 공유)
export async function getSharedFoods() {
  try {
    const docRef = doc(db, "users", "_shared", "data", "shared-foods");
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const list = snap.data().list || [];
      localStorage.setItem("dt_shared_foods", JSON.stringify(list));
      return list;
    }
    const local = localStorage.getItem("dt_shared_foods");
    return local ? JSON.parse(local) : [];
  } catch (e) {
    console.error("getSharedFoods error:", e);
    const local = localStorage.getItem("dt_shared_foods");
    return local ? JSON.parse(local) : [];
  }
}

export async function addSharedFood(food) {
  try {
    const current = await getSharedFoods();
    // 중복 체크 (이름이 같으면 추가 안함)
    const exists = current.some(f => f.n.trim().toLowerCase() === food.n.trim().toLowerCase());
    if (exists) return current;
    const updated = [...current, { ...food, addedAt: new Date().toISOString() }];
    await setDoc(doc(db, "users", "_shared", "data", "shared-foods"), { list: updated, updatedAt: new Date().toISOString() });
    localStorage.setItem("dt_shared_foods", JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error("addSharedFood error:", e);
    return null;
  }
}

export async function deleteSharedFood(idx) {
  try {
    const current = await getSharedFoods();
    const updated = current.filter((_, i) => i !== idx);
    await setDoc(doc(db, "users", "_shared", "data", "shared-foods"), { list: updated, updatedAt: new Date().toISOString() });
    localStorage.setItem("dt_shared_foods", JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error("deleteSharedFood error:", e);
    return null;
  }
}

const store = {
  async get(key) {
    const uid = getCurrentUserId();
    if (!uid) return null;
    try {
      const docRef = doc(db, "users", uid, "data", key);
      const snap = await getDoc(docRef);
      if (snap.exists()) return snap.data().value;
      const local = localStorage.getItem("dt_" + uid + "_" + key);
      if (local) {
        const parsed = JSON.parse(local);
        await setDoc(docRef, { value: parsed, updatedAt: new Date().toISOString() });
        return parsed;
      }
      return null;
    } catch (e) {
      const local = localStorage.getItem("dt_" + uid + "_" + key);
      return local ? JSON.parse(local) : null;
    }
  },

  async set(key, value) {
    const uid = getCurrentUserId();
    if (!uid) return false;
    try {
      await setDoc(doc(db, "users", uid, "data", key), { value, updatedAt: new Date().toISOString() });
      localStorage.setItem("dt_" + uid + "_" + key, JSON.stringify(value));
      return true;
    } catch (e) {
      localStorage.setItem("dt_" + uid + "_" + key, JSON.stringify(value));
      return false;
    }
  },

  async delete(key) {
    const uid = getCurrentUserId();
    if (!uid) return false;
    try {
      await deleteDoc(doc(db, "users", uid, "data", key));
      localStorage.removeItem("dt_" + uid + "_" + key);
      return true;
    } catch { return false; }
  },

  async list(prefix) {
    const uid = getCurrentUserId();
    if (!uid) return [];
    try {
      const colRef = collection(db, "users", uid, "data");
      const snap = await getDocs(colRef);
      const keys = [];
      snap.forEach(d => { if (d.id.startsWith(prefix)) keys.push(d.id); });
      return keys;
    } catch (e) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("dt_" + uid + "_" + prefix)) {
          keys.push(k.replace("dt_" + uid + "_", ""));
        }
      }
      return keys;
    }
  },

  // 기존 데이터 마이그레이션 (이전 user_xxx ID에서 새 ID로)
  async migrateFrom(oldUid) {
    const newUid = getCurrentUserId();
    if (!newUid || !oldUid) return;
    try {
      const colRef = collection(db, "users", oldUid, "data");
      const snap = await getDocs(colRef);
      for (const d of snap.docs) {
        await setDoc(doc(db, "users", newUid, "data", d.id), d.data());
      }
      console.log("Migration complete:", snap.docs.length, "docs");
    } catch (e) { console.error("Migration error:", e); }
  }
};

export default store;
