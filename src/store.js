// Firebase Firestore 기반 저장소 (다중 사용자 지원)
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { getPending, addPending, removePending } from "./syncQueue.js";

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

// ── 멤버십 (초대 코드 게이트, 경로 B) ──
// members/{uid} 문서가 있어야 개인 데이터 규칙이 통과한다. 코드 유효성 검증은
// 클라이언트가 아니라 보안 규칙이 수행(invites/{code}.active == true, 또는 운영자 이메일).
// 이전의 _shared/profiles(프로필 선택 목록)는 Firebase Auth가 대체해 제거됨.
export async function getMembership() {
  const uid = getCurrentUserId();
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "members", uid));
    if (snap.exists()) {
      localStorage.setItem("dt_" + uid + "_member", "1"); // 오프라인 시작용 캐시
      return snap.data();
    }
    return null; // 온라인으로 확인된 비멤버
  } catch {
    // 오프라인 등 조회 실패 — 이전에 확인된 멤버면 통과시켜 offline-first 유지
    return localStorage.getItem("dt_" + uid + "_member") === "1" ? { cached: true } : null;
  }
}

export async function joinWithInvite(code, email) {
  const uid = getCurrentUserId();
  if (!uid) return { ok: false, error: "no-user" };
  try {
    const data = { email: email || null, joinedAt: new Date().toISOString() };
    if (code) data.code = code.trim();
    // ⚠️ 순수 오프라인에서 setDoc은 reject가 아니라 무한 대기(§store.set 주석 참조).
    // 멤버 등록은 규칙 검증이 필수라 낙관적 성공 처리가 불가 → 타임아웃으로 탈출시켜
    // 게이트 UI가 "온라인 상태를 확인하세요"를 띄우게 한다. 대기 중이던 setDoc이
    // 온라인 복귀 후 성공해도 다음 시작의 getMembership이 문서를 발견하므로 무해.
    await Promise.race([
      setDoc(doc(db, "members", uid), data),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), 8000)),
    ]);
    localStorage.setItem("dt_" + uid + "_member", "1");
    return { ok: true };
  } catch (e) {
    // permission-denied = 유효하지 않은 초대 코드 (규칙이 invites/{code} 검증에서 거부)
    return { ok: false, error: (e && e.code) || "unknown" };
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

// 공용 운동 DB (모든 사용자 공유)
export async function getSharedExercises() {
  try {
    const docRef = doc(db, "users", "_shared", "data", "shared-exercises");
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const list = snap.data().list || [];
      localStorage.setItem("dt_shared_exercises", JSON.stringify(list));
      return list;
    }
    const local = localStorage.getItem("dt_shared_exercises");
    return local ? JSON.parse(local) : [];
  } catch (e) {
    console.error("getSharedExercises error:", e);
    const local = localStorage.getItem("dt_shared_exercises");
    return local ? JSON.parse(local) : [];
  }
}

export async function addSharedExercise(exercise) {
  try {
    const current = await getSharedExercises();
    const exists = current.some(e => e.n.trim().toLowerCase() === exercise.n.trim().toLowerCase());
    if (exists) return current;
    const updated = [...current, { ...exercise, addedAt: new Date().toISOString() }];
    await setDoc(doc(db, "users", "_shared", "data", "shared-exercises"), { list: updated, updatedAt: new Date().toISOString() });
    localStorage.setItem("dt_shared_exercises", JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error("addSharedExercise error:", e);
    return null;
  }
}

// ── 진행 사진 (개인) ──
// 경로: users/{uid}/data/photos/items/{id} — 기존 보안규칙(data/{document=**})에 맞고,
// getAllData(data 컬렉션 직속 문서만 조회)·localStorage 미러에 안 걸린다(용량 보호).
// 사진은 클라이언트에서 압축된 dataURL(≲300KB)로 문서당 1개 저장. JSON 백업엔 미포함.
export async function listProgressPhotos() {
  const uid = getCurrentUserId();
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "users", uid, "data", "photos", "items"));
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    return arr.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.ts || 0) - (b.ts || 0));
  } catch (e) {
    console.error("listProgressPhotos error:", e);
    return null; // 오류(오프라인 등) — 빈 목록과 구분
  }
}

export async function saveProgressPhoto(photo) {
  const uid = getCurrentUserId();
  if (!uid) return null;
  const id = `${photo.date}_${photo.ts}`;
  await setDoc(doc(db, "users", uid, "data", "photos", "items", id), photo);
  return id;
}

