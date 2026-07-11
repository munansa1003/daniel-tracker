# 벤치 결과 요약

수치의 원본은 [results.jsonl](results.jsonl)(한 줄 = 1회차, git 추적)이고, 하네스의 동작·판정
방식은 [README.md](README.md) 참조. 이 문서는 배치 단위의 사람이 읽는 요약이다.

## 2026-07-11 · task-01 · opus · 20회 배치

### 측정 조건

| 항목 | 값 |
|---|---|
| 측정 일시 | 2026-07-11 15:00–15:51 UTC (배치 총 49분 57초, 회차 간 5초 대기) |
| 과제 | `task-01` — `src/bodyMetrics.js`의 `bodyMetrics()` 본문이 스텁으로 제거된 상태에서 재구현 |
| 판정 | 임시 사본에서 `npx vitest run` 종료코드만 사용 (골든셋 포함 전체 스위트 통과 = pass) |
| 모델 | `opus` (`claude --model opus`) |
| CLI | 2.1.201 (Claude Code) |
| 환경 | **게이트 없는 맨 환경** — 사본에 `.claude/` 미포함(품질 게이트 훅 없음), `node_modules`·`.git`·`bench` 제외 복사 후 `npm ci` 재현 설치 |

### 결과

| 총 실행수 | pass 수 | 통과율 | 평균 durationSec | 최소 | 최대 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 20 | 20 | **100%** | 145.1s | 115s (run 15) | 203s (run 6) |

- `durationSec`은 **회차 전체** 소요다(사본 복사 + `npm ci` + claude 세션 + vitest 판정 + 정리
  포함) — claude 단독 시간이 아니다.
- 연속 실패 자동 중단(3연속 fail) 미발동, 회당 타임아웃(claude 10분) 미발동.
- 같은 파일에 앞서 기록된 1회차 배치(2026-07-11 14:34–14:37 UTC, model `(default)`, 1/1 pass,
  173s)는 파이프라인 점검용 스모크런으로, 이 요약의 20회 집계에서 제외했다.
