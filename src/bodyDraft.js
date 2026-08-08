// src/bodyDraft.js — 체성분 사서함 → "완성 대기 초안" 병합·잠금 (순수 로직).
//
// 운동의 importMerge.js와 같은 위치의 자매 모듈 — day 문서가 아니라 별도 저장 키
// "body-drafts"({ "YYYY-MM-DD": { weight, fatPct, lbm, sampleTs, receivedAt } })를 다룬다.
// bodylog·day 문서는 여기서 절대 쓰지 않는다: 초안이 bodylog 밖에 있는 것 자체가
// "muscle 미입력이 골격근 통계에 0으로 오염되면 안 된다"는 불변 조건의 구현이다.
//
// 잠금(집행 지점은 병합 계층 — 서버는 확정 여부를 모른다). 2026-08-08 개정:
//   확정 레코드를 두 종류로 가른다 —
//   · 사용자가 손댄 것(수동 입력 or 직접 편집 = auto 플래그 없음) → 항상 잠금. 자동이 못 덮는다.
//   · 자동 확정분(auto:true + sampleTs) → 같은 날 "더 최신 측정"이 오면 갱신 허용.
//   근거: 클라우드 직수신이 골격근·점수까지 자동 확정하므로 첫 측정이 즉시 잠기면 그날
//   재측정이 영영 반영되지 않는다(실사용 신고). "하루 종일 몇 번을 재든 마지막이 이긴다".
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
// muscle·score는 인바디 클라우드 직수신 전용 필드 — HAE(애플 건강) 경로에는 존재하지 않는다.
// 여기 담기는 muscle은 추정치가 아니라 인바디가 측정한 실측 SMM(금지사항의 '추정 기입'과 무관).
const FIELDS = ["weight", "fatPct", "lbm", "muscle", "score"];

function retentionCutoff(todayStr) {
  const d = new Date(todayStr + "T12:00:00");
  d.setDate(d.getDate() - DRAFT_RETENTION_DAYS);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// drafts: 현재 초안 맵, bodyLog: 확정 레코드 배열, entries: 사서함 pull 결과.
// 반환: { drafts, ackKeys, changed } — drafts는 새 맵(입력 불변), ackKeys는 사서함에서
// 지워도 되는 field 키 전부(이번 착지 + 잠금 폐기 + 기한 초과 + 구조적 쓰레기).
// 그날 확정 레코드에 막혀 이 측정(sampleTs)이 착지 불가인가.
//   레코드 없음 → 착지 가능 / 수동·편집(auto 없음)·구자동(sampleTs 없음) → 잠금 /
//   자동 확정이고 도착이 더 최신 → 갱신 허용(잠금 아님).
function lockedAgainst(rec, sampleTs) {
  if (!rec) return false;
  if (!rec.auto || !Number.isFinite(rec.sampleTs)) return true;
  return !(Number.isFinite(sampleTs) && sampleTs > rec.sampleTs);
}

export function mergeBodyDrafts(drafts, bodyLog, entries, { todayStr = "" } = {}) {
  const next = { ...(drafts || {}) };
  const ackKeys = [];
  let changed = false;
  // 확정 레코드를 날짜별 Map으로 — auto/sampleTs를 봐야 갱신 가능/잠금을 가른다.
  const confirmed = new Map();
  for (const b of bodyLog || []) if (b && b.date) confirmed.set(b.date, b);
  const cutoff = todayStr ? retentionCutoff(todayStr) : "";

  // 스윕 — 잠긴 날짜의 잔존 초안(유령) 제거 + 기한 지난 초안 정리. 자동 확정 날짜의 초안은
  // 갱신 흐름(autoConfirmDrafts)이 소비하므로 남긴다(단 도착이 더 최신일 때만 초안이 존재).
  for (const date of Object.keys(next)) {
    const ts = next[date] && next[date].sampleTs;
    if ((cutoff && date < cutoff) || lockedAgainst(confirmed.get(date), ts)) { delete next[date]; changed = true; }
  }

  for (const entry of entries || []) {
    if (!entry || typeof entry.key !== "string" || !entry.key) continue; // key 없으면 ack 대상 특정 불가
    if (!DATE_RE.test(entry.date || "") || !Number.isFinite(entry.sampleTs)) {
      ackKeys.push(entry.key); // 우리 사서함의 구조적 쓰레기 — 잔류시키지 않는다
      continue;
    }
    const hasField = FIELDS.some((f) => Number.isFinite(entry[f]) && entry[f] > 0);
    if (!hasField) { ackKeys.push(entry.key); continue; }

    // 잠금(세분화): 사용자 확정분은 폐기, 자동 확정분은 더 최신일 때만 착지. 기한 밖은 정리.
    if ((cutoff && entry.date < cutoff) || lockedAgainst(confirmed.get(entry.date), entry.sampleTs)) { ackKeys.push(entry.key); continue; }

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
    // sampleTs — 이 레코드가 어느 측정 시각의 것인지. 자동 확정분의 "더 최신이면 갱신" 판별에 쓴다.
    ...(Number.isFinite(draft.sampleTs) ? { sampleTs: draft.sampleTs } : {}),
    source: "import",
  };
}

// ── 자동 확정 (A안 스펙 개정 — 2026-08-07 사용자 승인) ──────────────
// 클라우드 직수신으로 4종(체중·체지방률·골격근·점수)이 전부 "실측"으로 도착한 초안은
// 사용자 입력 없이 확정한다. 단 전부 통과해야 한다:
//   ① muscle·weight 실측 존재  ② 잠금 아님(그 날짜 레코드 없음 — 이중 방어)
//   ③ LBM 오타 가드(0.53~0.61) 통과 — 비율 이상이면 자동 확정을 "보류"하고 초안으로
//     남긴다(카드에서 사용자가 검토 후 수동 확정) — 가드가 차단이 아니라 자동화의
//     승격 조건으로 동작한다. score는 선택(없으면 0 — 기존 수동 스키마와 동일).
// 반환: { drafts, bodyLog, confirmed, changed } — 입력 불변, 호출측(App)이 저장을 수행.
export function autoConfirmDrafts(drafts, bodyLog) {
  const nextDrafts = { ...(drafts || {}) };
  let log = Array.isArray(bodyLog) ? [...bodyLog] : [];
  const confirmed = [];
  const byDate = new Map();
  for (const b of log) if (b && b.date) byDate.set(b.date, b);

  for (const [date, draft] of Object.entries(nextDrafts)) {
    if (!draft || !(draft.muscle > 0) || !(draft.weight > 0)) continue;
    if (checkSmmLbm(draft.muscle, draft.lbm).warn) continue;
    const existing = byDate.get(date);
    // 그날 레코드가 있으면 — 자동 확정분이고 이 초안이 더 최신일 때만 갱신(교체). 사용자
    // 확정·편집분(auto 없음)이나 구자동(sampleTs 없음)은 잠금이라 그대로 둔다.
    if (existing && lockedAgainst(existing, draft.sampleTs)) continue;
    const rec = draftToRecord(date, draft, draft.muscle, draft.score);
    if (!rec) continue;
    const autoRec = { ...rec, auto: true };
    log = [...log.filter((b) => b && b.date !== date), autoRec];
    byDate.set(date, autoRec);
    delete nextDrafts[date];
    confirmed.push(date);
  }
  log.sort((a, b) => a.date.localeCompare(b.date));
  return { drafts: nextDrafts, bodyLog: log, confirmed, changed: confirmed.length > 0 };
}
