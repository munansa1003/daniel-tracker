import { defineConfig } from "vitest/config";

// 에뮬레이터 스모크 전용 설정.
//
// 기본 스위트(vitest.config.js)와 분리한 이유: 이 테스트는 **Hosting 에뮬레이터가 떠 있을 때만**
// 의미가 있다. Java 21과 firebase-tools가 필요하고 기동에 수십 초가 걸려, PostToolUse 훅의
// 90초 제한 안에서 매 편집마다 돌릴 수 있는 물건이 아니다.
//
// 실행:
//   npm run build && npm run test:emu
//   (= npx firebase-tools@15 emulators:exec --project demo-bodyplan --only functions,hosting "…")
// `demo-` 접두사 프로젝트는 클라우드를 부르지 않으므로 로그인·자격증명이 필요 없다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/emu/**/*.test.js"],
    // 에뮬레이터 콜드스타트(함수 첫 호출에 소스 로드)가 기본 5초를 넘길 수 있다.
    testTimeout: 30000,
    hookTimeout: 30000,
    // 한 Hosting 인스턴스를 여럿이 두드리면 어느 요청이 무엇을 깨웠는지 흐려진다.
    fileParallelism: false,
  },
});
