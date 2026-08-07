// 인바디 체성분 자동 수신 — 계약 테스트 (골든셋, 서버 계층).
// 스펙: docs/prompts/body-import-api-prompt.md §3. 검문소(api/body-import.js)와
// 사서함(api/import-inbox.js additive 확장)을 실제 핸들러로 호출하고 KV만 인메모리로 대체한다.
// 병합·잠금 계층(src/bodyDraft.js)의 계약은 body-draft.test.js가 담당 —
// 여기서는 서버 왕복(멱등·race 포함)까지의 최종 상태를 mergeBodyDrafts로 검산한다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";

// KV(Upstash REST) 인메모리 에뮬레이터 — health-import.test.js와 동일한 명령 집합.
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
        return flat;
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

vi.mock("../../api/_lib/verify-uid.js", () => ({
  verifyUid: async (idToken) => idToken === "id-token-good",
}));

import bodyHandler from "../../api/body-import.js";
import workoutHandler from "../../api/health-import.js";
import inboxHandler from "../../api/import-inbox.js";
import { __kvReset, __kvState } from "../../api/_lib/kv.js";
import { classifyBodyMetric } from "../../api/_lib/body-import-rules.js";
import { mergeBodyDrafts } from "../bodyDraft.js";

const TOKEN = "tok-secret";
const UID = "uid-1";
const BODY_CUTOVER = "2026-08-01";
const TODAY = "2026-08-07";

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

// HAE '건강 지표 내보내기' 페이로드 조립기 — 실전 형태({ data: { metrics, workouts } })
const metricsPayload = (metrics) => ({ data: { metrics, workouts: [] } });
const metric = (name, units, samples) => ({ name, units, data: samples });
const S = (date, qty, over = {}) => ({ date, qty, ...over });
const D = (hms, day = TODAY) => `${day} ${hms} +0900`;               // HAE 날짜 표기(콜론 없는 오프셋)
const ts = (hms, day = TODAY) => Date.parse(`${day}T${hms}+09:00`);

// 표준 아침 시료: 체중 73.6 + 체지방률 18.7 + 제지방 60.5 (08:24 단일 측정)
const trio = () => metricsPayload([
  metric("weight_body_mass", "kg", [S(D("08:24:00"), 73.6)]),
  metric("body_fat_percentage", "%", [S(D("08:24:00"), 18.7)]),
  metric("lean_body_mass", "kg", [S(D("08:24:00"), 60.5)]),
]);

async function bodyPost(body, headers = {}) {
  const res = makeRes();
  await bodyHandler({ method: "POST", headers: { "x-import-token": TOKEN, ...headers }, body }, res);
  return res;
}
async function inboxCall(body) {
  const res = makeRes();
  await inboxHandler({ method: "POST", headers: { origin: "http://localhost:5173" }, body }, res);
  return res;
}
const pullInbox = async () => out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "pull" }));
const ackBody = async (bodyKeys) => out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "ack", bodyKeys }));
const bodyInboxSize = () => (__kvState().hashes.get(`import:body-inbox:${UID}`) || new Map()).size;
const lastBodyLog = () => JSON.parse((__kvState().lists.get(`import:body-log:${UID}`) || [])[0]);

