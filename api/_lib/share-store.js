// api/_lib/share-store.js — AI 공유 링크의 토큰 저장소(KV) + 순수 유틸.
//
// 설계: 서버가 Firestore를 읽지 않는다. 앱(브라우저)이 이미 가진 데이터로 만든 분석
// 패키지를 그대로 올려두고, 공유 뷰는 그 스냅샷만 렌더한다. 덕분에
//   - 서비스 계정 키/Admin SDK 불필요 (서버가 사용자 DB 권한을 갖지 않음 = 사고 반경 최소)
//   - Firestore 읽기 0건 (조회가 반복돼도 비용·쿼터 영향 없음)
//   - 링크 = "공유한 시점의 스냅샷"이라 분석 결과가 재현 가능
// 대가: 기록을 더 추가해도 링크 내용은 갱신되지 않는다(새로 만들면 됨).
import { kv } from "./kv.js";

export const TTL_OPTIONS = [
  { key: "1h", label: "1시간", hours: 1 },
  { key: "24h", label: "24시간", hours: 24 },
  { key: "7d", label: "7일", hours: 168 },
];

// KV 저장 상한 — 정밀 상세본 전체기간도 수백 KB 수준. 그 이상은 거부(요약본 권장).
export const MAX_PKG_BYTES = 600 * 1024;

export const shareKey = (token) => `share:${token}`;

// 토큰 형식 검증(경로 주입·비정상 키 차단) — 32자 hex만 허용
export function isValidToken(t) {
  return typeof t === "string" && /^[0-9a-f]{32}$/.test(t);
}

export function ttlHoursOf(ttlKey) {
  const o = TTL_OPTIONS.find((x) => x.key === ttlKey);
  return o ? o.hours : 24; // 기본 24시간
}

// 저장 — TTL이 지나면 KV가 자동 삭제(= 만료 시 링크 무효)
export async function putShare(token, payload, ttlSeconds) {
  await kv("SET", shareKey(token), JSON.stringify(payload), "EX", String(ttlSeconds));
}

export async function getShare(token) {
  if (!isValidToken(token)) return null;
  const raw = await kv("GET", shareKey(token));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function delShare(token) {
  if (!isValidToken(token)) return false;
  await kv("DEL", shareKey(token));
  return true;
}

// 폐기 — DEL 대신 7일짜리 흔적(tombstone)을 남긴다.
// 이유: 완전 삭제하면 "폐기된 링크"와 "존재한 적 없는 링크"를 구분 못해 404만 가능.
// 흔적이 있으면 410 Gone("폐기됨")으로 정확히 안내할 수 있다(스냅샷 본문은 즉시 소멸).
export async function revokeShare(token, uid) {
  if (!isValidToken(token)) return false;
  await kv("SET", shareKey(token), JSON.stringify({ revoked: true, uid, revokedAt: Date.now() }), "EX", String(7 * 24 * 3600));
  return true;
}

// 접근 통계 — **별도 카운터 키**에만 쓴다. 스냅샷 문서는 절대 되쓰지 않는다.
//
// 옛 동작은 뷰가 읽은 rec를 그대로 되쓰는 것이었는데(fire-and-forget), 그 사이에 사용자가
// 링크를 폐기하면 뒤늦게 도착한 쓰기가 tombstone을 **pkg가 담긴 옛 rec로 덮어써** 폐기가
// 무효화됐다. "폐기"를 누르는 순간은 보통 상대가 링크를 보고 있는 순간이라 창이 좁지 않다
// (2026-08 감사 R-08). 카운터를 분리하면 경합 자체가 사라진다 — 읽기 경로가 쓰기를 안 한다.
export const shareHitsKey = (token) => `share:hits:${token}`;

export async function touchShare(token) {
  if (!isValidToken(token)) return;
  const n = await kv("INCR", shareHitsKey(token));
  // 첫 조회에만 TTL — 매번 걸면 조회가 이어질 때 카운터가 영구화된다(rateLimit과 같은 패턴)
  if (Number(n) === 1) await kv("EXPIRE", shareHitsKey(token), String(7 * 24 * 3600));
}
