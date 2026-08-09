// 오프라인 쓰기 재동기화 대기열 — Firestore 쓰기 실패한 "키 이름만" 보관한다.
// 값을 저장하지 않는 이유(핵심 설계): 전송 시점에 localStorage의 현재 값을 읽어 보내므로
// "실패 시점의 낡은 값이 나중의 수정을 덮어쓰는" 사고가 구조적으로 불가능하다.
// 저장 키는 데이터 프리픽스(dt_<uid>_*) 밖에 두어 getLocalAll/getAllData 순회를 오염시키지 않는다.
// firebase 의존 없음 — 단독 테스트 가능(sync-queue.test.jsx).

const qKey = (uid) => "dt_pendingSync_" + uid;

export function getPending(uid) {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(qKey(uid));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function addPending(uid, key) {
  if (!uid || !key) return;
  try {
    const list = getPending(uid);
    if (!list.includes(key)) {
      list.push(key);
      localStorage.setItem(qKey(uid), JSON.stringify(list));
    }
  } catch {}
}

export function removePending(uid, key) {
  if (!uid) return;
  try {
    const list = getPending(uid);
    const next = list.filter((k) => k !== key);
    if (next.length !== list.length) localStorage.setItem(qKey(uid), JSON.stringify(next));
  } catch {}
}

/* ── 삭제 흔적(tombstone) — 2026-08 감사 R-02 ──────────────────────────
   bodylog·body-drafts는 배열/맵 하나가 문서 하나다. 오프라인에서 만든 기록을 재전송할 때
   문서를 통째로 덮으면 그 사이 다른 기기가 확정한 날이 사라진다(자동 확정은 앱을 여는
   것만으로 쓰기가 일어나 이 창이 넓다). 그래서 재전송 시 원격 값과 날짜 단위로 합친다.

   그런데 합치기만 하면 반대 사고가 생긴다 — 오프라인에서 **지운** 기록이 원격에 남아 있어
   되살아난다. 그래서 "사용자가 명시적으로 지운 것"만 흔적으로 남겨 합치기에서 제외한다.
   (병합·스윕이 자동으로 치우는 초안은 흔적 대상이 아니다 — 어차피 되돌아오지 않는다)

   저장 키는 데이터 프리픽스 밖이라 getLocalAll/getAllData 순회에 섞이지 않는다.
   기기 로컬이면 충분하다: 이 기기의 재전송이 남의 기록을 지우지 않게 하는 것이 목적이고,
   삭제 자체는 그 재전송 결과(원격 문서)로 다른 기기에 전파된다. */
const tKey = (uid) => "dt_tombstones_" + uid;
export const TOMBSTONE_TTL_DAYS = 60;

function readTombstones(uid) {
  try {
    const raw = localStorage.getItem(tKey(uid));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((t) => t && typeof t.k === "string" && typeof t.id === "string") : [];
  } catch {
    return [];
  }
}

export function addTombstone(uid, key, id, now = Date.now()) {
  if (!uid || !key || !id) return;
  try {
    const cutoff = now - TOMBSTONE_TTL_DAYS * 86400000;
    const kept = readTombstones(uid).filter((t) => (t.at || 0) >= cutoff && !(t.k === key && t.id === id));
    kept.push({ k: key, id, at: now });
    localStorage.setItem(tKey(uid), JSON.stringify(kept));
  } catch {}
}

// 그 키에서 "지운 것으로 기억되는" id 집합 (기한 지난 흔적은 제외)
export function getTombstoneIds(uid, key, now = Date.now()) {
  if (!uid || !key) return new Set();
  const cutoff = now - TOMBSTONE_TTL_DAYS * 86400000;
  return new Set(readTombstones(uid).filter((t) => t.k === key && (t.at || 0) >= cutoff).map((t) => t.id));
}
