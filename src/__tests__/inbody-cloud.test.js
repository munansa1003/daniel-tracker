// 인바디 클라우드 직수신(A안) — 계약 테스트 (골든셋).
// 픽스처는 2026-08-07 실계정 검증(inbody-probe)에서 확보한 실제 응답 구조 그대로:
// BCA.WT 75.7 · MFA.SMM 35.1 · MFA.PBF 18.2 · BCA.FFM 61.9 · WC.FS 82 · EQUIP H20N.
// 점수 필드는 FS — 같은 날 인바디 앱 표시 점수(82점)와 실측 대조로 확정.
// 검증 대상: ① 스캔→표준 지표 변환(순수) ② 기존 검문 규칙 무수정 통과 ③ pull 시
// 클라우드 합류(스로틀·실패 격리) ④ 4종 완비 초안의 자동 확정(LBM 가드 = 승격 조건).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../api/_lib/kv.js", () => {
  const strs = new Map();
  const hashes = new Map();
  const lists = new Map();
  // Upstash KV는 HTTP 왕복이다. 기본값(false)은 즉시 반환이라 빠르지만, 그 상태로는
  // 동시 요청이 마이크로태스크로 직렬화돼 경합을 재현할 수 없다 — 실제 I/O 틱을 흉내내야
  // 두 요청이 인터리브된다. 동시성 테스트에서만 켠다(2026-08 감사 R-01 회귀 방어).
  let netDelay = false;
  async function kv(cmd, ...args) {
    const c = String(cmd).toUpperCase();
    if (netDelay) await new Promise((r) => setTimeout(r, 0));
    switch (c) {
      case "GET":
        return strs.has(args[0]) ? strs.get(args[0]) : null;
      case "SET": {
        const [key, value, ...flags] = args;
        if (flags.map((f) => String(f).toUpperCase()).includes("NX") && strs.has(key)) return null;
        strs.set(key, String(value));
        return "OK";
      }
      case "DEL": {
        let n = 0;
        for (const k of args) if (strs.delete(k)) n++;
        return n;
      }
      // 실패 카운터는 INCR(원자)로 올린다 — GET→parseInt→SET은 동시 실패 시 증분이
      // 유실돼 상한 도달이 늦어진다(= 인바디 계정을 더 두드린다). 2026-08 감사 R-01.
      case "INCR": {
        const next = (parseInt(strs.get(args[0]) || "0", 10) || 0) + 1;
        strs.set(args[0], String(next));
        return next;
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
    __kvReset: () => { strs.clear(); hashes.clear(); lists.clear(); netDelay = false; },
    __kvState: () => ({ strs, hashes, lists }),
    __kvNetDelay: (on) => { netDelay = on; },
  };
});

vi.mock("../../api/_lib/verify-uid.js", () => ({
  verifyUid: async (idToken) => idToken === "id-token-good",
}));

// 네트워크 함수(pullRecentMetrics)만 대체 — 순수 변환 함수들은 실제 구현 그대로 검증한다.
vi.mock("../../api/_lib/inbody-cloud.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, pullRecentMetrics: vi.fn() };
});

import inboxHandler, { pullCount } from "../../api/import-inbox.js";
import { __kvReset, __kvState, __kvNetDelay } from "../../api/_lib/kv.js";
import {
  inbodyDatetimeToHae, scanToSamples, scansToMetricsPayload, pullRecentMetrics,
} from "../../api/_lib/inbody-cloud.js";
import { planBodyImport, classifyBodyMetric } from "../../api/_lib/body-import-rules.js";
import { mergeBodyDrafts, autoConfirmDrafts } from "../bodyDraft.js";

const UID = "uid-1";
const TODAY = "2026-08-07";
const TS = Date.parse("2026-08-07T08:20:33+09:00");

