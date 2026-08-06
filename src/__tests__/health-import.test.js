// 애플워치 운동 자동 수신 — 계약 테스트 10+α (골든셋).
// 스펙: docs/prompts/health-import-api-prompt.md §3. 검문소(api/health-import.js)와
// 사서함(api/import-inbox.js)을 실제 핸들러로 호출하고, KV만 인메모리로 대체한다.
// 병합(src/importMerge.js) 결과는 기존 단일 출처 함수(aggregateDay·effectiveDayMode·isCalOk)로
// 검산해 "수동 입력과 동일 경로 반영"을 증명한다 — 목표 재계산 사본 코드 없음.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";

// KV(Upstash REST) 인메모리 에뮬레이터 — 검문소가 쓰는 명령만 재현.
// SET NX는 단일 스레드에서 원자적으로 판정되므로 race 테스트(+α)가 결정적이다.
vi.mock("../../api/_lib/kv.js", () => {
  const strs = new Map();
  const hashes = new Map();
  const lists = new Map();
  async function kv(cmd, ...args) {
    const c = String(cmd).toUpperCase();
    switch (c) {
      case "GET":
        return strs.has(args[0]) ? strs.get(args[0]) : null;
      case "SET": {
        const [key, value, ...flags] = args;
        if (flags.map((f) => String(f).toUpperCase()).includes("NX") && strs.has(key)) return null;
        strs.set(key, String(value));
        return "OK";
      }
      case "HSET": {
        const [key, field, value] = args;
        if (!hashes.has(key)) hashes.set(key, new Map());
        const had = hashes.get(key).has(field);
        hashes.get(key).set(field, String(value));
        return had ? 0 : 1;
      }
      case "HGETALL": {
        const h = hashes.get(args[0]);
        if (!h) return [];
        const flat = [];
        for (const [f, v] of h) flat.push(f, v);
        return flat; // Upstash REST와 동일한 평탄 배열
      }
      case "HDEL": {
        const [key, ...fields] = args;
        const h = hashes.get(key);
        if (!h) return 0;
        let n = 0;
        for (const f of fields) if (h.delete(f)) n++;
        return n;
      }
      case "LPUSH": {
        const [key, ...vals] = args;
        if (!lists.has(key)) lists.set(key, []);
        for (const v of vals) lists.get(key).unshift(String(v));
        return lists.get(key).length;
      }
      case "LTRIM": {
        const [key, s, e] = args;
        const arr = lists.get(key) || [];
        const stop = Number(e);
        lists.set(key, arr.slice(Number(s), stop === -1 ? undefined : stop + 1));
        return "OK";
      }
      case "LRANGE": {
        const arr = lists.get(args[0]) || [];
        const stop = Number(args[2]);
        return arr.slice(Number(args[1]), stop === -1 ? undefined : stop + 1);
      }
      default:
        throw new Error("kv mock: unsupported " + c);
    }
  }
  return {
    kv,
    kvConfigured: () => true,
    __kvReset: () => { strs.clear(); hashes.clear(); lists.clear(); },
    __kvState: () => ({ strs, hashes, lists }),
  };
});

// ID 토큰 검증은 외부(identitytoolkit) 호출 — 테스트에선 고정 토큰만 통과시킨다.
vi.mock("../../api/_lib/verify-uid.js", () => ({
  verifyUid: async (idToken) => idToken === "id-token-good",
}));

import handler from "../../api/health-import.js";
import inboxHandler from "../../api/import-inbox.js";
import { __kvReset, __kvState } from "../../api/_lib/kv.js";
import { mergeImports } from "../importMerge.js";
import { aggregateDay, effectiveDayMode, isCalOk, exFeedback } from "../utils.js";

const TOKEN = "tok-secret";
const UID = "uid-1";
const CUTOVER = "2026-08-01";
const WEIGHT = 77.5;
const CUT_K = 1536; // 계약 기준 목표(스펙 §0) — 판정은 전부 단일 출처 isCalOk/exFeedback로 검산

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    status(c) { res.statusCode = c; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    end() { return res; },
    send(b) { res.body = typeof b === "string" ? b : JSON.stringify(b); return res; },
    json(o) { res.body = JSON.stringify(o); return res; },
  };
  return res;
}
const out = (res) => JSON.parse(res.body);

