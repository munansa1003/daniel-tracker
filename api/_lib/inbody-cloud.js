// api/_lib/inbody-cloud.js — 인바디 클라우드(lookinbody.com) 직수신 클라이언트.
//
// HAE(애플 건강) 경로가 체중·체지방률·제지방 3종만 나르는 것과 달리, 이 경로는 인바디
// 앱이 쓰는 클라우드 API에서 **골격근량(SMM)·인바디 점수(FS)까지 4종 전부**를 가져온다.
// HealthKit에는 골격근량·점수 항목 자체가 없어 자동화가 불가능했던 제약을 우회하는 경로다.
//
// 프로토콜 근거: 2026-08-07 실계정 검증(H20N 기기, 474건, 오늘 측정 08:20:33 조회 성공).
//   ① POST appapicommon.lookinbody.com/CommonAPI/GetCountryInfoV2
//      → Type=="API" && Code2=="KR" 행에서 지역 호스트(appapikrv3.lookinbody.com)와
//        숫자 국가코드(82)를 얻는다.
//   ② POST {api}/V2/Main/GetLoginWithSyncDataPartV2 (LoginID/LoginPW)
//      → JWT Token(24h) + Data.UID
//   ③ POST {api}/V2/InBody/GetInBodyData (Bearer JWT)
//      → 측정 레코드 배열. 블록별 필드(검증에서 확인한 실값):
//         MFA.SMM 35.1(골격근량) · MFA.PBF 18.2(체지방률) · BCA.WT 75.7(체중)
//         BCA.FFM 61.9(제지방) · WC.FS 82(인바디 점수) · BCA.EQUIP "H20N"(기기)
//         DATETIMES "20260807082033"(측정 시각, 로컬 벽시계 문자열)
//      ※ 점수는 FS — MScore/HScore/SScore는 앱 하단의 세부 점수(근육·건강·슬림)이고
//        사용자가 보는 대표 "인바디 점수"가 FS임을 실측 대조로 확정(2026-08-07 82점).
//
// 순수 모듈이 아니다(네트워크 사용) — 파싱·매핑 부분은 순수 함수로 분리해 테스트한다.
export const INBODY_COMMON_URL = "https://appapicommon.lookinbody.com";
export const INBODY_SYNC_SENTINEL = "1990-01-01 11:11:11"; // 앱이 "전체 동기화"에 쓰는 값

// 앱이 매 요청에 싣는 기기/앱 봉투 — 그대로 유지(서버가 앱 트래픽으로 인식)
const APP_ENVELOPE = {
  Language: "en", LogCode: "", AppType: "Android", OSVersion: "14",
  PhoneModel: "Google Pixel 6 Pro", RegAppType: "InBody", AppVersion: "2.8.31_914",
};
const UA_LOGIN = "okhttp/4.12.0";
const UA_DATA = "Dalvik/2.1.0 (Linux; U; Android 14; Pixel 6 Pro Build/AP2A.240905.003.F1)";

export class InBodyCloudError extends Error {}

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null; };

