// 운영자 이메일 이중 정의의 정합성 — 2026-08 감사 R-49.
//
// 운영자 판정은 두 곳에 있다: src/auth.js(클라이언트)와 firestore.rules(서버 규칙).
// 규칙 파일은 환경변수를 읽을 수 없어 값을 하드코딩할 수밖에 없고, 두 파일 모두 주석으로
// "반드시 같게 유지"라고만 적혀 있었다 — 강제하는 것은 없었다.
// 한쪽만 바꾸면 "클라이언트는 운영자로 보는데 규칙은 거부"가 되고, 증상은 초대 코드 화면이
// 계속 뜨거나 공용 DB 쓰기가 조용히 실패하는 형태라 원인이 이 파일들로 이어지지 않는다.
// 주석에 맡기지 말고 여기서 깨뜨린다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("운영자 이메일 — auth.js와 firestore.rules 동기화 (R-49)", () => {
  const authSrc = read("../auth.js");
  const rulesSrc = read("../../firestore.rules");

  it("두 파일에서 각각 이메일을 정확히 하나씩 뽑아낼 수 있다", () => {
    // 정규식이 헛돌아 "둘 다 못 찾음 → 통과"가 되는 것을 막는 자기검증
    expect(/VITE_OWNER_EMAIL \|\| "([^"]+)"/.exec(authSrc)).toBeTruthy();
    expect(/request\.auth\.token\.email == '([^']+)'/.exec(rulesSrc)).toBeTruthy();
  });

  it("하드코딩 기본값이 서로 같다", () => {
    const inCode = /VITE_OWNER_EMAIL \|\| "([^"]+)"/.exec(authSrc)[1];
    const inRules = /request\.auth\.token\.email == '([^']+)'/.exec(rulesSrc)[1];
    expect(inCode.toLowerCase()).toBe(inRules.toLowerCase());
  });

  it("규칙은 이메일 인증까지 요구한다 (클라이언트 판정보다 엄격한 쪽이 서버)", () => {
    expect(rulesSrc).toContain("request.auth.token.email_verified == true");
  });

  /* 규칙 제안본(firestore.rules.proposed)이 있으면 그쪽도 같은 값이어야 한다 — 감사 R-36.
     제안본은 배포 대기 상태로 저장소에 남아 있는 파일이라, 운영자 이메일을 바꿀 때
     현행본만 고치면 **나중에 제안본을 배포하는 순간 옛 이메일로 되돌아간다.**
     지연된 함정이라 그때는 원인이 이 파일로 이어지지 않는다. */
  it("제안본이 있다면 그것도 같은 운영자 이메일을 쓴다", () => {
    let proposed;
    try { proposed = read("../../firestore.rules.proposed"); }
    catch { return; }   // 제안본이 없으면(배포 완료 후 삭제) 검사할 것도 없다
    const m = /request\.auth\.token\.email == '([^']+)'/.exec(proposed);
    expect(m, "제안본에서 운영자 이메일을 찾지 못함").toBeTruthy();
    const inRules = /request\.auth\.token\.email == '([^']+)'/.exec(rulesSrc)[1];
    expect(m[1].toLowerCase()).toBe(inRules.toLowerCase());
  });
});
