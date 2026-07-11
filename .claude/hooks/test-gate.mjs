// .claude/hooks/test-gate.mjs — 품질 게이트: Stop 이벤트에서 테스트 통과를 강제한다.
// 작업(턴)을 끝내려 할 때 vitest가 실패 상태면 종료를 막고(exit 2) 자가수정을 유도한다.
// PostToolUse 정적/테스트 게이트가 편집 시점을 지킨다면, 이 훅은 "종료 시점"의 최종 방어선이다.
// 실행 환경 제약: Windows PC 2대 + 클라우드 세션 공용 → bash 없이 순수 Node(.mjs)로만 동작한다.
import { readFileSync, realpathSync } from "node:fs";
import { execSync } from "node:child_process";

let input = {};
try {
  let raw = readFileSync(0, "utf-8");
  // Windows에서 stdin이 UTF-8 BOM(U+FEFF)을 달고 올 수 있고, JSON.parse는 BOM에서 실패한다
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  input = JSON.parse(raw);
} catch {
  // 훅 입력이 없거나 손상된 경우 종료를 막지 않는다
  process.exit(0);
}

// 무한루프 방지: 이 Stop 훅이 exit 2로 막아 재차 Stop이 트리거된 상황이면
// stop_hook_active=true로 다시 들어온다 — 그때는 즉시 통과시켜 루프를 끊는다.
if (input?.stop_hook_active === true) process.exit(0);

// Windows에서는 훅 command의 $VAR 셸 확장이 안 되므로 반드시 스크립트 내부에서 env로 접근
let projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  // 정식 케이싱으로 정규화: 드라이브 문자가 소문자(c:)면 Vitest가 모듈 URL을
  // 이중 로드해 러너 컨텍스트가 깨진다 (vi.mock 미적용, runner not found)
  projectDir = realpathSync.native(projectDir);
} catch {
  // 경로 조회 실패 시 원본 그대로 사용
}

try {
  execSync("npx vitest run", { cwd: projectDir, stdio: "pipe", encoding: "utf-8" });
} catch (err) {
  // 종료를 막으려면 exit 2여야 Claude에게 피드백된다. 출력이 길 수 있으니 마지막 30줄만.
  const output = [err.stdout, err.stderr].filter(Boolean).join("\n");
  const last30 = output.split(/\r?\n/).slice(-30).join("\n");
  process.stderr.write("테스트 실패 상태로 작업을 종료할 수 없다.\n" + last30);
  process.exit(2);
}
process.exit(0);