export async function deleteProgressPhoto(id) {
  const uid = getCurrentUserId();
  if (!uid) return false;
  await deleteDoc(doc(db, "users", uid, "data", "photos", "items", id));
  return true;
}

// 마이그레이션 병합 — 새 계정에 이미 생긴 값(current)과 레거시 값(legacy)을 키 성격별로 합친다.
// 원칙: 기록(배열·일별 문서)은 합집합(dedup), 설정(goals 등)은 7개월 축적된 레거시 우선.
// 모든 병합이 dedup 기반이라 재실행해도 결과 동일(멱등) — goals만 재실행 시 레거시로 회귀(모달 경고).
// 순수 함수 — migrate-merge.test.js가 멱등성·비파괴를 보호한다.
export function mergeMigrated(key, legacy, current) {
  if (current === undefined || current === null) return legacy;
  if (legacy === undefined || legacy === null) return current;
  if (key === "bodylog" && Array.isArray(legacy) && Array.isArray(current)) {
    const byDate = new Map();
    for (const e of legacy) if (e && e.date) byDate.set(e.date, e);
    for (const e of current) if (e && e.date) byDate.set(e.date, e); // 같은 날짜는 새 계정 기록 우선
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  if (key.startsWith("day:")) {
    const l = legacy || {}, c = current || {};
    const uniq = (arr) => {
      const seen = new Set(); const out = [];
      for (const m of arr) {
        const k = m && m.ts != null ? `${m.n}|${m.ts}` : JSON.stringify(m);
        if (!seen.has(k)) { seen.add(k); out.push(m); }
      }
      return out;
    };
    // 스프레드 순서: 새 계정 값(mode 스탬프 포함)이 우선, 항목 배열은 합집합
    return { ...l, ...c, meals: uniq([...(l.meals || []), ...(c.meals || [])]), exercises: uniq([...(l.exercises || []), ...(c.exercises || [])]) };
  }
  if ((key === "custom-foods" || key === "custom-exercises") && Array.isArray(legacy) && Array.isArray(current)) {
    const names = new Set(legacy.map(x => ((x && x.n) || "").trim().toLowerCase()));
    return [...legacy, ...current.filter(x => !names.has(((x && x.n) || "").trim().toLowerCase()))];
  }
  if (key === "lastBackup") return String(current) > String(legacy) ? current : legacy;
  if (key === "profile") return current; // 온보딩 입력 우선 (레거시 구조엔 profile 문서 없음)
  return legacy; // goals 등 설정류 — 레거시(모드·tdeeHistory·리마인더) 우선
}

// 마이그레이션 완료 마커 — 데이터 프리픽스(dt_{uid}_*) 밖에 둬 getLocalAll 오염 방지
export function getMigratedMark() {
  const uid = getCurrentUserId();
  if (!uid) return null;
  try { return JSON.parse(localStorage.getItem("dt_migrated_" + uid) || "null"); } catch { return null; }
}

const store = {
  async get(key) {
    const uid = getCurrentUserId();
    if (!uid) return null;
    try {
      const docRef = doc(db, "users", uid, "data", key);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const v = snap.data().value;
        // localStorage 미러 갱신 — 두 번째 기기가 getAllData 전에 종료돼도
        // 오프라인 재시작 체인(예: profile → 온보딩 오판)이 끊기지 않게 (getAllData와 동일 정책)
        try { localStorage.setItem("dt_" + uid + "_" + key, JSON.stringify(v)); } catch { /* 용량 등 무시 */ }
        return v;
      }
      const local = localStorage.getItem("dt_" + uid + "_" + key);
      if (local) {
        const parsed = JSON.parse(local);
        await setDoc(docRef, { value: parsed, updatedAt: new Date().toISOString() });
        return parsed;
      }
      return null;
    } catch (e) {
      try {
        const local = localStorage.getItem("dt_" + uid + "_" + key);
        return local ? JSON.parse(local) : null;
      } catch { return null; } // 손상된 로컬 캐시 — 시작 체인을 끊지 않는다
    }
  },

  async set(key, value) {
    const uid = getCurrentUserId();
    if (!uid) return false;
    // 로컬 먼저 + 큐 선등록 (순서 중요): Firestore SDK는 순수 오프라인에서 setDoc을
    // reject가 아니라 '무한 대기'시킨다. await 뒤에 두면 오프라인 중 앱 종료 시
    // 로컬 기록·큐 등록이 모두 증발해 그 항목이 유실된다. 성공하면 바로 아래서
    // 대기분을 해소하므로 순서 변경의 부작용은 없다(같은 값 기록, last-write-wins).
    localStorage.setItem("dt_" + uid + "_" + key, JSON.stringify(value));
    addPending(uid, key);
    try {
      await setDoc(doc(db, "users", uid, "data", key), { value, updatedAt: new Date().toISOString() });
      removePending(uid, key); // 서버 반영 확인 → 대기분 해소
      return true;
    } catch {
      return false; // 큐에 남아 다음 시작/online 이벤트에 재시도
    }
  },

  // 오프라인 대기분 재전송 — 반드시 getAllData "이전"에 호출할 것.
  // (getAllData가 Firestore 값으로 localStorage를 덮으므로, 순서가 바뀌면 오프라인 수정이 옛값으로 회귀)
  // 전송 값은 항상 localStorage의 현재 값 = 최신 진실. 실패한 키는 큐에 남아 다음 기회에 재시도.
  async flushPendingSync() {
    const uid = getCurrentUserId();
    if (!uid) return 0;
    let synced = 0;
    try {
      for (const key of getPending(uid)) {
        const raw = localStorage.getItem("dt_" + uid + "_" + key);
        if (raw === null) { removePending(uid, key); continue; } // 로컬 값이 사라졌으면 대기열만 정리
        try {
          await setDoc(doc(db, "users", uid, "data", key), { value: JSON.parse(raw), updatedAt: new Date().toISOString() });
          removePending(uid, key);
          synced++;
        } catch { /* 여전히 오프라인 — 큐에 남겨 다음 시작/online 이벤트에 재시도 */ }
      }
    } catch (e) { console.error("flushPendingSync error:", e); }
    return synced;
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

  // localStorage에서 동기적으로 전체 데이터 읽기 (즉시 표시용)
  getLocalAll() {
    const uid = getCurrentUserId();
    if (!uid) return {};
    const result = {};
    try {
      const prefix = "dt_" + uid + "_";
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          const dataKey = k.slice(prefix.length);
          try { result[dataKey] = JSON.parse(localStorage.getItem(k)); } catch {}
        }
      }
    } catch {}
    return result;
  },

  // Firestore에서 ONE getDocs로 전체 데이터 읽기 (백그라운드 동기화용)
  async getAllData() {
    const uid = getCurrentUserId();
    if (!uid) return {};
    try {
      const colRef = collection(db, "users", uid, "data");
      const snap = await getDocs(colRef);
      const result = {};
      snap.forEach(d => {
        const val = d.data().value;
        if (val !== undefined) {
          result[d.id] = val;
          // localStorage 캐시도 갱신
          try { localStorage.setItem("dt_" + uid + "_" + d.id, JSON.stringify(val)); } catch {}
        }
      });
      return result;
    } catch (e) {
      console.error("getAllData error:", e);
      // Firestore 실패 시 localStorage 폴백
      return this.getLocalAll();
    }
  },

  // 레거시(프로필 선택 시절) uid → Auth uid 데이터 마이그레이션.
  // 규칙상 레거시 경로 읽기는 운영자 이메일만 허용(firestore.rules의 isOwner 참조).
  // Firestore 실패는 throw — 호출측(설정 모달)이 권한/네트워크 오류를 구분해 안내한다.
  //
  // ⚠️ 멱등·비파괴 원칙: 새 계정에 이미 생긴 기록(전환 당일 점심 기록, 체중 입력 등)을
  // 레거시 값으로 덮어쓰지 않는다. 키 성격별 병합 — mergeMigrated() 참조. 재실행해도
  // 결과가 같도록 병합은 전부 dedup 기반(재실행 시 goals만 레거시 우선이라 모달에서 경고).
  async migrateFrom(oldUid) {
    const newUid = getCurrentUserId();
    if (!newUid || !oldUid || newUid === oldUid) return { copied: 0, photos: 0, local: 0 };
    let copied = 0, photos = 0, local = 0;
    const seen = new Set();

    // 1) data 컬렉션 직속 문서를 "병합해서" 복사 + localStorage 캐시 갱신(재로드 시 즉시 표시)
    const [snap, newSnap] = await Promise.all([
      getDocs(collection(db, "users", oldUid, "data")),
      getDocs(collection(db, "users", newUid, "data")),
    ]);
    const currentVals = new Map();
    newSnap.forEach(d => { if (d.data().value !== undefined) currentVals.set(d.id, d.data().value); });
    // 새 uid에서 아직 서버 미반영(pending)인 키는 localStorage가 더 최신 — 그 값을 현재값으로 사용
    const newPending = new Set(getPending(newUid));
    for (const k of newPending) {
      try {
        const raw = localStorage.getItem("dt_" + newUid + "_" + k);
        if (raw !== null) currentVals.set(k, JSON.parse(raw));
      } catch { /* 무시 */ }
    }
    for (const d of snap.docs) {
      const legacyVal = d.data().value;
      const cur = currentVals.get(d.id);
      let toWrite;
      if (legacyVal === undefined) {
        if (cur !== undefined) continue; // 이상 문서 + 새 값 존재 → 건드리지 않음
        await setDoc(doc(db, "users", newUid, "data", d.id), d.data());
        seen.add(d.id); copied++;
        continue;
      }
      toWrite = cur === undefined ? legacyVal : mergeMigrated(d.id, legacyVal, cur);
      await setDoc(doc(db, "users", newUid, "data", d.id), { value: toWrite, updatedAt: new Date().toISOString() });
      seen.add(d.id);
      try { localStorage.setItem("dt_" + newUid + "_" + d.id, JSON.stringify(toWrite)); } catch { /* 용량 초과 등 무시 */ }
      copied++;
    }

    // 2) 진행 사진은 서브컬렉션(data/photos/items)이라 위 getDocs에 안 잡힘 — 별도 복사
    try {
      const psnap = await getDocs(collection(db, "users", oldUid, "data", "photos", "items"));
      for (const d of psnap.docs) {
        await setDoc(doc(db, "users", newUid, "data", "photos", "items", d.id), d.data());
        photos++;
      }
    } catch (e) { console.error("Migration photos error:", e); }

    // 3) 같은 기기의 레거시 localStorage 중 서버에 없거나(pending) 미동기화였던 값 승계.
    //    서버 사본이 있는 키는 1)에서 이미 최신을 받았으므로 건너뜀. member/createdAt/
    //    body-coaching은 JSON 데이터가 아닌 로컬 메타/캐시라 pending 대상에서 제외.
    try {
      const pending = new Set(getPending(oldUid));
      const skip = new Set(["member", "createdAt", "body-coaching"]);
      const prefix = "dt_" + oldUid + "_";
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k.slice(prefix.length));
      }
      for (const dataKey of keys) {
        if (skip.has(dataKey)) continue;
        if (seen.has(dataKey) && !pending.has(dataKey)) continue; // 서버 사본이 진실
        const raw = localStorage.getItem(prefix + dataKey);
        if (raw === null) continue;
        let legacyLocal;
        try { legacyLocal = JSON.parse(raw); } catch { continue; } // JSON 아닌 로컬 캐시는 제외
        // 1단계가 만든 병합 결과(또는 새 계정 값)가 있으면 그 위에 다시 병합 — 덮어쓰기 금지
        let merged = legacyLocal;
        try {
          const curRaw = localStorage.getItem("dt_" + newUid + "_" + dataKey);
          if (curRaw !== null) merged = mergeMigrated(dataKey, legacyLocal, JSON.parse(curRaw));
        } catch { /* 현재 값 파싱 실패 — 레거시 값 사용 */ }
        localStorage.setItem("dt_" + newUid + "_" + dataKey, JSON.stringify(merged));
        addPending(newUid, dataKey);
        local++;
      }
      // 계정 생성일(로컬 메타)은 원 계정 값을 승계 — 백업 리마인더 성숙 판정 유지
      const oldCreated = localStorage.getItem(prefix + "createdAt");
      if (oldCreated) localStorage.setItem("dt_" + newUid + "_createdAt", oldCreated);
      if (local) await this.flushPendingSync();
    } catch (e) { console.error("Migration local carry error:", e); }

    // 완료 마커 — 재실행 시 모달이 "goals가 레거시로 회귀할 수 있음"을 경고하는 근거
    try { localStorage.setItem("dt_migrated_" + newUid, JSON.stringify({ oldUid, at: new Date().toISOString() })); } catch { /* 무시 */ }

    return { copied, photos, local };
  }
};

export default store;