// "20260807082033" → "2026-08-07 08:20:33 +0900" (body-import-rules의 HAE 날짜 형식과 동일)
// 인바디는 측정 기기의 로컬 벽시계를 그대로 담으므로 오프셋만 붙이면 된다.
export function inbodyDatetimeToHae(s, tzOffsetMin = 540) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const sign = tzOffsetMin < 0 ? "-" : "+";
  const abs = Math.abs(tzOffsetMin);
  const p = (n) => String(n).padStart(2, "0");
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]} ${sign}${p(Math.floor(abs / 60))}${p(abs % 60)}`;
}

// 측정 레코드 1건 → 표준 지표 샘플 묶음. 값이 없는 지표는 생략(부분 수신 허용 B8).
// 반환: { date, samples: [{ kind, qty, units }], equip } | null
export function scanToSamples(scan, tzOffsetMin = 540) {
  if (!scan || typeof scan !== "object") return null;
  const bca = scan.BCA || {};
  const mfa = scan.MFA || {};
  const wc = scan.WC || {};
  const date = inbodyDatetimeToHae(scan.DATETIMES || bca.DATETIMES || mfa.Datetimes, tzOffsetMin);
  if (!date) return null;

  const samples = [];
  const push = (kind, v, units) => { if (v !== null) samples.push({ kind, qty: v, units }); };
  push("weight", pos(bca.WT), "kg");
  push("fatPct", pos(mfa.PBF), "%");
  push("lbm", pos(bca.FFM), "kg");
  push("muscle", pos(mfa.SMM), "kg");     // 골격근량 — HAE 경로에는 없는 값
  push("score", pos(wc.FS), "point");     // 인바디 점수 — 실측 대조로 FS 확정
  if (!samples.length) return null;

  return { date, samples, equip: String(bca.EQUIP || "").slice(0, 20) };
}

// 인바디 클라우드 응답 → body-import 검문소가 받는 HAE 형태의 metrics 페이로드.
// 이 변환 덕분에 클라우드 경로도 기존 검문 규칙(B1 아침 창·B4 소수형·B5 범위·B7 컷오버)을
// 한 글자도 바꾸지 않고 그대로 통과한다 — 소스만 추가, 규칙은 단일 출처 유지.
export const CLOUD_METRIC_NAMES = {
  weight: "weight_body_mass", fatPct: "body_fat_percentage",
  lbm: "lean_body_mass", muscle: "skeletal_muscle_mass", score: "inbody_score",
};
export function scansToMetricsPayload(scans, tzOffsetMin = 540) {
  const byKind = new Map();
  for (const scan of scans || []) {
    const parsed = scanToSamples(scan, tzOffsetMin);
    if (!parsed) continue;
    for (const s of parsed.samples) {
      if (!byKind.has(s.kind)) byKind.set(s.kind, { name: CLOUD_METRIC_NAMES[s.kind], units: s.units, data: [] });
      byKind.get(s.kind).data.push({ date: parsed.date, qty: s.qty, source: `InBody ${parsed.equip}`.trim() });
    }
  }
  return { data: { metrics: [...byKind.values()] } };
}

// ── 네트워크 계층 ──────────────────────────────────────────────
async function postJson(url, body, headers, ua) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": ua, ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new InBodyCloudError(`인바디 API ${res.status}`);
  const data = await res.json();
  if (data && data.IsSuccess === false) throw new InBodyCloudError(`인바디 API 오류: ${data.ErrorMsg || "unknown"}`);
  return data;
}

// 지역 호스트 + 숫자 국가코드 해석 (ISO Code2 기준 — 숫자 코드는 US/CA가 공유해 모호)
export async function resolveHost(countryCode = "KR") {
  const data = await postJson(`${INBODY_COMMON_URL}/CommonAPI/GetCountryInfoV2`,
    { ...APP_ENVELOPE, CountryCode: "", SyncDatetime: INBODY_SYNC_SENTINEL }, {}, UA_LOGIN);
  const rows = data.Data || [];
  const row = rows.find((r) => r && r.Type === "API" && String(r.Code2).toUpperCase() === countryCode.toUpperCase());
  if (!row) throw new InBodyCloudError(`국가 ${countryCode}의 API 호스트를 찾지 못함`);
  return { base: String(row.Domain).replace(/\/+$/, ""), country: String(row.Number) };
}

export async function login({ base, country, loginId, loginPw }) {
  const data = await postJson(`${base}/V2/Main/GetLoginWithSyncDataPartV2`, {
    ...APP_ENVELOPE, CountryCode: country,
    AuthProvider: "", AuthProviderID: "", AuthToken: "", CustomKey: "",
    DeviceType: "Pixel 6 Pro 14", LoginID: loginId, LoginPW: loginPw, Type: "Login",
    SyncDatetime: INBODY_SYNC_SENTINEL, SyncDatetimeBasalMedical: INBODY_SYNC_SENTINEL,
    SyncDatetimeCardiac: INBODY_SYNC_SENTINEL, SyncDatetimeExercise: INBODY_SYNC_SENTINEL,
    SyncDatetimeInBody: INBODY_SYNC_SENTINEL, SyncDatetimeNutrition: INBODY_SYNC_SENTINEL,
    SyncDatetimeSleep: INBODY_SYNC_SENTINEL,
    SyncType: "Main;InBody;Exercise;Nutrition;Sleep;EasyTrainning;BasalMedical;",
  }, {}, UA_LOGIN);
  const token = data.Token;
  const uid = data.Data && data.Data.UID;
  if (!token || !uid) throw new InBodyCloudError("로그인 실패 — 아이디·비밀번호 확인");
  return { token, uid: String(uid) };
}

// 최근 측정 N건 조회. UseInBodyHomeDevice=true — H20 등 가정용 기기 포함(검증 확인).
export async function fetchScans({ base, country, token, uid }, count = 5) {
  const data = await postJson(`${base}/V2/InBody/GetInBodyData`, {
    ...APP_ENVELOPE, CountryCode: country, uid, syncDatetime: INBODY_SYNC_SENTINEL,
    NumberPerData: String(count), CurrentIndex: "0", Language: "en-US", UseInBodyHomeDevice: "true",
  }, { Authorization: `Bearer ${token}` }, UA_DATA);
  return data.Data || [];
}

// 한 번의 호출로 최근 측정을 metrics 페이로드까지 만들어 돌려준다(검문소가 그대로 소비).
export async function pullRecentMetrics({ loginId, loginPw, countryCode = "KR", count = 5, tzOffsetMin = 540 }) {
  const { base, country } = await resolveHost(countryCode);
  const { token, uid } = await login({ base, country, loginId, loginPw });
  const scans = await fetchScans({ base, country, token, uid }, count);
  return { payload: scansToMetricsPayload(scans, tzOffsetMin), scanCount: scans.length };
}
