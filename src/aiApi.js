// src/aiApi.js — AI 분석 API(/api/analyze-*) 호출 공용 함수.
// 요청 본문에 로그인 토큰(idToken)을 함께 실어 보낸다. 서버는 AI_ALLOWED_UIDS가 설정돼 있을 때만
// 이 토큰을 검사하고, 없으면 무시한다(병행 호환). 미로그인/토큰 갱신 실패면 토큰 없이 보낸다.
import { getIdToken } from "./auth.js";

export async function postAI(path, payload) {
  const idToken = await getIdToken();
  const body = idToken ? { ...payload, idToken } : payload;
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
