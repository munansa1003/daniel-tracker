# daniel-tracker — Claude Code 프로젝트 지침

## 품질 게이트

이 저장소는 Claude Code 훅 기반 품질 게이트를 사용한다. **1단계(정적 검사)**와
**2단계(테스트)**가 설치되어 있다.

### 목적

`.js`/`.jsx` 파일을 수정할 때마다 정적 검사와 테스트를 자동 실행해, 미정의 변수·누락된
import·훅 규칙 위반 같은 크래시성 오류와 기존 동작의 회귀가 커밋 전에 걸러지도록 한다.
빌드(Vite)는 이런 오류를 잡지 못한다.

### 동작 방식

- **훅**: `PostToolUse` (matcher `Write|Edit`) → `node .claude/hooks/check.mjs` (timeout 90초)
- **검사 명령** (순차 실행, 하나라도 실패하면 게이트 실패):
  1. `npx eslint src --max-warnings=0` — 정적 검사
     (이 프로젝트는 JavaScript다 — tsconfig.json 없음, src 전체가 .js/.jsx.
     ESLint 설정은 `eslint.config.js`의 최소 규칙 3개를 그대로 따른다)
  2. `npx vitest run` — 전체 테스트 스위트 (약 5초)
- **대상 확장자**: `.ts` `.tsx` `.js` `.jsx` — 그 외 파일 편집은 검사 없이 통과
- **exit 규약**:
  - 통과 → `exit 0` (조용히 진행)
  - 실패 → 검사 도구의 출력 전문을 stderr로 내보내고 **`exit 2`**.
    exit 2는 Claude Code가 에러를 모델에게 피드백하는 코드로, 이를 통해 자가수정 루프가 돈다.
- 훅 스크립트는 bash를 쓰지 않는 순수 Node(.mjs)다 (Windows PC 2대 + 클라우드 세션 공용 제약).
  Windows에서는 `$VAR` 셸 확장이 안 되므로 `CLAUDE_PROJECT_DIR`는 스크립트 내부에서
  `process.env`로 읽는다.

### 골든셋 (표준 시료 회귀 테스트)

`src/__tests__/golden.test.js`는 표준 시료(`fixtures/golden-sample.json`, 실제 백업 파일
형식)를 순수 계산 계층 — `bodyMetrics.js`, `utils.js`(calcTargets/aggregateDay),
`adaptiveTDEE.js`(estimateTDEE), 차트 시리즈 함수 — 에 통과시켜 출력 전체를 고정한다.
골든 값이 깨지면 계산 로직이 바뀐 것이다: 의도한 변경이면 근거와 함께 골든 값을 갱신하고,
의도하지 않았다면 회귀이므로 코드를 되돌린다. 체성분 파생 지표는 컴포넌트에 인라인으로
다시 넣지 말고 `src/bodyMetrics.js`의 순수 함수를 사용한다.

### 금지 사항

- **게이트 우회 금지**: 검사 실패 상태를 남겨둔 채 작업을 종료하거나, 에러를 무시하고
  다음 단계로 넘어가지 않는다. 실패하면 지적된 코드를 고쳐서 통과시킨다.
- **훅 스크립트·설정 수정 금지**: `.claude/hooks/check.mjs`와 `.claude/settings.json`의
  훅 등록을 삭제·완화·우회하는 변경은 하지 않는다. 게이트 자체의 변경은 사용자가 직접 지시한
  경우에만 수행한다.
- ESLint 규칙이 느슨해 보여도 임의로 강화·완화하지 않는다 (규칙 변경은 별도 단계에서 진행).
