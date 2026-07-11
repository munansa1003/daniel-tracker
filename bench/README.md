# bench — Claude Code 반복성(repeatability) 벤치 하네스

같은 자기완결 과제를 여러 번 Claude Code에게 풀리고, 결과를 골든 테스트 종료코드로만
판정해서 **Claude Code가 동일 과제를 얼마나 일관되게 통과하는지(통과율)** 를 측정한다.

> 이 폴더는 자기완결이다. 앱 코드·기존 훅(`.claude/hooks/`)·테스트·CI는 **일절 수정하지 않는다.**
> 하네스는 저장소를 임시 폴더에 복사한 **버리는 사본** 안에서만 파일을 건드린다.

## 무엇을 측정하나

- **과제**: [`tasks/task-01.md`](tasks/task-01.md) — `src/bodyMetrics.js`의 `bodyMetrics()`
  함수 본문이 제거된 상태에서 재구현하기. 완료 조건은 `npx vitest run` 전체 통과.
- **판정**: 오직 사본에서 돌린 `npx vitest run`의 **종료코드**. claude 자체 종료코드는 판정에 쓰지 않는다.
- **맨 환경**: 사본에서 `.claude/` 를 **제외**하므로 복사본에는 품질 게이트 훅이 없다.
  → "claude의 통과 능력"만 재고, "Stop 게이트의 강제력"이 결과에 섞이지 않는다.

## 실행법

```bash
node bench/run.mjs [반복횟수]
```

- `반복횟수`: 생략 시 **3**, 범위 **1~20**으로 클램프(초과·이하 값은 잘림).
- 예: `node bench/run.mjs 1` (스모크런 — 파이프라인 1회 확인), `node bench/run.mjs 10`.

### 선택 환경변수

- `BENCH_MODEL` — 지정하면 `claude --model <값>` 으로 실행하고 결과에도 그 값을 기록한다.
  미지정 시 claude 기본 모델을 쓰고 `model` 필드는 `(default)` 로 남는다.
  ```bash
  BENCH_MODEL=claude-opus-4-8 node bench/run.mjs 5     # bash
  $env:BENCH_MODEL="claude-opus-4-8"; node bench/run.mjs 5   # PowerShell
  ```

## 회차마다 하는 일

1. 저장소를 OS 임시 폴더로 복사 — **`node_modules` · `.git` · `bench` · `.claude` 제외**.
2. 사본에서 `npm ci` (lockfile 기준 재현 설치).
3. `bodyMetrics()` **본문만** 스텁으로 치환(시그니처 유지 → 호출 시 예외). `node --check` 로 구문 검증.
4. `claude -p --dangerously-skip-permissions` 실행 — 과제문은 **stdin으로 주입**.
   (버리는 사본 내부라 `--dangerously-skip-permissions` 는 안전한 용법)
5. 사본에서 `npx vitest run` → 종료코드로 pass/fail 판정.
6. 결과 한 줄을 **즉시** `results.jsonl` 에 append.
7. 임시 폴더 삭제(정리).

## 무인 실행 안전장치

| 안전장치 | 동작 |
|---|---|
| 반복 상한 | CLI 인자, 기본 3, **1~20 클램프** |
| 회차 간 대기 | **5초** (API 급발진 방지) |
| 연속 실패 자동 중단 | **3연속 fail** 이고 남은 회차가 있으면 "환경 문제 가능성"으로 루프 중단, 사유를 `results.jsonl`에 `event:"aborted"` 로 기록 |
| 회당 타임아웃 | claude **10분** / vitest **3분** / npm ci **5분**. 초과 시 그 회차 fail 처리 후 다음으로 |
| 즉시 기록 | 매 회차 종료 직후 append — 루프가 중간에 죽어도 완료분은 보존 |
| 시작/종료·요약 | 콘솔 + `results.jsonl`에 `event:"summary"`(총 N회 중 pass M) 기록 |
| 사전 점검 | 루프 전에 과제 파일·대상 함수 존재와 스텁 매처를 검증, 설정 오류면 즉시 중단 |

## `results.jsonl` 형식

한 줄에 JSON 하나(JSON Lines). **git으로 추적**한다 — 시간에 걸친 통과율 누적이 벤치의 목적이므로
기록이 보존·동기화돼야 한다. 세 종류의 줄이 있다:

**회차 결과**
```json
{"timestamp":"2026-07-11T…Z","cliVersion":"2.1.201 (Claude Code)","model":"(default)","task":"task-01","run":1,"pass":true,"durationSec":73,"error":null}
```
- `pass` 실패 시 `error` 에 사유(타임아웃·npm ci 실패·vitest 출력 마지막 8줄 등)가 담긴다.

**중단 표시** (3연속 실패 시)
```json
{"timestamp":"…","task":"task-01","event":"aborted","reason":"3회 연속 실패 — 환경 문제 가능성으로 자동 중단","afterRun":3}
```

**요약** (매 실행 끝에 1줄)
```json
{"timestamp":"…","event":"summary","task":"task-01","cliVersion":"…","model":"(default)","startedAt":"…","endedAt":"…","completed":3,"passed":2,"aborted":false}
```

## 주의사항

- **사용량(토큰) 소모**: 회차마다 완전한 Claude Code 세션이 한 번씩 돈다. `node bench/run.mjs 10`
  이면 nested claude 세션 10회 + `npm ci` 10회다. **반복횟수를 늘리기 전에 소모를 감안하라.**
  파이프라인 점검은 `node bench/run.mjs 1` 로 충분하다.
- **사전 요건**: `claude` CLI가 PATH에 있고 로그인되어 있어야 한다. Node 16.7+ (`fs.cpSync`),
  루트에 `package-lock.json` 존재(`npm ci` 요건).
- **Windows 참고**: `.cmd` 심(claude/npm/npx)은 `shell:true` 로 실행한다. 회당 타임아웃 시
  `spawnSync` 가 직속 자식을 종료하지만, 그 하위(claude가 띄운 node 등) 손자 프로세스는
  남을 수 있다(best-effort). 대량 반복 후 잔여 프로세스가 보이면 수동 정리한다.
- **네트워크/디스크**: 회차마다 `npm ci` 가 돌아 네트워크와 디스크를 쓴다. 임시 폴더는
  회차 종료 시 삭제하지만, 삭제 실패는 경고만 남기고 넘어간다(루프는 계속).
- 하네스는 스텁 대상(`src/bodyMetrics.js`의 `bodyMetrics`)을 **원본 저장소에서는 절대 바꾸지 않는다.**
  치환은 매 회차 임시 사본 안에서만 일어난다.
