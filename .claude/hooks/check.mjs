// .claude/hooks/check.mjs — 품질 게이트 1단계: 정적 검사 (PostToolUse 훅)
// 실행 환경 제약: Windows PC 2대 + 클라우드 세션 공용이므로 bash 없이 순수 Node로만 동작한다.
// 검사 명령·exit 2 규약은 CLAUDE.md "품질 게이트" 섹션 참조.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { extname } from "node:path";

const CHECK_CMD = "npx eslint src --max-warnings=0";
const GATED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

let input;
try {
  let raw = readFileSync(0, "utf-8");
  // Windows에서 stdin이 UTF-8 BOM(U+FEFF)을 달고 올 수 있고, JSON.parse는 BOM에서 실패한다
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  input = JSON.parse(raw);
} catch {
  // 훅 입력이 없거나 손상된 경우 편집 자체를 막지는 않는다
  process.exit(0);
}

const filePath = input?.tool_input?.file_path || "";
if (!GATED_EXTS.has(extname(filePath).toLowerCase())) process.exit(0);

// Windows에서는 훅 command의 $VAR 셸 확장이 안 되므로 반드시 스크립트 내부에서 env로 접근
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

try {
  execSync(CHECK_CMD, { cwd: projectDir, stdio: "pipe", encoding: "utf-8" });
  process.exit(0);
} catch (err) {
  // 검사 출력 전문을 stderr로 — exit 2여야 Claude에게 피드백되어 자가수정 루프가 돈다
  const output = [err.stdout, err.stderr].filter(Boolean).join("\n");
  process.stderr.write(output || String(err));
  process.exit(2);
}
