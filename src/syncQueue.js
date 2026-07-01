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
