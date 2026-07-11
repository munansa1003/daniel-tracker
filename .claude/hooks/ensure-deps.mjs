// .claude/hooks/ensure-deps.mjs — SessionStart 훅: 세션 시작 시 의존성을 보장한다.
// 클라우드 세션처럼 node_modules가 없는 환경에서 vitest/eslint 게이트가 곧바로 돌 수 있도록
// npm ci를 선제 실행한다. 로컬(이미 설치됨)에서는 아무 일도 하지 않고 즉시 통과한다.
// 실행 환경 제약: Windows PC 2대 + 클라우드 세션 공용 → bash 없이 순수 Node(.mjs)로만 동작한다.
import { existsSync, realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

// Windows에서는 훅 command의 $VAR 셸 확장이 안 되므로 반드시 스크립트 내부에서 env로 접근
let projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  projectDir = realpathSync.native(projectDir);
} catch {
  // 경로 조회 실패 시 원본 그대로 사용
}

// 이미 설치돼 있으면(로컬 PC) 즉시 통과 — 세션 시작을 지연시키지 않는다
if (existsSync(join(projectDir, "node_modules"))) process.exit(0);

try {
  // 의존성이 없는 새 환경(클라우드 등) 대비 — lockfile 기준 재현 설치
  execSync("npm ci", { cwd: projectDir, stdio: "inherit" });
} catch {
  // 설치가 실패해도 세션 시작 자체는 막지 않는다(사용자가 수동 대응 가능).
  // 이후 게이트(PostToolUse/Stop)가 의존성 부재를 자연히 드러낸다.
  process.exit(0);
}
process.exit(0);
