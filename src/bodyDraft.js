// src/bodyDraft.js — 체성분 사서함 → "완성 대기 초안" 병합·잠금 (순수 로직).
//
// 운동의 importMerge.js와 같은 위치의 자매 모듈 — day 문서가 아니라 별도 저장 키
// "body-drafts"({ "YYYY-MM-DD": { weight, fatPct, lbm, sampleTs, receivedAt } })를 다룬다.
// bodylog·day 문서는 여기서 절대 쓰지 않는다: 초안이 bodylog 밖에 있는 것 자체가
// "muscle 미입력이 골격근 통계에 0으로 오염되면 안 된다"는 불변 조건의 구현이다.
//
// 잠금(집행 지점은 병합 계층 — 서버는 확정 여부를 모른다):
//   bodylog에 그 날짜 레코드가 이미 있으면(자동 확정이든 수동 선입력이든) 도착한 초안은
//   폐기하고 ack만 한다. 수동으로 먼저 입력한 날 = 같은 잠금.
// 갱신(B2): 같은 날 더 최신 sampleTs 항목이 오면 존재하는 필드만 겹쳐 쓴다(부분 수신 B8 대응).
// 스윕: 호출 때마다 (a) 확정된 날짜의 잔존 초안 제거 — 다중 기기에서 낡은 초안이
//   flushPendingSync로 부활하는 유령을 재동기화 시점에 청소, (b) 보존 기한(30일) 지난
//   초안·항목은 착지 없이 정리 — 사서함·저장소 무한 적체 방지.
// 골격근 자동 기입 절대 금지: 이 모듈은 muscle을 만들지도, bodylog를 만들지도 않는다.
export const DRAFT_RETENTION_DAYS = 30;

// LBM 오타 가드 — 297일 실측 SMM/LBM ≈ 0.56~0.58(매우 안정). 경고 전용, 차단 아님.
// lbm이 없는 날은 가드 생략(warn:false, ratio:null).
export const SMM_LBM_MIN = 0.53;
export const SMM_LBM_MAX = 0.61;
export function checkSmmLbm(muscle, lbm) {
  if (!(muscle > 0) || !(lbm > 0)) return { ratio: null, warn: false };
  const ratio = Math.round((muscle / lbm) * 100) / 100;
  return { ratio, warn: ratio < SMM_LBM_MIN || ratio > SMM_LBM_MAX };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = ["weight", "fatPct", "lbm"];

function retentionCutoff(todayStr) {
  const d = new Date(todayStr + "T12:00:00");
  d.setDate(d.getDate() - DRAFT_RETENTION_DAYS);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// drafts: 현재 초안 맵, bodyLog: 확정 레코드 배열, entries: 사서함 pull 결과.
// 반환: { drafts, ackKeys, changed } — drafts는 새 맵(입력 불변), ackKeys는 사서함에서
// 지워도 되는 field 키 전부(이번 착지 + 잠금 폐기 + 기한 초과 + 구조적 쓰레기).
export function mergeBodyDrafts(drafts, bodyLog, entries, { todayStr = "" } = {}) {
  const next = { ...(drafts || {}) };
  const ackKeys = [];
  let changed = false;
  const confirmed = new Set((bodyLog || []).map((b) => b && b.date).filter(Boolean));
  const cutoff = todayStr ? retentionCutoff(todayStr) : "";

  // 스윕 — 확정된 날짜·기한 지난 초안 제거 (항목 도착과 무관하게 매 동기화마다)
  for (const date of Object.keys(next)) {
    if (confirmed.has(date) || (cutoff && date < cutoff)) { delete next[date]; changed = true; }
  }

  for (const entry of entries || []) {
    if (!entry || typeof entry.key !== "string" || !entry.key) continue; // key 없으면 ack 대상 특정 불가
    if (!DATE_RE.test(entry.date || "") || !Number.isFinite(entry.sampleTs)) {
      ackKeys.push(entry.key); // 우리 사서함의 구조적 쓰레기 — 잔류시키지 않는다
      continue;
    }
    const hasField = FIELDS.some((f) => Number.isFinite(entry[f]) && entry[f] > 0);
    if (!hasField) { ackKeys.push(entry.key); continue; }

    // 잠금: 확정(수동 포함)된 날짜의 초안·갱신은 폐기 / 보존 기한 밖은 착지 없이 정리
    if (confirmed.has(entry.date) || (cutoff && entry.date < cutoff)) { ackKeys.push(entry.key); continue; }

    const cur = next[entry.date];
    if (!cur || entry.sampleTs >= (cur.sampleTs || 0)) {
      const merged = { ...(cur || {}) };
      for (const f of FIELDS) if (Number.isFinite(entry[f]) && entry[f] > 0) merged[f] = entry[f];
      merged.sampleTs = Math.max(entry.sampleTs, (cur && cur.sampleTs) || 0);
      if (entry.receivedAt) merged.receivedAt = entry.receivedAt;
      next[entry.date] = merged;
      changed = true;
    }
    // 더 오래된 항목(이미 최신 초안이 있음)은 착지 없이 소비 — ack만
    ackKeys.push(entry.key);
  }

  return { drafts: next, ackKeys, changed };
}

// 초안 + 사용자 입력(골격근·점수) → 확정 bodylog 레코드.
// muscle이 유효(>0)하지 않으면 null — 골격근 없는 원탭 확정으로 muscle:0이 bodylog에
// 유입되는 것을 계약으로 차단한다(불변 조건). lbm·source는 부가 필드(⌚ 배지·수정 폼 가드용).
export function draftToRecord(date, draft, muscle, score) {
  const m = parseFloat(muscle);
  if (!draft || !(draft.weight > 0) || !DATE_RE.test(date || "") || !(m > 0)) return null;
  return {
    date,
    weight: draft.weight,
    muscle: m,
    fatPct: draft.fatPct > 0 ? draft.fatPct : 0,
    score: parseInt(score) || 0,
    ...(draft.lbm > 0 ? { lbm: draft.lbm } : {}),
    source: "import",
  };
}
