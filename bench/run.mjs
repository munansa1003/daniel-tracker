// bench/run.mjs — Claude Code 반복성(repeatability) 벤치 하네스
// ---------------------------------------------------------------------------
// 목적: 동일한 자기완결 과제(bench/tasks/task-01.md)를 매 회차 "게이트 없는 맨 복사본"에서
//       claude -p 로 풀게 하고, 그 결과를 골든 테스트(npx vitest run) 종료코드로만 판정해
//       Claude Code 자체가 같은 과제를 얼마나 일관되게 통과하는지 측정한다.
//
// 설계 원칙:
//  - 순수 Node(.mjs). 앱 코드·기존 훅·테스트·CI는 일절 수정하지 않는다(bench/ 폴더 자기완결).
//  - 임시 복사본에서 node_modules/.git/bench/.claude 를 모두 제외한다. 특히 .claude 제외로
//    복사본에는 품질 게이트 훅이 없다 → "claude의 통과 능력"만 재고 "게이트 강제력"이 섞이지 않는다.
//  - 판정 근거는 오직 복사본에서 돌린 vitest 종료코드. claude 자체 종료코드는 판정에 쓰지 않는다.
//  - 무인 실행 전제: 회당 타임아웃, 회차 간 대기, 3연속 실패 자동 중단, 매 회차 즉시 기록.
//  - Windows 호환: .cmd 심(claude/npm/npx)은 shell:true 로 해결하고, 과제문은 argv가 아니라
//    stdin 으로 주입해 명령행 따옴표 문제를 원천 차단한다.
// ---------------------------------------------------------------------------

import {
  cpSync, appendFileSync, rmSync, mkdtempSync,
  readFileSync, writeFileSync, existsSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ── 경로/식별자 ────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url)); // .../bench
const PROJECT_ROOT = resolve(HERE, "..");             // 저장소 루트
const RESULTS_PATH = join(HERE, "results.jsonl");
const TASK_ID = "task-01";
const TASK_PATH = join(HERE, "tasks", `${TASK_ID}.md`);
const TARGET_REL = join("src", "bodyMetrics.js"); // 본문을 제거할 대상 파일
const TARGET_FN = "bodyMetrics";                  // 본문을 제거할 대상 함수

// ── 안전장치 상수 ──────────────────────────────────────────────────────────
const DEFAULT_RUNS = 3;
const MAX_RUNS = 20;
const WAIT_BETWEEN_MS = 5_000;              // 회차 간 대기 (API 급발진 방지)
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1_000;  // claude 회당 10분
const VITEST_TIMEOUT_MS = 3 * 60 * 1_000;   // vitest 회당 3분
const NPM_CI_TIMEOUT_MS = 5 * 60 * 1_000;   // npm ci 회당 5분
const CONSECUTIVE_FAIL_LIMIT = 3;           // 3연속 실패 → 환경 문제로 자동 중단
const MAX_BUFFER = 64 * 1024 * 1024;        // 자식 출력 버퍼(claude 응답이 길 수 있음)
const DEFAULT_MODEL = "opus";               // 실행/기록 기본 모델 (BENCH_MODEL 로 오버라이드)

// 복사에서 제외할 최상위 항목 (사용자 결정: .claude 도 제외 → 맨 환경)
const EXCLUDE_TOP = new Set(["node_modules", ".git", "bench", ".claude"]);

// ── 작은 유틸 ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();

function tail(str, n) {
  return String(str || "").replace(/\s+$/, "").split(/\r?\n/).slice(-n).join("\n");
}
function firstLine(str) {
  return String(str || "").split(/\r?\n/)[0];
}

// 복사 필터: 최상위 node_modules/.git/bench/.claude 아래는 통째로 제외
function isExcluded(srcAbs) {
  const rel = relative(PROJECT_ROOT, srcAbs);
  if (!rel || rel.startsWith("..")) return false; // 루트 자신은 포함
  const first = rel.split(/[\\/]/)[0];
  return EXCLUDE_TOP.has(first);
}