// 실계정 검증에서 확보한 응답 구조 — 값이 문자열로 오는 경우까지 재현(관대한 숫자 파싱 검증)
const SCAN = {
  DATETIMES: "20260807082033",
  BCA: { DATETIMES: "20260807082033", WT: "75.7", FFM: "61.9", BFM: "13.8", EQUIP: "H20N" },
  MFA: { Datetimes: "20260807082033", SMM: "35.1", PBF: "18.2", BMI: "24.7" },
  WC: { Datetimes: "20260807082033", FS: "82", HScore: "80.1", MScore: "79.7", SScore: "78.4" },
};

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: "",
    status(c) { res.statusCode = c; return res; },
    setHeader() { return res; }, end() { return res; },
    send(b) { res.body = typeof b === "string" ? b : JSON.stringify(b); return res; },
    json(o) { res.body = JSON.stringify(o); return res; },
  };
  return res;
}
const out = (res) => JSON.parse(res.body);
async function inboxCall(body) {
  const res = makeRes();
  await inboxHandler({ method: "POST", headers: { origin: "http://localhost:5173" }, body }, res);
  return res;
}
const pullInbox = async () => out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "pull" }));
const lastBodyLog = () => JSON.parse((__kvState().lists.get(`import:body-log:${UID}`) || [])[0]);