const postReq = (body, headers = {}) => ({ method: "POST", headers: { "x-import-token": TOKEN, ...headers }, body });
const W = (over = {}) => ({
  type: "실외 달리기",
  start: "2026-08-06T18:20:00+09:00",
  end: "2026-08-06T18:50:00+09:00",
  durationMin: 30,
  kcal: 446,
  device: "Apple Watch",
  ...over,
});
const envelope = (workouts, over = {}) => ({ source: "workout-end", sentAt: "2026-08-06T19:00:12+09:00", workouts, ...over });

async function importPost(body, headers) {
  const res = makeRes();
  await handler(postReq(body, headers), res);
  return res;
}
async function inboxCall(body) {
  const res = makeRes();
  await inboxHandler({ method: "POST", headers: { origin: "http://localhost:5173" }, body }, res);
  return res;
}
const pullInbox = async () => out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "pull" }));
const ackInbox = async (keys) => out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "ack", keys }));
const inboxSize = () => (__kvState().hashes.get(`import:inbox:${UID}`) || new Map()).size;

beforeEach(() => {
  __kvReset();
  vi.stubEnv("IMPORT_TOKEN", TOKEN);
  vi.stubEnv("IMPORT_UID", UID);
  vi.stubEnv("IMPORT_CUTOVER_DATE", CUTOVER);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("계약 1·2 — 정상 수신과 insert-only 재전송", () => {
  it("1) 정상 유산소 2건 → accepted 2, 병합 후 유효목표(기본+운동×50%)가 단일 출처 판정에 반영", async () => {
    const payload = envelope([
      W(),
      W({ type: "걷기", start: "2026-08-06T07:00:00+09:00", end: "2026-08-06T07:40:00+09:00", durationMin: 40, kcal: 320 }),
    ]);
    const res = await importPost(payload);
    expect(res.statusCode).toBe(200);
    expect(out(res)).toMatchObject({ accepted: 2, ignored: 0, filtered: 0, rejected: 0 });
    expect(out(res).message).toBe("2건 추가");

    const { entries } = await pullInbox();
    expect(entries).toHaveLength(2);
    const { updatedDays } = mergeImports({}, entries, { weight: WEIGHT, todayStr: "2026-08-06", mode: "cut" });
    const day = updatedDays["2026-08-06"];
    expect(day.exercises).toHaveLength(2);
    // 수동 입력과 같은 모양 + 출처 표시(⌚ 배지 근거) + 편집 화면용 역산 m
    expect(day.exercises[1]).toMatchObject({ n: "러닝", kcal: 446, duration: 30, hour: 18, source: "watch", m: 11.5 });
    expect(day.exercises[0].hour).toBe(7); // sortByHour 적용(수동 경로와 동일)

    // 유효목표 반영 — 사본 계산 없이 기존 단일 출처(aggregateDay·exFeedback·isCalOk)로 검산
    const a = aggregateDay(day);
    expect(a.ex).toBe(766);
    const effective = CUT_K + Math.round(a.ex * exFeedback("cut")); // 1536 + 383
    expect(effective).toBe(1919);
    expect(isCalOk(1919, a.ex, CUT_K, "cut")).toBe(true);
    expect(isCalOk(1920, a.ex, CUT_K, "cut")).toBe(false);
  });

  it("2) 동일 페이로드 재전송 → ignored 2, 사서함·병합 결과 불변(멱등)", async () => {
    const payload = envelope([W(), W({ type: "걷기", start: "2026-08-06T07:00:00+09:00", end: "2026-08-06T07:40:00+09:00", durationMin: 40, kcal: 320 })]);
    await importPost(payload);
    expect(inboxSize()).toBe(2);

    const res2 = await importPost(payload);
    expect(out(res2)).toMatchObject({ accepted: 0, ignored: 2 });
    expect(out(res2).message).toBe("0건 추가 · 중복 2 무시");
    expect(inboxSize()).toBe(2); // 재유입 없음

    const { entries } = await pullInbox();
    const first = mergeImports({}, entries, { weight: WEIGHT, todayStr: "2026-08-06", mode: "cut" });
    const again = mergeImports(first.updatedDays, entries, { weight: WEIGHT, todayStr: "2026-08-06", mode: "cut" });
    expect(Object.keys(again.updatedDays)).toHaveLength(0); // 이미 반영 → 변경 없음
    expect(again.ackKeys).toHaveLength(2);                  // 사서함 비우기용 ack만
  });
});

describe("계약 3·4 — 화이트리스트(근력은 '근력 운동' 편입 · 한/영 병기)", () => {
  it("3) '기능성 근력 훈련' → '근력 운동' 한 건으로 accepted (2026-08-06 정책 전환 — 세부는 메모로)", async () => {
    const res = await importPost(envelope([W({ type: "기능성 근력 훈련" })]));
    expect(out(res)).toMatchObject({ accepted: 1, filtered: 0 });
    const { entries } = await pullInbox();
    expect(entries[0].n).toBe("근력 운동");
  });

  it("미등록 유형(요가) → filtered(대상 외) + 응답에 unknownTypes로 이름 노출", async () => {
    const res = await importPost(envelope([W({ type: "요가" })]));
    expect(out(res)).toMatchObject({ accepted: 0, filtered: 1, unknownTypes: ["요가"] });
    expect(out(res).message).toContain("대상 외 1 제외");
    expect(inboxSize()).toBe(0);
  });

  it("수식어 붙은 이름(피트니스 실측: '오후 실외 걷기') → 키워드 포함 매칭으로 accepted", async () => {
    const res = await importPost(envelope([W({ type: "오후 실외 걷기" })]));
    expect(out(res).accepted).toBe(1);
    const { entries } = await pullInbox();
    expect(entries[0].n).toBe("걷기");
  });

  it("수식어 붙은 근력('저녁 기능성 근력 훈련')도 '근력 운동'으로 accepted — 유산소로 새지 않음", async () => {
    const res = await importPost(envelope([W({ type: "저녁 기능성 근력 훈련" })]));
    expect(out(res)).toMatchObject({ accepted: 1, filtered: 0 });
    const { entries } = await pullInbox();
    expect(entries[0].n).toBe("근력 운동");
  });

  it("HAE 실측 표기 변형 — '기능적 근력 훈련'·'전통적 근력 운동' 모두 '근력 운동'으로 accepted", async () => {
    const res = await importPost(envelope([
      W({ type: "기능적 근력 훈련" }),
      W({ type: "전통적 근력 운동", start: "2026-08-06T20:00:00+09:00", end: "2026-08-06T20:40:00+09:00" }),
    ]));
    expect(out(res)).toMatchObject({ accepted: 2, filtered: 0 });
    const { entries } = await pullInbox();
    expect(entries.map((e) => e.n)).toEqual(["근력 운동", "근력 운동"]);
  });

  it("'미식축구'는 '축구' 포함이지만 오인 수입되지 않는다 (제외 목록)", async () => {
    const res = await importPost(envelope([W({ type: "미식축구" })]));
    expect(out(res)).toMatchObject({ accepted: 0, filtered: 1, unknownTypes: ["미식축구"] });
    expect(inboxSize()).toBe(0);
  });

  it("'호주 축구'·'휠체어 걷기 속도'·'휠체어 달리기 속도'도 오인 수입되지 않는다 (HAE 실측 목록)", async () => {
    const res = await importPost(envelope([
      W({ type: "호주 축구" }),
      W({ type: "휠체어 걷기 속도", start: "2026-08-06T20:00:00+09:00", end: "2026-08-06T20:30:00+09:00" }),
      W({ type: "휠체어 달리기 속도", start: "2026-08-06T21:00:00+09:00", end: "2026-08-06T21:30:00+09:00" }),
    ]));
    expect(out(res)).toMatchObject({ accepted: 0, filtered: 3 });
    expect(inboxSize()).toBe(0);
  });

  it("맨몸 '계단'도 계단 오르기로 accepted (HAE 목록에 '계단'·'계단 오르기' 별도 존재)", async () => {
    const res = await importPost(envelope([W({ type: "계단" })]));
    expect(out(res).accepted).toBe(1);
    const { entries } = await pullInbox();
    expect(entries[0].n).toBe("계단 오르기");
  });

  it("HAE의 달리기 표기 '야외 운동' → 러닝으로 accepted (사용자 실측 확인)", async () => {
    const res = await importPost(envelope([W({ type: "야외 운동" })]));
    expect(out(res).accepted).toBe(1);
    const { entries } = await pullInbox();
    expect(entries[0].n).toBe("러닝");
  });

  it("'식히기'(워치 쿨다운) → accepted (2026-08-06 사용자 실측 편입 — 통계는 '기타')", async () => {
    const res = await importPost(envelope([W({ type: "식히기" })]));
    expect(out(res)).toMatchObject({ accepted: 1, filtered: 0 });
    const { entries } = await pullInbox();
    expect(entries[0].n).toBe("식히기");
  });

  it("4) 한국어('실외 달리기')·영어('Outdoor Run') 혼합 → 둘 다 같은 대표명으로 accepted", async () => {
    const res = await importPost(envelope([
      W(),
      W({ type: "Outdoor Run", start: "2026-08-06T20:00:00+09:00", end: "2026-08-06T20:25:00+09:00", durationMin: 25, kcal: 300 }),
    ]));
    expect(out(res).accepted).toBe(2);
    const { entries } = await pullInbox();
    expect(entries.map((e) => e.n)).toEqual(["러닝", "러닝"]);
  });
});

describe("계약 5·6·7 — 컷오버 · 값 상식 · 날짜 형식", () => {
  it("5) 컷오버 이전 시작 운동 → rejected", async () => {
    const res = await importPost(envelope([W({ start: "2026-07-31T18:20:00+09:00", end: "2026-07-31T18:50:00+09:00" })]));
    expect(out(res)).toMatchObject({ accepted: 0, rejected: 1 });
    expect(out(res).message).toContain("컷오버");
    expect(inboxSize()).toBe(0);
  });

  it("6) kcal 4000(kJ 오염 시뮬레이션) → rejected + message에 사유", async () => {
    const res = await importPost(envelope([W({ kcal: 4000 })]));
    expect(out(res)).toMatchObject({ accepted: 0, rejected: 1 });
    expect(out(res).message).toContain("칼로리 범위");
  });

  it("durationMin 900 → rejected(시간 범위)", async () => {
    const res = await importPost(envelope([W({ durationMin: 900 })]));
    expect(out(res)).toMatchObject({ rejected: 1 });
    expect(out(res).message).toContain("시간 범위");
  });

  it("7) 로케일 날짜('2026년 8월 6일 오후 7시') → 400 + 'ISO 8601 필요'", async () => {
    const res = await importPost(envelope([W({ start: "2026년 8월 6일 오후 7시" })]));
    expect(res.statusCode).toBe(400);
    expect(out(res).message).toContain("ISO 8601 필요");
  });

  it("오프셋 없는 ISO('2026-08-06T18:20:00') → 400 (오프셋 필수)", async () => {
    const res = await importPost(envelope([W({ start: "2026-08-06T18:20:00" })]));
    expect(res.statusCode).toBe(400);
    expect(out(res).message).toContain("ISO 8601 필요");
  });
});

describe("계약 8 — 인증", () => {
  it("8a) 토큰 불일치 → 401", async () => {
    const res = await importPost(envelope([W()]), { "x-import-token": "wrong" });
    expect(res.statusCode).toBe(401);
  });

  it("8b) 토큰 미설정 → 503 비활성(잠금)", async () => {
    vi.stubEnv("IMPORT_TOKEN", "");
    const res = await importPost(envelope([W()]));
    expect(res.statusCode).toBe(503);
  });

  it("사서함 pull — ID 토큰 검증 실패 → 401 (uid 사칭 차단)", async () => {
    const res = await inboxCall({ uid: UID, idToken: "bad", action: "pull" });
    expect(res.statusCode).toBe(401);
  });
});

describe("계약 9·10 — insert-only 보존과 휴식일 자동 복귀", () => {
  it("9) 가져온 기록 kcal 수정 → 동일 페이로드 재전송해도 수정값 보존 (insert-only 증명)", async () => {
    const payload = envelope([W()]);
    await importPost(payload);
    const { entries } = await pullInbox();
    const { updatedDays, ackKeys } = mergeImports({}, entries, { weight: WEIGHT, todayStr: "2026-08-06", mode: "cut" });
    await ackInbox(ackKeys);
    expect(inboxSize()).toBe(0);

    // 사용자 수정 시뮬레이션 — 앱의 editExercise처럼 항목을 교체(importKey는 유지)
    const days = { ...updatedDays };
    days["2026-08-06"] = {
      ...days["2026-08-06"],
      exercises: days["2026-08-06"].exercises.map((e) => ({ ...e, kcal: 500 })),
    };

    const res2 = await importPost(payload);
    expect(out(res2)).toMatchObject({ accepted: 0, ignored: 1 }); // 접수 도장(seen)은 ack 후에도 영구
    const pull2 = await pullInbox();
    expect(pull2.entries).toHaveLength(0); // 사서함 재유입 없음 → 덮어쓸 경로 자체가 없다

    const again = mergeImports(days, pull2.entries, { weight: WEIGHT, todayStr: "2026-08-06", mode: "cut" });
    expect(Object.keys(again.updatedDays)).toHaveLength(0);
    expect(days["2026-08-06"].exercises[0].kcal).toBe(500); // 수정값 그대로
  });

  it("10) 휴식 선언일에 350kcal 유입 → 기존 자동 복귀 발동, 목표 1,711로 상승, 판정 정상", async () => {
    const days = {
      "2026-08-06": { mode: "cut", dayType: "rest", meals: [{ n: "회식", k: 1700, p: 80, c: 155, f: 62, serving: 1 }], exercises: [] },
    };
    // 병합 전: 운동 0 → 휴식 프리셋(1,675) 발효 중 → 1,700은 초과
    expect(effectiveDayMode(days["2026-08-06"], 0, "cut")).toBe("rest");

    await importPost(envelope([W({ type: "걷기", start: "2026-08-06T19:00:00+09:00", end: "2026-08-06T20:10:00+09:00", durationMin: 70, kcal: 350 })], { source: "evening-backup" }));
    const { entries } = await pullInbox();
    const { updatedDays } = mergeImports(days, entries, { weight: WEIGHT, todayStr: "2026-08-07", mode: "cut" });
    const day = updatedDays["2026-08-06"];
    expect(day.dayType).toBe("rest"); // 도장·모드 스탬프 보존(과거 날 병합)
    expect(day.mode).toBe("cut");

    // 기존 복귀 로직(effectiveDayMode)이 "그대로" 발동 — 신규 복귀 코드 없음
    const a = aggregateDay(day);
    expect(a.ex).toBe(350);
    expect(effectiveDayMode(day, a.ex, "cut")).toBe("cut"); // 300 초과 → 훈련일 공식 복귀
    expect(CUT_K + Math.round(a.ex * exFeedback("cut"))).toBe(1711); // 목표 1,711로 상승
    expect(isCalOk(a.k, a.ex, CUT_K, "cut")).toBe(true); // 1,700 ≤ 1,711 → 판정 정상
  });
});

describe("계약 +α — 동시 도착 race", () => {
  it("완전히 같은 운동이 동시 2요청으로 와도 저장은 정확히 1건", async () => {
    const payload = envelope([W()]);
    const [r1, r2] = [makeRes(), makeRes()];
    await Promise.all([handler(postReq(payload), r1), handler(postReq(payload), r2)]);
    const [o1, o2] = [out(r1), out(r2)];
    expect(o1.accepted + o2.accepted).toBe(1); // 승자 1
    expect(o1.ignored + o2.ignored).toBe(1);   // 패자 1
    expect(inboxSize()).toBe(1);               // 사서함에도 정확히 1건
  });
});

describe("사서함 ack — 병합 완료 후 제거(접수 도장은 유지)", () => {
  it("ack로 지운 뒤에도 재전송은 ignored (seen 영구)", async () => {
    await importPost(envelope([W()]));
    const { entries } = await pullInbox();
    const r = await ackInbox(entries.map((e) => e.importKey));
    expect(r).toMatchObject({ ok: true, removed: 1 });
    expect(inboxSize()).toBe(0);
    const res = await importPost(envelope([W()]));
    expect(out(res)).toMatchObject({ accepted: 0, ignored: 1 });
  });
});

// ── HAE(Health Auto Export) 폴백 — 플랜 C (단축어에 '운동 찾기'가 없는 기기) ──
// 형식 근거: github.com/Lybron/health-auto-export/wiki (workouts v1/v2)
describe("HAE 폴백 — { data: { workouts } } 페이로드", () => {
  const HAE = (workouts) => ({ data: { workouts, metrics: [] } });
  const haeW = (over = {}) => ({
    id: "hae-1",
    name: "Outdoor Run",
    start: "2026-08-06 18:20:00 +0900",
    end: "2026-08-06 18:50:00 +0900",
    duration: 1800, // v2: 초 단위
    activeEnergyBurned: { qty: 445.83, units: "kcal" },
    ...over,
  });

  it("v2 정상 1건 → accepted (초→분 변환 · kcal 반올림 · 귀속일·시각 정상 · device=HAE)", async () => {
    const res = await importPost(HAE([haeW()]));
    expect(res.statusCode).toBe(200);
    expect(out(res)).toMatchObject({ accepted: 1, ignored: 0, filtered: 0, rejected: 0 });
    const { entries } = await pullInbox();
    expect(entries[0]).toMatchObject({ n: "러닝", kcal: 446, duration: 30, date: "2026-08-06", hour: 18, device: "HAE" });
  });

  it("UTC(Z) 날짜도 한국시간 벽시계로 귀속 — 09:20Z = 18:20 KST (규칙 7 보존)", async () => {
    const res = await importPost(HAE([haeW({ start: "2026-08-06 09:20:00 Z", end: "2026-08-06 09:50:00 Z" })]));
    expect(out(res).accepted).toBe(1);
    const { entries } = await pullInbox();
    expect(entries[0]).toMatchObject({ date: "2026-08-06", hour: 18 });
  });

  it("네이티브(단축어)로 이미 접수된 운동은 HAE로 다시 와도 ignored — 경로 무관 dedup", async () => {
    await importPost(envelope([W()])); // 실외 달리기 18:20~18:50 +09:00 → canon 러닝
    const res = await importPost(HAE([haeW()])); // Outdoor Run, 같은 시각 → 같은 dedup 키
    expect(out(res)).toMatchObject({ accepted: 0, ignored: 1 });
    expect(inboxSize()).toBe(1);
  });

  it("빈 workouts(주기 동기화에 새 운동 없음) → 400이 아니라 200 '0건 추가'", async () => {
    const res = await importPost(HAE([]));
    expect(res.statusCode).toBe(200);
    expect(out(res)).toMatchObject({ accepted: 0, ignored: 0, filtered: 0, rejected: 0 });
    expect(out(res).message).toBe("0건 추가");
  });

  it("kJ 단위 에너지는 kcal로 환산 후 수용 — 1,866kJ ≈ 446kcal (거부 아님)", async () => {
    const res = await importPost(HAE([haeW({ activeEnergyBurned: { qty: 1866, units: "kJ" } })]));
    expect(out(res).accepted).toBe(1);
    const { entries } = await pullInbox();
    expect(entries[0].kcal).toBe(446);
  });

  it("근력(Functional Strength Training)은 HAE 경로에서도 '근력 운동'으로 accepted", async () => {
    const res = await importPost(HAE([haeW({ name: "Functional Strength Training" })]));
    expect(out(res)).toMatchObject({ accepted: 1, filtered: 0 });
    const { entries } = await pullInbox();
    expect(entries[0].n).toBe("근력 운동");
  });

  it("v1 형식(duration 없음 · activeEnergy) → 벽시계로 시간 유도해 수용", async () => {
    const w = { name: "걷기", start: "2026-08-06 07:00:00 +0900", end: "2026-08-06 07:40:00 +0900", activeEnergy: { qty: 180.4, units: "kcal" } };
    const res = await importPost(HAE([w]));
    expect(out(res).accepted).toBe(1);
    const { entries } = await pullInbox();
    expect(entries[0]).toMatchObject({ n: "걷기", duration: 40, kcal: 180 });
  });

  it("형식 깨진 항목(날짜 파싱 불가)은 rejected 집계 + message에 사유", async () => {
    const bad = { name: "Running", start: "2026년 8월 6일", end: "bad", activeEnergyBurned: { qty: 100, units: "kcal" } };
    const res = await importPost(HAE([haeW(), bad]));
    expect(out(res)).toMatchObject({ accepted: 1, rejected: 1 });
    expect(out(res).message).toContain("HAE 항목 형식 오류");
  });
});

// ── 본문 인코딩 — 단축어 'URL 콘텐츠 가져오기'가 파일 첨부로 보내는 경우 ──
// Content-Type이 JSON이 아니면 Vercel이 파싱하지 않은 문자열/버퍼로 도착한다.
describe("본문 인코딩 — 문자열/버퍼 본문(비JSON Content-Type) 수용", () => {
  it("문자열 본문(표준 봉투)도 JSON 파싱해 동일 검문 — accepted", async () => {
    const res = await importPost(JSON.stringify(envelope([W()])));
    expect(out(res)).toMatchObject({ accepted: 1, filtered: 0, rejected: 0 });
  });

  it("Buffer 본문(HAE 형식)도 파싱·변환해 accepted", async () => {
    const hae = { data: { workouts: [{ name: "Outdoor Run", start: "2026-08-06 18:20:00 +0900", end: "2026-08-06 18:50:00 +0900", duration: 1800, activeEnergyBurned: { qty: 445.83, units: "kcal" } }], metrics: [] } };
    const res = await importPost(Buffer.from(JSON.stringify(hae)));
    expect(out(res)).toMatchObject({ accepted: 1 });
  });

  it("JSON이 아닌 문자열은 400 '파싱 실패'", async () => {
    const res = await importPost("운동 데이터가 아닌 텍스트");
    expect(res.statusCode).toBe(400);
    expect(out(res).message).toContain("파싱 실패");
  });
});
