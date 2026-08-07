// api/_lib/body-inbox-store.js — 체성분 사서함 기입(공유 저장 계층).
//
// body-import.js(HAE 단축어 수신)와 import-inbox.js(인바디 클라우드 직수신 pull)가
// 같은 순서·같은 키로 사서함에 기입하도록 단일 출처로 묶는다.
// 순서는 운동 검문소와 동일한 3단(유실 창 제거): ① seen 조회 ② 사서함 HSET(불변 field,
// 멱등) ③ seen SET NX(동시 도착 race의 승자 1명만 accepted).
import { kv } from "./kv.js";

export async function storeBodyEntries(uid, entries) {
  let accepted = 0, ignored = 0;
  const inboxKey = `import:body-inbox:${uid}`;
  for (const entry of entries) {
    const seenKey = `import:body-seen:${uid}:${entry.key}`;
    const already = await kv("GET", seenKey);
    if (already) { ignored++; continue; }
    await kv("HSET", inboxKey, entry.key, JSON.stringify({ ...entry, receivedAt: new Date().toISOString() }));
    const nx = await kv("SET", seenKey, new Date().toISOString(), "NX");
    if (nx === null) { ignored++; continue; }
    accepted++;
  }
  return { accepted, ignored };
}

// 수신 로그(관측성 §1.4) — source: "hae"(단축어) | "cloud"(인바디 클라우드 직수신)
export async function pushBodyLog(uid, source, { accepted, ignored, summary }) {
  try {
    await kv("LPUSH", `import:body-log:${uid}`, JSON.stringify({
      at: new Date().toISOString(), source,
      accepted, ignored,
      rejected: summary.rejected, excluded: summary.excluded, sourceFiltered: summary.sourceFiltered,
      samplesToday: summary.samplesToday,
      matchedNames: summary.matchedNames, unmatchedNames: summary.unmatchedNames,
      sources: summary.sources,
      ...(summary.fatPctForm ? { fatPctForm: summary.fatPctForm } : {}),
    }));
    await kv("LTRIM", `import:body-log:${uid}`, "0", "19");
  } catch (e) { console.error(`[body-inbox-store] log write failed:`, e); }
}