// 대상 함수의 "본문만" 제거하고 스텁으로 치환한다(시그니처는 유지).
// 파라미터 목록의 중괄호({ height = 175 } = {})에 걸리지 않도록,
// 먼저 괄호 매칭으로 파라미터 끝 ')' 를 지나친 뒤 첫 '{' 를 본문 시작으로 본다.
// 이어 중괄호 매칭으로 본문 끝 '}' 를 찾아 그 사이를 스텁으로 바꾼다.
// 문자열/주석 안의 중괄호는 건너뛴다(대상 함수엔 없지만 방어적으로 처리).
function stubFunctionBody(source, fnName) {
  const sig = new RegExp(`function\\s+${fnName}\\s*\\(`).exec(source);
  if (!sig) throw new Error(`대상 함수를 찾지 못함: ${fnName}`);

  // 파라미터 목록: 첫 '(' 부터 괄호 균형이 0이 되는 ')' 까지
  let i = source.indexOf("(", sig.index);
  let paren = 0;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === "(") paren++;
    else if (c === ")" && --paren === 0) { i++; break; }
  }

  // 본문 시작 '{'
  const open = source.indexOf("{", i);
  if (open === -1) throw new Error(`함수 본문 시작 '{' 없음: ${fnName}`);

  // 본문 끝 '}' — 문자열/주석을 건너뛰며 중괄호 매칭
  let depth = 0, close = -1;
  let inS = null, inLine = false, inBlock = false;
  for (let j = open; j < source.length; j++) {
    const c = source[j], n = source[j + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; j++; } continue; }
    if (inS) { if (c === "\\") j++; else if (c === inS) inS = null; continue; }
    if (c === "/" && n === "/") { inLine = true; j++; continue; }
    if (c === "/" && n === "*") { inBlock = true; j++; continue; }
    if (c === '"' || c === "'" || c === "`") { inS = c; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { close = j; break; }
  }
  if (close === -1) throw new Error(`함수 본문 끝 '}' 없음: ${fnName}`);

  const stub =
    "{\n" +
    "  // [bench task-01] 이 함수의 본문은 의도적으로 제거되었다. task-01.md 지침대로 재구현하라.\n" +
    `  throw new Error("${fnName}: 본문 미구현 (bench task-01)");\n` +
    "}";
  return source.slice(0, open) + stub + source.slice(close + 1);
}

function getCliVersion() {
  try {
    const r = sh("claude --version", { timeout: 30_000 });
    return firstLine(r.stdout).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function appendResult(obj) {
  appendFileSync(RESULTS_PATH, JSON.stringify(obj) + "\n", "utf-8");
}

// spawnSync 타임아웃/오류를 사람이 읽을 메시지로 변환
function spawnErr(res, label, timeoutMs) {
  if (!res.error) return null;
  if (res.error.code === "ETIMEDOUT") return `${label} 타임아웃 (${Math.round(timeoutMs / 1000)}s)`;
  return `${label} 실행 오류: ${res.error.message}`;
}

// 셸 명령 실행 헬퍼. .cmd 심(claude/npm/npx)은 셸이 있어야 실행되므로 shell:true 를 쓴다.
// 명령을 args 배열이 아니라 "단일 문자열"로 넘겨 DEP0190(인자 미이스케이프 경고)을 피한다.
// → 명령행에는 정적 토큰만 넣고, 가변·비신뢰 입력(과제문)은 절대 문자열에 붙이지 않고 stdin으로만 준다.
function sh(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, killSignal: "SIGKILL", encoding: "utf-8", ...opts });
}