beforeEach(() => {
  __kvReset();
  pullRecentMetrics.mockReset();
  vi.stubEnv("IMPORT_TOKEN", "tok-secret");
  vi.stubEnv("IMPORT_UID", UID);
  vi.stubEnv("IMPORT_CUTOVER_DATE", "2026-08-01");
  vi.stubEnv("IMPORT_BODY_CUTOVER_DATE", "2026-08-01");
  vi.stubEnv("INBODY_LOGIN_ID", "01000000000");
  vi.stubEnv("INBODY_LOGIN_PW", "pw");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("스캔 → 표준 지표 변환 (순수 계층)", () => {
  it("인바디 날짜(20260807082033) → HAE 형식(2026-08-07 08:20:33 +0900)", () => {
    expect(inbodyDatetimeToHae("20260807082033")).toBe("2026-08-07 08:20:33 +0900");
    expect(inbodyDatetimeToHae("bad")).toBe(null);
  });

  it("실측 스캔 1건 → 5종 샘플 (WT·PBF·FFM·SMM·FS, 문자열 값도 수용)", () => {
    const r = scanToSamples(SCAN);
    expect(r.date).toBe("2026-08-07 08:20:33 +0900");
    expect(r.equip).toBe("H20N");
    expect(r.samples).toEqual([
      { kind: "weight", qty: 75.7, units: "kg" },
      { kind: "fatPct", qty: 18.2, units: "%" },
      { kind: "lbm", qty: 61.9, units: "kg" },
      { kind: "muscle", qty: 35.1, units: "kg" },
      { kind: "score", qty: 82, units: "point" },
    ]);
  });

  it("지표명 매칭 — skeletal_muscle_mass→muscle, inbody_score→score (기존 3종 유지)", () => {
    expect(classifyBodyMetric("skeletal_muscle_mass")).toBe("muscle");
    expect(classifyBodyMetric("inbody_score")).toBe("score");
    expect(classifyBodyMetric("골격근량")).toBe("muscle");
    expect(classifyBodyMetric("인바디 점수")).toBe("score");
    expect(classifyBodyMetric("weight_body_mass")).toBe("weight");
    expect(classifyBodyMetric("체질량지수")).toBe(null); // BMI 제외 불변
  });

  it("변환 페이로드가 기존 검문(planBodyImport)을 무수정 통과 — 5필드 entry + 소스 필터", () => {
    const payload = scansToMetricsPayload([SCAN]);
    const { entries, summary } = planBodyImport(payload, { cutoverDate: "2026-08-01", tzOffsetMin: 540 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      key: `${TODAY}|${TS}`, date: TODAY, sampleTs: TS,
      weight: 75.7, fatPct: 18.2, lbm: 61.9, muscle: 35.1, score: 82,
    });
    expect(summary.rejected).toBe(0);
    expect(summary.sources).toEqual(["InBody H20N"]); // B6: InBody 소스 통과 + 관찰 기록
    expect(summary.fatPctForm).toBe("18.2");          // §1.4-⑵ 관측 유지
  });

  it("범위 방어 — 골격근 200kg·점수 5점은 거부(B5 확장)", () => {
    const bad = { data: { metrics: [
      { name: "skeletal_muscle_mass", units: "kg", data: [{ date: "2026-08-07 08:20:33 +0900", qty: 200 }] },
      { name: "inbody_score", units: "point", data: [{ date: "2026-08-07 08:20:33 +0900", qty: 5 }] },
    ] } };
    const { entries, summary } = planBodyImport(bad, { cutoverDate: "2026-08-01", tzOffsetMin: 540 });
    expect(entries).toHaveLength(0);
    expect(summary.rejected).toBe(2);
  });

  it("저녁 재측정도 클라우드 경로에서 수용된다 (B1 완화 — 하루 종일 최신 채택)", () => {
    const evening = { ...SCAN, DATETIMES: "20260807210000", BCA: { ...SCAN.BCA, DATETIMES: "20260807210000" } };
    const { entries, summary } = planBodyImport(scansToMetricsPayload([evening]), { cutoverDate: "2026-08-01", tzOffsetMin: 540 });
    expect(entries).toHaveLength(1);
    expect(summary.excluded).toBe(0);
    expect(entries[0]).toMatchObject({ date: "2026-08-07", sampleTs: Date.parse("2026-08-07T21:00:00+09:00") });
  });
});

describe("자동 확정 — 4종 실측 완비 + LBM 가드 통과 시에만 (스펙 개정 2026-08-07)", () => {
  const fullDraft = { weight: 75.7, fatPct: 18.2, lbm: 61.9, muscle: 35.1, score: 82, sampleTs: TS };

  it("완비 초안 → 사용자 입력 없이 확정 (auto·source 마커, 초안 제거)", () => {
    const r = autoConfirmDrafts({ [TODAY]: fullDraft }, []);
    expect(r.confirmed).toEqual([TODAY]);
    expect(r.drafts[TODAY]).toBeUndefined();
    expect(r.bodyLog).toEqual([{
      date: TODAY, weight: 75.7, muscle: 35.1, fatPct: 18.2, score: 82,
      lbm: 61.9, source: "import", auto: true, sampleTs: TS, // sampleTs: 더 최신 재측정 갱신 판별용
    }]);
  });

  it("자동 확정 레코드는 같은 날 '더 최신' 측정으로 갱신된다 (하루 종일 재측정 반영)", () => {
    const first = autoConfirmDrafts({ [TODAY]: fullDraft }, []);
    // 저녁 재측정(더 큰 sampleTs)이 초안으로 도착 → merge가 잠그지 않고, autoConfirm이 교체
    const later = { weight: 76.2, fatPct: 18.9, lbm: 62.0, muscle: 35.4, score: 80, sampleTs: TS + 3600_000 };
    const bd = mergeBodyDrafts({}, first.bodyLog, [{ key: `${TODAY}|${TS + 3600_000}`, date: TODAY, sampleTs: TS + 3600_000, ...later }], { todayStr: TODAY });
    const ac = autoConfirmDrafts(bd.drafts, first.bodyLog);
    expect(ac.confirmed).toEqual([TODAY]);
    expect(ac.bodyLog).toHaveLength(1);
    expect(ac.bodyLog[0]).toMatchObject({ weight: 76.2, muscle: 35.4, score: 80, sampleTs: TS + 3600_000, auto: true });
  });

  it("사용자가 편집한 레코드(auto 없음)는 잠금 — 더 최신 측정이 와도 덮지 않는다", () => {
    const edited = [{ date: TODAY, weight: 75.0, muscle: 36.0, fatPct: 18.0, score: 85, lbm: 61.9, source: "import" }]; // auto 제거됨
    const later = { weight: 76.2, muscle: 35.4, fatPct: 18.9, lbm: 62.0, score: 80, sampleTs: TS + 3600_000 };
    const bd = mergeBodyDrafts({}, edited, [{ key: `${TODAY}|${TS + 3600_000}`, date: TODAY, sampleTs: TS + 3600_000, ...later }], { todayStr: TODAY });
    expect(bd.drafts[TODAY]).toBeUndefined();        // 착지 없이
    expect(bd.ackKeys).toEqual([`${TODAY}|${TS + 3600_000}`]); // 폐기
    const ac = autoConfirmDrafts(bd.drafts, edited);
    expect(ac.changed).toBe(false);
    expect(ac.bodyLog[0]).toMatchObject({ weight: 75.0, muscle: 36.0 }); // 편집값 보존
  });

  it("LBM 가드 위반(43.7/61.9=0.71) → 자동 확정 보류, 초안 유지(카드 폴백)", () => {
    const r = autoConfirmDrafts({ [TODAY]: { ...fullDraft, muscle: 43.7 } }, []);
    expect(r.changed).toBe(false);
    expect(r.drafts[TODAY]).toMatchObject({ muscle: 43.7 }); // 수신값 보존 — 카드에 표시
    expect(r.bodyLog).toEqual([]);
  });

  it("잠금 — 그 날짜 레코드가 이미 있으면(수동 선입력 포함) 자동 확정하지 않는다", () => {
    const manual = { date: TODAY, weight: 75.7, muscle: 34.7, fatPct: 18.2, score: 81 };
    const r = autoConfirmDrafts({ [TODAY]: fullDraft }, [manual]);
    expect(r.changed).toBe(false);
    expect(r.bodyLog).toEqual([manual]); // 수동 기록 불변
  });

  it("muscle 없는 초안(HAE 경로)은 대상 아님 — 기존 수동 확정 플로우 유지", () => {
    const r = autoConfirmDrafts({ [TODAY]: { weight: 75.7, fatPct: 18.2, lbm: 61.9, sampleTs: TS } }, []);
    expect(r.changed).toBe(false);
  });

  it("score 없이 muscle만 완비돼도 확정(score 0) — 부분 수신 B8 일관", () => {
    const r = autoConfirmDrafts({ [TODAY]: { weight: 75.7, muscle: 35.1, lbm: 61.9, sampleTs: TS } }, []);
    expect(r.bodyLog[0]).toMatchObject({ muscle: 35.1, score: 0, auto: true });
  });
});

describe("사서함 pull 합류 — 클라우드 직수신·스로틀·실패 격리", () => {
  const cloudResult = () => ({ payload: scansToMetricsPayload([SCAN]), scanCount: 1 });

  it("pull 한 번에 클라우드 측정이 검문을 거쳐 bodyEntries로 착지 + 로그 source=cloud", async () => {
    pullRecentMetrics.mockResolvedValue(cloudResult());
    const { bodyEntries } = await pullInbox();
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);
    expect(bodyEntries).toHaveLength(1);
    expect(bodyEntries[0]).toMatchObject({ weight: 75.7, fatPct: 18.2, lbm: 61.9, muscle: 35.1, score: 82 });
    expect(lastBodyLog()).toMatchObject({ source: "cloud", accepted: 1, samplesToday: 1 });
  });

  it("30분 스로틀 — 연속 pull은 인바디를 다시 호출하지 않는다(사서함은 정상 반환)", async () => {
    pullRecentMetrics.mockResolvedValue(cloudResult());
    await pullInbox();
    const second = await pullInbox();
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);
    expect(second.bodyEntries).toHaveLength(1); // 아직 ack 전 — 사서함 내용은 그대로 온다
  });

  it("'지금 확인'(force) — 스로틀 중이어도 즉시 재pull (명시적 사용자 의도)", async () => {
    pullRecentMetrics.mockResolvedValue(cloudResult());
    await pullInbox();                                     // 1회차 — 스로틀 도장
    await pullInbox();                                     // 자동 pull — 스로틀에 걸림
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);
    await inboxCall({ uid: UID, idToken: "id-token-good", action: "pull", force: true });
    expect(pullRecentMetrics).toHaveBeenCalledTimes(2);    // force는 즉시 호출
  });

  it("클라우드 실패 → 카드용 오류 로그 한 줄 (성공이든 실패든 흔적을 남긴다)", async () => {
    // "지금 확인"이 성공이든 실패든 반드시 흔적을 남긴다 — 무반응이 곧 관측성 구멍이었던 회귀 방지
    pullRecentMetrics.mockRejectedValueOnce(new Error("인바디 API 오류: ID_BLOCK"));
    const first = await pullInbox();
    expect(first.entries).toBeDefined();                   // 실패해도 pull 응답은 정상(격리)
    // 인증 실패에는 크리덴셜 "형태"(길이·앞 3자)가 덧붙는다 — 값 노출 없이 오타·잘림 판별
    expect(lastBodyLog().error).toBe("인바디 API 오류: ID_BLOCK — ID 11자(010…) · PW 2자");
    expect(lastBodyLog().error).not.toContain("pw");   // 값 자체는 절대 남기지 않는다
  });

  it("실패해도 스로틀 도장은 유지 — 자동 pull이 실패 상태에서 인바디를 두드리지 않는다(계정 보호)", async () => {
    // 인바디는 로그인 실패 반복 시 계정을 잠근다(공식 FAQ 3-strike). 실패 후 즉시 재시도하던
    // 옛 동작은 우리 서버가 계정을 잠그는 경로였다 — 이제 창을 지킨다.
    pullRecentMetrics.mockRejectedValueOnce(new Error("인바디 API 오류: ID_BLOCK"));
    await pullInbox();
    pullRecentMetrics.mockResolvedValue(cloudResult());
    await pullInbox();                                     // 자동 pull — 30분 창에 걸려 호출 안 함
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);
  });

  it("연속 실패 상한(3회) 도달 → '지금 확인'(force)도 창을 지킨다 (연타로 계정 잠금 유발 차단)", async () => {
    // 일시적 오류(네트워크·5xx)는 재시도할 가치가 있으므로 상한까지는 force를 허용한다
    pullRecentMetrics.mockRejectedValue(new Error("인바디 API 502"));
    const forcePull = () => inboxCall({ uid: UID, idToken: "id-token-good", action: "pull", force: true });
    await forcePull(); await forcePull(); await forcePull(); // 1·2·3회차: force가 창을 무시하고 시도
    expect(pullRecentMetrics).toHaveBeenCalledTimes(3);
    await forcePull();                                      // 상한 도달 — 이번엔 창을 지켜 호출 안 함
    expect(pullRecentMetrics).toHaveBeenCalledTimes(3);
  });

  // ── 동시 실행 선점 (2026-08 감사 R-01) ──────────────────────────────
  // 옛 코드는 스로틀 도장을 `GET → 비교 → SET`으로 찍어 그 사이가 열려 있었다. 두 기기가
  // 동시에 앱을 열면 둘 다 창을 통과해 인바디에 로그인을 두 번 시도했고, 비밀번호가 틀린
  // 상태였다면 봉인이 걸리기 전에 3-strike 중 2개를 한 번에 태웠다. 지금은 SET NX 선점.
  it("동시 pull 2건 → 인바디 로그인은 1회만 (SET NX 선점)", async () => {
    __kvNetDelay(true); // 실제 I/O 틱 — 이게 없으면 두 요청이 인위적으로 직렬화된다
    pullRecentMetrics.mockResolvedValue(cloudResult());
    const [a, b] = await Promise.all([pullInbox(), pullInbox()]);
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);
    // 진 쪽은 조용히 사라지지 않고 이유가 실린다(관측성) — 사서함 응답 자체는 정상
    expect([a.bodyCloudStatus, b.bodyCloudStatus].sort()).toEqual(["ok", "throttled"]);
  });

  it("비밀번호 오류 상태의 동시 pull 2건도 인바디 실패 카운터를 1만 깎는다 (계정 잠금 방어)", async () => {
    __kvNetDelay(true);
    pullRecentMetrics.mockRejectedValue(new Error("인바디 API 오류: PW_FAIL_3"));
    await Promise.all([pullInbox(), pullInbox()]);
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);
    // 그 1회로 봉인까지 완료 — 이후 force도 막힌다
    const after = out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "pull", force: true }));
    expect(after.bodyCloudStatus).toBe("authBlocked");
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);
  });

  it("선점은 실행이 끝나면 해제된다 — 순차 재시도(연타)는 기존과 동일", async () => {
    pullRecentMetrics.mockResolvedValue(cloudResult());
    expect((await pullInbox()).bodyCloudStatus).toBe("ok");
    const forced = out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "pull", force: true }));
    expect(forced.bodyCloudStatus).toBe("ok");              // 잠금이 남아 있었다면 throttled
    expect(pullRecentMetrics).toHaveBeenCalledTimes(2);
  });

  it("인증 실패(PW_FAIL) → 단 1회로 크리덴셜 봉인, force도 즉시 차단 (남은 시도 횟수 보호)", async () => {
    // 실측 2026-08-07: 잘못된 비밀번호로 재시도할수록 인바디가 PW_FAIL_4 → _3 → _2로
    // 남은 횟수를 깎아 계정 잠금 직전까지 갔다. 인증 실패는 재시도로 낫지 않으므로 즉시 봉인한다.
    pullRecentMetrics.mockRejectedValue(new Error("인바디 API 오류: PW_FAIL_2"));
    const forcePull = () => inboxCall({ uid: UID, idToken: "id-token-good", action: "pull", force: true });
    await forcePull();
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);
    expect(lastBodyLog().error).toContain("PW_FAIL_2");
    expect(lastBodyLog().error).toContain("PW 2자");   // 저장된 비밀번호의 형태로 오타·잘림 판별
    await forcePull(); await forcePull();                   // 연타해도 인바디를 두드리지 않는다
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);
  });

  it("봉인은 크리덴셜 지문에 묶인다 — env에서 비밀번호를 고치면 24시간 대기 없이 즉시 재시도", async () => {
    pullRecentMetrics.mockRejectedValue(new Error("인바디 API 오류: PW_FAIL_2"));
    const forcePull = () => inboxCall({ uid: UID, idToken: "id-token-good", action: "pull", force: true });
    await forcePull();
    await forcePull();
    expect(pullRecentMetrics).toHaveBeenCalledTimes(1);      // 봉인 중
    vi.stubEnv("INBODY_LOGIN_PW", "고친-비밀번호");           // 지문이 바뀌면 다른 봉인으로 취급
    pullRecentMetrics.mockResolvedValue(cloudResult());
    await forcePull();
    expect(pullRecentMetrics).toHaveBeenCalledTimes(2);      // 즉시 재시도되고
    expect(lastBodyLog()).toMatchObject({ source: "cloud", accepted: 1 }); // 성공
  });

  it("성공하면 실패 카운터 리셋 — 일시적 장애 뒤 정상 복귀 시 force가 다시 즉시 동작", async () => {
    pullRecentMetrics.mockRejectedValue(new Error("일시 오류"));
    const forcePull = () => inboxCall({ uid: UID, idToken: "id-token-good", action: "pull", force: true });
    await forcePull(); await forcePull();                   // 실패 2회 — 아직 상한 미만
    pullRecentMetrics.mockResolvedValue(cloudResult());
    await forcePull();                                      // 3회차에서 성공 → 카운터 0
    expect(pullRecentMetrics).toHaveBeenCalledTimes(3);
    await forcePull();                                      // 카운터가 리셋됐으므로 force는 다시 즉시
    expect(pullRecentMetrics).toHaveBeenCalledTimes(4);
  });

  it("bodyCloudStatus — 건너뛴 이유가 응답에 실린다 (조용한 skip을 버튼 고장으로 오인하지 않게)", async () => {
    pullRecentMetrics.mockResolvedValue(cloudResult());
    expect((await pullInbox()).bodyCloudStatus).toBe("ok");          // 실행함
    expect((await pullInbox()).bodyCloudStatus).toBe("throttled");   // 30분 창

    vi.stubEnv("INBODY_LOGIN_PW", "");                               // 크리덴셜 미설정
    expect((await pullInbox()).bodyCloudStatus).toBe("off");

    __kvReset();
    vi.stubEnv("INBODY_LOGIN_PW", "pw");
    pullRecentMetrics.mockRejectedValue(new Error("인바디 API 오류: PW_FAIL_2"));
    expect((await pullInbox()).bodyCloudStatus).toBe("failed");      // 시도했으나 인증 실패
    const forced = out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "pull", force: true }));
    expect(forced.bodyCloudStatus).toBe("authBlocked");              // 봉인 — 화면에 이유가 보인다
  });

  it("env 공백 오염 방어 — 앞뒤 공백·개행이 섞여도 트림된 크리덴셜로 호출", async () => {
    vi.stubEnv("INBODY_LOGIN_ID", " 01000000000\n");
    vi.stubEnv("INBODY_LOGIN_PW", " pw ");
    pullRecentMetrics.mockResolvedValue(cloudResult());
    await pullInbox();
    expect(pullRecentMetrics).toHaveBeenCalledWith(expect.objectContaining({ loginId: "01000000000", loginPw: "pw" }));
  });

  it("클라우드 실패 → pull은 200으로 계속(격리) + 사용자가 '지금 확인'하면 즉시 재시도", async () => {
    pullRecentMetrics.mockRejectedValueOnce(new Error("inbody down"));
    const first = await pullInbox();
    expect(first.bodyEntries).toHaveLength(0);   // 클라우드가 죽어도 운동·HAE pull은 정상 응답
    pullRecentMetrics.mockResolvedValue(cloudResult());
    // 자동 pull은 창을 지키지만(계정 보호), 상한 미만이면 force는 즉시 재시도할 수 있다
    const second = out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "pull", force: true }));
    expect(pullRecentMetrics).toHaveBeenCalledTimes(2);
    expect(second.bodyEntries).toHaveLength(1);
  });

  it("INBODY 크리덴셜 미설정 → 클라우드 경로만 조용히 꺼짐(독립 롤백 스위치)", async () => {
    vi.stubEnv("INBODY_LOGIN_ID", "");
    const r = await pullInbox();
    expect(pullRecentMetrics).not.toHaveBeenCalled();
    expect(r.bodyEntries).toHaveLength(0);
    expect(r.bodyCloudEnabled).toBe(false);
    expect(r.bodyEnabled).toBe(true); // HAE 경로는 그대로 활성
  });

  it("주인 아닌 uid의 pull은 클라우드를 트리거하지 못한다", async () => {
    vi.stubEnv("IMPORT_UID", "someone-else");
    pullRecentMetrics.mockResolvedValue(cloudResult());
    await pullInbox();
    expect(pullRecentMetrics).not.toHaveBeenCalled();
  });

  it("완전 무접촉 E2E — pull→병합→자동 확정: 4종 실측이 bodylog 레코드로", async () => {
    pullRecentMetrics.mockResolvedValue(cloudResult());
    const { bodyEntries } = await pullInbox();
    const bd = mergeBodyDrafts({}, [], bodyEntries, { todayStr: TODAY });
    const ac = autoConfirmDrafts(bd.drafts, []);
    expect(ac.confirmed).toEqual([TODAY]);
    expect(ac.bodyLog).toEqual([{
      date: TODAY, weight: 75.7, muscle: 35.1, fatPct: 18.2, score: 82,
      lbm: 61.9, source: "import", auto: true, sampleTs: TS,
    }]);
    expect(Object.keys(ac.drafts)).toHaveLength(0);
    // 같은 측정의 재pull(스로틀 밖 재호출 가정)도 seen 멱등 — 새 접수 없음
    __kvState().strs.delete(`import:body-cloud-at:${UID}`);
    pullRecentMetrics.mockResolvedValue(cloudResult());
    await pullInbox();
    expect(lastBodyLog()).toMatchObject({ source: "cloud", accepted: 0, ignored: 1 });
  });
});