beforeEach(() => {
  __kvReset();
  vi.stubEnv("IMPORT_TOKEN", TOKEN);
  vi.stubEnv("IMPORT_UID", UID);
  vi.stubEnv("IMPORT_CUTOVER_DATE", "2026-08-01");      // 운동 게이트(격리 테스트용)
  vi.stubEnv("IMPORT_BODY_CUTOVER_DATE", BODY_CUTOVER);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("계약 1 — 정상 수신: 초안 생성·3값 채움", () => {
  it("아침 weight 73.6 + fatPct 18.7 + lbm 60.5 → accepted 1, 사서함 항목에 3값", async () => {
    const res = await bodyPost(trio());
    expect(res.statusCode).toBe(200);
    expect(out(res)).toMatchObject({ accepted: 1, ignored: 0, rejected: 0, excluded: 0, samplesToday: 1 });

    const { bodyEntries } = await pullInbox();
    expect(bodyEntries).toHaveLength(1);
    expect(bodyEntries[0]).toMatchObject({
      key: `${TODAY}|${ts("08:24:00")}`, date: TODAY, sampleTs: ts("08:24:00"),
      weight: 73.6, fatPct: 18.7, lbm: 60.5,
    });

    // 병합 계층 착지 검산 — 초안 3값, bodylog는 손대지 않음(반환 자체에 없음)
    const merged = mergeBodyDrafts({}, [], bodyEntries, { todayStr: TODAY });
    expect(merged.drafts[TODAY]).toMatchObject({ weight: 73.6, fatPct: 18.7, lbm: 60.5 });
    expect(merged.ackKeys).toEqual([bodyEntries[0].key]);
  });

  it("B8 부분 수신 — weight만 와도 초안 성립(필드별 독립)", async () => {
    const res = await bodyPost(metricsPayload([metric("weight_body_mass", "kg", [S(D("08:24:00"), 73.6)])]));
    expect(out(res)).toMatchObject({ accepted: 1 });
    const { bodyEntries } = await pullInbox();
    expect(bodyEntries[0]).toMatchObject({ weight: 73.6 });
    expect(bodyEntries[0].fatPct).toBeUndefined();
    expect(bodyEntries[0].lbm).toBeUndefined();
  });
});

describe("계약 2·3 — 다중 샘플 최신 채택과 집계 판별(B2·B3)", () => {
  it("2) 같은 날 3샘플 73.8(08:24)→73.7(09:19)→73.6(09:20) → 최신 73.6 채택 (8/5 실증 재현)", async () => {
    const res = await bodyPost(metricsPayload([
      metric("weight_body_mass", "kg", [S(D("08:24:00"), 73.8), S(D("09:19:00"), 73.7), S(D("09:20:00"), 73.6)]),
    ]));
    expect(out(res)).toMatchObject({ accepted: 1, samplesToday: 3 });
    const { bodyEntries } = await pullInbox();
    expect(bodyEntries[0]).toMatchObject({ weight: 73.6, sampleTs: ts("09:20:00"), key: `${TODAY}|${ts("09:20:00")}` });
    expect(lastBodyLog()).toMatchObject({ samplesToday: 3 }); // 개별 샘플 형태임이 로그로 판별
  });

  it("3) 하루 1건(집계 평균) 형태 → 정상 처리 + 로그에 샘플 수 1", async () => {
    await bodyPost(trio());
    expect(lastBodyLog()).toMatchObject({ samplesToday: 1, accepted: 1 });
  });
});

describe("계약 4·5 — 값·단위 방어(B4·B5)", () => {
  it("4) fatPct 0.187 → 거부 + '소수형 의심' + 로그에 수신값 형 기록(§1.4-⑵)", async () => {
    const res = await bodyPost(metricsPayload([metric("body_fat_percentage", "%", [S(D("08:24:00"), 0.187)])]));
    expect(out(res)).toMatchObject({ accepted: 0, rejected: 1 });
    expect(out(res).message).toContain("소수형");
    expect(lastBodyLog()).toMatchObject({ fatPctForm: "0.187", rejected: 1 });
  });

  it("5) weight units lb 162.3 → kg 변환 73.6 수용", async () => {
    await bodyPost(metricsPayload([metric("weight_body_mass", "lb", [S(D("08:24:00"), 162.3)])]));
    const { bodyEntries } = await pullInbox();
    expect(bodyEntries[0]).toMatchObject({ weight: 73.6 });
  });

  it("수용 불가 단위(stone)·범위 밖(weight 200) → 거부 + 사유", async () => {
    const res = await bodyPost(metricsPayload([
      metric("weight_body_mass", "st", [S(D("08:24:00"), 11.6)]),
      metric("lean_body_mass", "kg", [S(D("08:25:00"), 200)]),
    ]));
    expect(out(res)).toMatchObject({ accepted: 0, rejected: 2 });
  });
});

describe("계약 6 — 아침 창 가드(B1)", () => {
  it("21:00 측정 샘플 → 초안 갱신 제외 + 로그 (저녁 비공복 측정이 아침 값을 못 덮는다)", async () => {
    const res = await bodyPost(metricsPayload([metric("weight_body_mass", "kg", [S(D("21:00:00"), 74.9)])]));
    expect(out(res)).toMatchObject({ accepted: 0, excluded: 1, rejected: 0 });
    expect(out(res).message).toContain("아침 창");
    expect(bodyInboxSize()).toBe(0);
    expect(lastBodyLog()).toMatchObject({ excluded: 1 });
  });

  it("아침 08:24 + 저녁 21:00 혼합 → 아침 값만 초안 후보", async () => {
    await bodyPost(metricsPayload([metric("weight_body_mass", "kg", [S(D("08:24:00"), 73.6), S(D("21:00:00"), 74.9)])]));
    const { bodyEntries } = await pullInbox();
    expect(bodyEntries).toHaveLength(1);
    expect(bodyEntries[0]).toMatchObject({ weight: 73.6, sampleTs: ts("08:24:00") });
  });
});

describe("계약 11·12 — 컷오버(B7)와 대상 외 지표 로그", () => {
  it("11) 컷오버 이전 날짜 → 거부", async () => {
    const res = await bodyPost(metricsPayload([metric("weight_body_mass", "kg", [S(D("08:24:00", "2026-07-31"), 73.6)])]));
    expect(out(res)).toMatchObject({ accepted: 0, rejected: 1 });
    expect(out(res).message).toContain("컷오버");
  });

  it("12) 지표명 'waist_circumference' → 무시 + 로그에 원본 name 기록(별칭 확장 재료)", async () => {
    const res = await bodyPost(metricsPayload([
      metric("waist_circumference", "cm", [S(D("08:24:00"), 82)]),
      metric("weight_body_mass", "kg", [S(D("08:24:00"), 73.6)]),
    ]));
    expect(out(res)).toMatchObject({ accepted: 1, unmatchedNames: ["waist_circumference"] });
    expect(lastBodyLog()).toMatchObject({ unmatchedNames: ["waist_circumference"], matchedNames: ["weight_body_mass"] });
  });

  it("지표명 매칭 순서 — '제지방체질량'은 lbm(체지방 오인 금지), '체질량지수'는 무시", () => {
    expect(classifyBodyMetric("제지방체질량")).toBe("lbm");
    expect(classifyBodyMetric("체질량지수")).toBe(null);
    expect(classifyBodyMetric("body_mass_index")).toBe(null);
    expect(classifyBodyMetric("체중")).toBe("weight");
    expect(classifyBodyMetric("체지방률")).toBe("fatPct");
    expect(classifyBodyMetric("lean_body_mass")).toBe("lbm");
  });
});

describe("B6 — 소스 필터(있으면 InBody만, 없으면 관찰)", () => {
  it("source 'Withings' 샘플은 걸러지고 'InBody' 샘플만 수용, 관찰 로그에 둘 다 기록", async () => {
    await bodyPost(metricsPayload([
      metric("weight_body_mass", "kg", [S(D("08:24:00"), 99.9, { source: "Withings Body+" }), S(D("08:25:00"), 73.6, { source: "InBody" })]),
    ]));
    const { bodyEntries } = await pullInbox();
    expect(bodyEntries[0]).toMatchObject({ weight: 73.6 });
    expect(lastBodyLog().sources).toEqual(["Withings Body+", "InBody"]);
  });
});

describe("계약 15 — 멱등: 동시 도착 race + 재전송(앱닫힘 트리거 + 21:30 백업)", () => {
  it("완전히 같은 페이로드 동시 2요청 → 접수는 정확히 1건, 사서함 field 1개", async () => {
    const [r1, r2] = await Promise.all([bodyPost(trio()), bodyPost(trio())]);
    const total = out(r1).accepted + out(r2).accepted;
    expect(total).toBe(1);
    expect(out(r1).ignored + out(r2).ignored).toBe(1);
    expect(bodyInboxSize()).toBe(1);
  });

  it("왕복 후 재전송 → ignored(seen 영구), 사서함 재유입 없음, 최종 초안 상태 동일", async () => {
    await bodyPost(trio());
    const { bodyEntries } = await pullInbox();
    const first = mergeBodyDrafts({}, [], bodyEntries, { todayStr: TODAY });
    await ackBody(first.ackKeys);
    expect(bodyInboxSize()).toBe(0);

    const again = await bodyPost(trio()); // 21:30 백업 자동화의 재전송
    expect(out(again)).toMatchObject({ accepted: 0, ignored: 1 });
    const pull2 = await pullInbox();
    expect(pull2.bodyEntries).toHaveLength(0);
    const second = mergeBodyDrafts(first.drafts, [], pull2.bodyEntries, { todayStr: TODAY });
    expect(second.drafts).toEqual(first.drafts); // 최종 상태 동일 — 멱등
  });

  it("재측정 후 21:30 백업 — 새 최신 샘플은 새 field로 접수, 병합이 최신값으로 갱신(B2)", async () => {
    await bodyPost(trio());
    const pull1 = await pullInbox();
    const first = mergeBodyDrafts({}, [], pull1.bodyEntries, { todayStr: TODAY });
    await ackBody(first.ackKeys);

    // 저녁 백업 전송에는 아침 재측정(09:20)까지 포함 — 전체 페이로드 기준 필드별 최신이 새 키로
    await bodyPost(metricsPayload([
      metric("weight_body_mass", "kg", [S(D("08:24:00"), 73.6), S(D("09:20:00"), 73.4)]),
      metric("body_fat_percentage", "%", [S(D("08:24:00"), 18.7)]),
    ]));
    const pull2 = await pullInbox();
    expect(pull2.bodyEntries).toHaveLength(1);
    const second = mergeBodyDrafts(first.drafts, [], pull2.bodyEntries, { todayStr: TODAY });
    expect(second.drafts[TODAY]).toMatchObject({ weight: 73.4, fatPct: 18.7, lbm: 60.5 }); // lbm은 기존 초안 유지(필드별 겹침)
  });
});

describe("인증·게이트·형식 — 운동 검문소와 동일 수칙, 게이트는 독립", () => {
  it("토큰 불일치 → 401", async () => {
    const res = await bodyPost(trio(), { "x-import-token": "wrong" });
    expect(res.statusCode).toBe(401);
  });

  it("IMPORT_BODY_CUTOVER_DATE 미설정 → 503 (운동 게이트가 설정돼 있어도 체성분만 잠김)", async () => {
    vi.stubEnv("IMPORT_BODY_CUTOVER_DATE", "");
    const res = await bodyPost(trio());
    expect(res.statusCode).toBe(503);
    // 같은 상태에서 운동 검문소는 정상 활성 — 롤백 스위치의 독립성
    const wres = makeRes();
    await workoutHandler({ method: "POST", headers: { "x-import-token": TOKEN }, body: { data: { workouts: [] } } }, wres);
    expect(wres.statusCode).toBe(200);
  });

  it("metrics 빈 배열(새 측정 없음) → 400이 아니라 200 '새 체성분 없음'", async () => {
    const res = await bodyPost(metricsPayload([]));
    expect(res.statusCode).toBe(200);
    expect(out(res)).toMatchObject({ accepted: 0 });
    expect(out(res).message).toContain("새 체성분 없음");
  });

  it("운동 페이로드(workouts)가 잘못 오면 → 400 + 경로 안내", async () => {
    const res = await bodyPost({ data: { workouts: [{ name: "걷기" }] } });
    expect(res.statusCode).toBe(400);
    expect(out(res).message).toContain("/api/health-import");
  });

  it("Buffer 본문(단축어 파일 첨부)도 파싱해 동일 검문 — accepted", async () => {
    const res = await bodyPost(Buffer.from(JSON.stringify(trio())));
    expect(out(res)).toMatchObject({ accepted: 1 });
  });
});

describe("계약 14 보조 — 운동 파이프라인 격리(사서함·seen 키 완전 분리)", () => {
  it("체성분 POST는 운동 사서함에, 운동 POST는 체성분 사서함에 아무것도 남기지 않는다", async () => {
    await bodyPost(trio());
    expect((__kvState().hashes.get(`import:inbox:${UID}`) || new Map()).size).toBe(0);

    const wres = makeRes();
    await workoutHandler({ method: "POST", headers: { "x-import-token": TOKEN }, body: {
      source: "workout-end", sentAt: "2026-08-07T09:00:00+09:00",
      workouts: [{ type: "실외 달리기", start: "2026-08-07T07:00:00+09:00", end: "2026-08-07T07:30:00+09:00", durationMin: 30, kcal: 300 }],
    } }, wres);
    expect(out(wres)).toMatchObject({ accepted: 1 });
    expect(bodyInboxSize()).toBe(1); // 체성분 사서함은 여전히 앞서 넣은 1건뿐(운동 유입 없음)
    const { entries, bodyEntries } = await pullInbox();
    expect(entries).toHaveLength(1);
    expect(bodyEntries).toHaveLength(1);
  });
});