// ── 한 회차 실행 ───────────────────────────────────────────────────────────
function runOnce(runIndex, prompt, model) {
  const started = Date.now();
  let workdir = null;
  let pass = false;
  let error = null;
  try {
    // (a) 임시 복사본 생성 — 제외 목록 적용
    workdir = mkdtempSync(join(tmpdir(), "cc-bench-"));
    console.log(`[회차 ${runIndex}] 복사 → ${workdir}`);
    cpSync(PROJECT_ROOT, workdir, { recursive: true, filter: (src) => !isExcluded(src) });

    // (a') 의존성 설치 (lockfile 기준 재현 설치)
    console.log(`[회차 ${runIndex}] npm ci ...`);
    const ci = sh("npm ci", { cwd: workdir, timeout: NPM_CI_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
    const ciErr = spawnErr(ci, "npm ci", NPM_CI_TIMEOUT_MS);
    if (ciErr) throw new Error(ciErr);
    if (ci.status !== 0) throw new Error("npm ci 실패:\n" + tail((ci.stdout || "") + (ci.stderr || ""), 6));

    // (b) 과제 시작 상태: 대상 함수의 본문만 제거(시그니처 유지)
    const targetPath = join(workdir, TARGET_REL);
    const orig = readFileSync(targetPath, "utf-8");
    const stubbed = stubFunctionBody(orig, TARGET_FN);
    if (stubbed === orig) throw new Error("스텁 치환 결과가 원본과 동일 — 매처 오류");
    writeFileSync(targetPath, stubbed, "utf-8");
    // 시작 상태가 구문상 유효한지 확인(node는 실제 exe라 shell 불필요)
    const chk = spawnSync("node", ["--check", targetPath], { encoding: "utf-8", timeout: 30_000 });
    if (chk.status !== 0) throw new Error("스텁 파일 구문 오류:\n" + tail(chk.stderr, 4));
    console.log(`[회차 ${runIndex}] ${TARGET_FN}() 본문 제거 완료`);

    // (c) claude 헤드리스 실행 — 과제문은 stdin 으로 주입, 임시 복사본이라 skip-permissions 안전.
    // 실행 모델을 --model 로 명시(기본 opus, BENCH_MODEL 로 오버라이드). 모델 값은 preflight 에서
    // 문자셋 검증을 마쳤다 — 명령행엔 정적 토큰만, 과제문(비신뢰 입력)은 문자열에 붙이지 않는다.
    const claudeCmd = `claude -p --dangerously-skip-permissions --model ${model}`;
    console.log(`[회차 ${runIndex}] ${claudeCmd} (최대 ${CLAUDE_TIMEOUT_MS / 60000}분) ...`);
    const cl = sh(claudeCmd, {
      cwd: workdir, input: prompt,
      timeout: CLAUDE_TIMEOUT_MS, maxBuffer: MAX_BUFFER,
    });
    const clErr = spawnErr(cl, "claude", CLAUDE_TIMEOUT_MS);
    if (clErr) throw new Error(clErr);
    console.log(`[회차 ${runIndex}] claude 종료코드=${cl.status}`);

    // (d) 판정: 복사본에서 vitest 전체 실행 → 종료코드가 유일한 pass/fail 근거
    console.log(`[회차 ${runIndex}] npx vitest run ...`);
    const vt = sh("npx vitest run", { cwd: workdir, timeout: VITEST_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
    const vtErr = spawnErr(vt, "vitest", VITEST_TIMEOUT_MS);
    if (vtErr) throw new Error(vtErr);

    pass = vt.status === 0;
    if (!pass) {
      error = `vitest 실패 (claude exit=${cl.status}):\n` + tail((vt.stdout || "") + (vt.stderr || ""), 8);
    }
  } catch (e) {
    pass = false;
    error = e && e.message ? e.message : String(e);
  } finally {
    // (f) 정리 — best-effort, 실패해도 루프를 죽이지 않는다
    if (workdir) {
      try {
        rmSync(workdir, { recursive: true, force: true, maxRetries: 3 });
      } catch (e) {
        console.warn(`[회차 ${runIndex}] ⚠ 임시 폴더 삭제 실패: ${workdir} — ${e.message}`);
      }
    }
  }
  const durationSec = Math.round((Date.now() - started) / 1000);
  return { pass, error, durationSec };
}

// ── 사전 점검 (설정/매처 오류를 루프 전에 잡는다) ──────────────────────────
function preflight() {
  // BENCH_MODEL 은 셸 명령 문자열에 들어가므로 안전한 문자셋만 허용(주입 차단)
  const bm = process.env.BENCH_MODEL;
  if (bm && !/^[A-Za-z0-9._:[\]-]+$/.test(bm)) {
    throw new Error(`BENCH_MODEL 값에 허용되지 않은 문자: ${bm}`);
  }
  if (!existsSync(TASK_PATH)) throw new Error(`과제 파일 없음: ${TASK_PATH}`);
  const prompt = readFileSync(TASK_PATH, "utf-8");
  if (!prompt.trim()) throw new Error("과제 파일이 비어 있음");
  const srcTarget = join(PROJECT_ROOT, TARGET_REL);
  if (!existsSync(srcTarget)) throw new Error(`대상 소스 없음: ${srcTarget}`);
  const orig = readFileSync(srcTarget, "utf-8");
  const stubbed = stubFunctionBody(orig, TARGET_FN); // 함수 못 찾으면 여기서 throw
  if (stubbed === orig) throw new Error("스텁 매처가 원본을 바꾸지 못함");
  return prompt;
}

// ── 메인 루프 ──────────────────────────────────────────────────────────────
async function main() {
  const argN = parseInt(process.argv[2], 10);
  const runs = Math.max(1, Math.min(MAX_RUNS, Number.isFinite(argN) ? argN : DEFAULT_RUNS));

  let prompt;
  try {
    prompt = preflight();
  } catch (e) {
    console.error(`[bench] 사전 점검 실패 — 중단: ${e.message}`);
    process.exit(1);
  }

  const cliVersion = getCliVersion();
  const model = process.env.BENCH_MODEL || DEFAULT_MODEL; // 실제 실행/기록 모델(기본 opus)
  const startedAt = nowISO();
  console.log(
    `[bench] 시작 ${startedAt}\n` +
    `        task=${TASK_ID}, 반복=${runs}, cli=${cliVersion}, model=${model}\n` +
    `        복사 제외=[${[...EXCLUDE_TOP].join(", ")}] (게이트 없는 맨 환경)`
  );

  let passed = 0, completed = 0, consecutiveFail = 0, aborted = false;

  for (let i = 1; i <= runs; i++) {
    console.log(`\n[bench] ===== 회차 ${i}/${runs} =====`);
    const { pass, error, durationSec } = runOnce(i, prompt, model);
    completed++;

    // (e) 매 회차 즉시 기록 — 루프 중간에 죽어도 여기까지는 남는다
    appendResult({
      timestamp: nowISO(), cliVersion, model, task: TASK_ID,
      run: i, pass, durationSec, error,
    });

    console.log(
      `[bench] 회차 ${i}: ${pass ? "PASS ✅" : "FAIL ❌"} (${durationSec}s)` +
      (error ? ` — ${firstLine(error)}` : "")
    );

    if (pass) {
      passed++;
      consecutiveFail = 0;
    } else {
      consecutiveFail++;
      // 3연속 실패 + 남은 회차가 있으면 환경 문제로 보고 자동 중단
      if (consecutiveFail >= CONSECUTIVE_FAIL_LIMIT && i < runs) {
        const reason = `${CONSECUTIVE_FAIL_LIMIT}회 연속 실패 — 환경 문제 가능성으로 자동 중단`;
        console.error(`[bench] ⚠ ${reason} (회차 ${i}에서 중단, 남은 ${runs - i}회 생략)`);
        appendResult({ timestamp: nowISO(), task: TASK_ID, event: "aborted", reason, afterRun: i });
        aborted = true;
        break;
      }
    }

    if (i < runs) {
      console.log(`[bench] ${WAIT_BETWEEN_MS / 1000}s 대기...`);
      await sleep(WAIT_BETWEEN_MS);
    }
  }

  const endedAt = nowISO();
  appendResult({
    timestamp: endedAt, event: "summary", task: TASK_ID, cliVersion, model,
    startedAt, endedAt, completed, passed, aborted,
  });
  console.log(
    `\n[bench] 종료 ${endedAt}\n` +
    `        총 ${completed}회 실행, pass ${passed}` +
    (aborted ? " (연속 실패로 중단됨)" : "") +
    `\n        기록: ${RESULTS_PATH}`
  );
}

main().catch((e) => {
  console.error(`[bench] 예기치 못한 오류: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