/* 당겨올 건수는 마지막 성공 이후 벌어진 만큼 넓어진다 — 감사 R-30.
   "최근 5건" 고정이던 옛 동작에서는, 앱을 며칠 안 열면 5건 창 밖으로 밀려난 측정이
   클라우드 경로로는 영영 들어오지 않았다(HAE가 죽었을 때가 바로 이 경로가 필요한 때다). */
describe("pullCount — 공백이 길수록 넓게 당긴다 (R-30)", () => {
  const T = Date.parse("2026-08-09T12:00:00Z");
  const ago = (days) => new Date(T - days * 86400000).toISOString();

  it("방금 성공했으면 기존과 같은 최소치", () => {
    expect(pullCount(ago(0), T)).toBe(5);
  });
  it("하루 벌어질 때마다 창이 넓어진다", () => {
    expect(pullCount(ago(1), T)).toBe(8);
    expect(pullCount(ago(3), T)).toBe(14);
    expect(pullCount(ago(6), T)).toBe(23);
  });
  it("상한을 넘지 않는다 (시간 예산 보호)", () => {
    expect(pullCount(ago(30), T)).toBe(30);
    expect(pullCount(ago(365), T)).toBe(30);
  });
  it("첫 pull(기준 없음)·값 손상 시에는 상한으로 — 좁혀서 유실하느니 넓게", () => {
    expect(pullCount(null, T)).toBe(30);
    expect(pullCount("", T)).toBe(30);
    expect(pullCount("깨진 값", T)).toBe(30);
  });
  it("시계가 뒤로 간 경우에도 음수로 내려가지 않는다", () => {
    expect(pullCount(new Date(T + 86400000).toISOString(), T)).toBe(5);
  });
});

