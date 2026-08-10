// scripts/r29-impact.mjs 회귀 — 2026-08 감사 R-29 분석 도구.
//
// 이 스크립트의 출력 숫자로 사용자가 "고칠까 말까"를 결정한다. 틀리면 결정이 틀린다.
// 그런데 `scripts/`는 품질 게이트 밖이다(.claude/hooks/check.mjs는 `eslint src api`만 돌고
// eslint.config.js에도 src/**·api/** 블록만 있다). import 누락 같은 결함을 정적 검사가
// 잡지 못하므로, 여기서 **실제로 실행해** 크래시와 수치 회귀를 막는다.
//
// 실측으로 확인된 과거 버그(전부 이 테스트가 재발을 막는다):
//   · fallbackWeight를 "마지막 측정 체중"으로 잘못 잡음 → App은 상수 77.5(data.js:9)
//   · 앱이 판정하지 않는 날(오늘·섭취 0)을 세어 뒤집힘 수가 부풀려짐
//   · 체중이 전부 0인 백업에서 "0일 — 아무것도 안 바뀜"을 출력(정답 3일) ← 결론이 뒤집힘
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const goldenPath = join(repo, "src/__tests__/fixtures/golden-sample.json");
const script = join(repo, "scripts/r29-impact.mjs");

let dir;
const write = (name, mutate) => {
  const b = JSON.parse(readFileSync(goldenPath, "utf8"));
  b.data.goals.adaptiveOn = false;
  b.data.goals.tdeeHistory = [{ from: "2026-06-15", adjust: -120 }];
  mutate?.(b);
  const p = join(dir, `${name}.json`);
  writeFileSync(p, JSON.stringify(b));
  return p;
};
const run = (path) => execFileSync("node", [script, path], { encoding: "utf8" });
const num = (out, re) => Number(re.exec(out)?.[1]);
const flipped = (out) => num(out, /뒤집히는 날\s*:\s*(\d+)일/);
const changed = (out) => num(out, /달라지는 날\s*:\s*(\d+)일/);

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "r29-")); });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("r29-impact 스크립트 — 크래시 없이 돌고 앱과 같은 수를 낸다", () => {
  it("정상 백업: 실행되고 목표 변동·판정 역전을 센다", () => {
    const out = run(write("normal"));
    expect(out).toContain("R-29 영향 분석");
    expect(changed(out)).toBe(13);
    expect(flipped(out)).toBe(3);
  });

  // 아래 둘이 과거에 각각 1일·0일을 냈다. 폴백 체중을 잘못 잡으면 다시 갈라진다.
  it("체중 기록이 없어도 같은 수 — 폴백 체중은 App과 같은 상수여야 한다", () => {
    const out = run(write("nobody", (b) => { b.data.bodylog = []; }));
    expect(flipped(out)).toBe(3);
    expect(out).toContain("체중(weight>0) 기록이 하나도 없어");   // 조용히 넘어가지 않는다
  });

  it("체중이 전부 0인 백업에서도 같은 수 (결론이 뒤집히던 자리)", () => {
    const out = run(write("zero", (b) => { b.data.bodylog.forEach((r) => { r.weight = 0; }); }));
    expect(flipped(out)).toBe(3);
  });

  it("프로필이 있든 없든 이 시료에서는 같은 수, 없으면 반드시 경고한다", () => {
    const withProfile = run(write("prof", (b) => { b.data.profile = { name: "D", height: 180, age: 45 }; }));
    const without = run(write("noprof"));
    expect(flipped(withProfile)).toBe(3);
    expect(flipped(without)).toBe(3);
    expect(without).toContain("profile(키·나이)이 없어");
    expect(withProfile).not.toContain("profile(키·나이)이 없어");
    expect(withProfile).toContain("키 180cm · 나이 45세");   // 실제로 쓴 입력을 밝힌다
  });

  it("적응형이 켜져 있으면 영향 0으로 단정한다", () => {
    const out = run(write("on", (b) => { b.data.goals.adaptiveOn = true; }));
    expect(out).toContain("과거 판정은 하나도 달라지지 않습니다");
  });

  it("이력이 비어 있으면 영향 0으로 단정한다", () => {
    const out = run(write("nohist", (b) => { b.data.goals.tdeeHistory = []; }));
    expect(out).toContain("달라지는 것이 없습니다");
  });

  it("인쇄되는 기준값은 유효목표(운동 되먹기 포함)여야 손으로 검산이 된다", () => {
    const out = run(write("eff"));
    expect(out).toMatch(/유효목표 \d+ → \d+\s+\(기본 \d+ → \d+\)/);
  });

  it("백업이 아닌 JSON은 조용히 0을 내지 않고 거부한다", () => {
    const p = join(dir, "bad.json");
    writeFileSync(p, JSON.stringify({ hello: "world" }));
    expect(() => run(p)).toThrow();   // exit code 1
  });
});
