// api/_lib/params-bridge.js — Firebase Functions params → process.env 어댑터.
//
// 왜 필요한가: 이 저장소의 핸들러(api/*.js)와 공용 모듈(_lib/*.js)은 전부 `process.env.NAME`을
// 직접 읽는다. Vercel에서 그렇게 동작했고, 그 형태 그대로 두는 것이 이번 이전의 불변식이다
// (핸들러 시그니처·env 읽는 방식 무변경 → 517개 테스트와 Vercel 병행 배포가 둘 다 산다).
// 반면 Firebase Functions v2는 값을 `defineSecret`/`defineString`이 돌려주는 **param 객체**로
// 다루고, `.value()`는 **런타임(핸들러 안)에서만** 읽어야 한다(모듈 로드 시점에 읽으면
// 배포 시 분석 단계에서 값이 없어 빈 문자열이 굳는다).
//
// 그래서 "핸들러를 고치는" 대신 여기 한 곳에서 다리를 놓는다:
//   요청 처리 시작 시 param 값을 읽어 **process.env에 아직 없을 때만** 채워 넣는다.
//
// 이미 있는 값을 덮지 않는 이유가 핵심이다:
//   - 프로덕션에서 시크릿은 런타임이 이미 process.env에 넣어 준다 → 여기서는 no-op.
//   - `.env.<project>` 파일의 값도 런타임 env로 들어온다 → 역시 no-op.
//   - 로컬·에뮬레이터·테스트에서 사람이 넣은 값이 있으면 그 값이 이긴다.
// 즉 이 모듈은 "빈 자리만 메우는" 안전망이고, 어느 플랫폼에서도 동작을 바꾸지 않는다.
//
// ⚠️ 솔직하게 적어 둔다 — **이 모듈은 관찰된 모든 환경에서 실제로는 아무것도 채우지 않는다.**
// 확인한 사실: `defineString(name, { default })`의 `.value()`는 런타임에 `process.env[name]`을
// 그대로 읽을 뿐이고, 값이 없으면 **기본값이 아니라 빈 문자열**을 돌려준다. 기본값은 배포
// (그리고 에뮬레이터 기동) 시점에 CLI가 함수의 env로 **미리 구워 넣는** 값이다 — 그래서
// 런타임에는 이미 process.env에 들어와 있고, 여기서 채울 빈 자리가 남지 않는다.
// 그럼 왜 두는가: ① 설계(01 §2)가 요구한 형태이고 ② 비용이 0(요청당 그룹별 1회)이며
// ③ 언젠가 CLI가 값을 안 굽는 경로가 생기면 그때 조용한 고장 대신 이 다리가 받는다.
// 이 사실을 모르면 "이 어댑터가 프로덕션을 떠받친다"고 착각하기 쉬워 적어 둔다.

// 한 인스턴스에서 그룹당 한 번만 돌면 충분하다(콜드스타트 뒤 env는 변하지 않는다).
// 매 요청마다 `.value()`를 부르면, 바인딩되지 않은 시크릿에 대해 SDK가 경고를 반복 출력한다.
//
// 플래그가 **그룹별**인 이유: 프로덕션에서는 함수 그룹 4개가 각각 별도 프로세스지만,
// 에뮬레이터는 넷을 한 프로세스에서 돌린다. 전역 불리언 하나면 먼저 뜬 그룹이 플래그를 소진해
// 나머지 그룹의 param이 영영 안 채워진다 — 에뮬레이터에서만 나는 종류의 버그다.
const applied = new Set();

// 테스트용 — 모듈 상태(그룹별 1회 실행 플래그)를 되돌린다.
export function resetParamsBridge() {
  applied.clear();
}

/**
 * @param {Record<string, {value: () => unknown}>} params 이름 → param 객체
 * @param {{key?: string, force?: boolean}} [opts] key=함수 그룹 이름, force=플래그 무시(테스트용)
 * @returns {string[]} 실제로 채워 넣은 env 이름 목록
 */
export function bridgeParams(params, { key = "default", force = false } = {}) {
  if (applied.has(key) && !force) return [];
  applied.add(key);
  const filled = [];
  for (const [name, param] of Object.entries(params || {})) {
    if (!param || typeof param.value !== "function") continue;
    // 이미 값이 있으면 건드리지 않는다(위 주석의 우선순위).
    const current = process.env[name];
    if (current !== undefined && current !== "") continue;
    let v;
    try {
      v = param.value();
    } catch {
      // 바인딩되지 않은 시크릿 등 — 값이 없는 것은 정상 상태(기능 off)이므로 조용히 넘어간다.
      continue;
    }
    if (v === undefined || v === null || v === "") continue;
    process.env[name] = String(v);
    filled.push(name);
  }
  return filled;
}