/* ack는 건수가 많아도 교착되지 않는다 — 감사 R-37.
   옛 동작은 500건을 넘으면 400으로 거절했다. 그런데 사서함 적재에는 상한이 없어서,
   오래 안 열어 쌓이면 ack가 영영 실패하고 → 사서함이 안 비고 → 다음 pull에도 같은 수가
   내려오는 교착이 된다. 상한을 올리는 대신 나눠서 지운다(상한 자체가 새 실패 모드다). */
describe("ack — 대량 건수 교착 방지 (R-37)", () => {
  const seedInbox = (n) => {
    const st = __kvState();
    const h = new Map();
    for (let i = 0; i < n; i++) h.set(`key-${i}`, JSON.stringify({ importKey: `key-${i}` }));
    st.hashes.set(`import:inbox:${UID}`, h);
    return [...h.keys()];
  };

  it("600건을 한 번에 ack해도 성공하고 사서함이 완전히 빈다", async () => {
    const keys = seedInbox(600);
    const r = out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "ack", keys }));
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(600);
    expect(__kvState().hashes.get(`import:inbox:${UID}`).size).toBe(0);
  });

  it("경계(200의 배수·나머지)에서도 하나도 남기지 않는다", async () => {
    for (const n of [199, 200, 201, 400]) {
      __kvReset();
      const keys = seedInbox(n);
      const r = out(await inboxCall({ uid: UID, idToken: "id-token-good", action: "ack", keys }));
      expect(r.removed).toBe(n);
      expect(__kvState().hashes.get(`import:inbox:${UID}`).size).toBe(0);
    }
  });

  it("키가 하나도 없으면 여전히 400 — '없음'과 '많음'을 뒤섞지 않는다", async () => {
    const res = await inboxCall({ uid: UID, idToken: "id-token-good", action: "ack", keys: [] });
    expect(res.statusCode).toBe(400);
  });
});
