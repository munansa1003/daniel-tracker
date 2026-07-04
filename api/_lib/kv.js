// api/_lib/kv.js — Upstash Redis REST 단일 커맨드 헬퍼.
// security.js의 rate limit과 같은 KV(Upstash) 인스턴스를 쓴다.
// 사용: await kv("SET", key, value) / await kv("GET", key) / await kv("SMEMBERS", key) ...
// 명령 배열을 POST 본문으로 보내면 임의 값(JSON 문자열 등)도 안전하게 저장된다.

export function kvConfigured() {
  return !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
            (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
}

export async function kv(...args) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("KV not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`KV ${args[0]} ${res.status}`);
  const { result } = await res.json();
  return result;
}
