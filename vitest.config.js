import { defineConfig, configDefaults } from "vitest/config";

// 테스트 전용 설정 — vite.config.js(PWA 플러그인 포함)와 분리해
// 테스트 실행 시 서비스워커 생성 등 불필요한 부수효과를 피한다.
export default defineConfig({
  test: {
    environment: "node",
    // 에뮬레이터 스모크는 기본 스위트에서 뺀다. 그 테스트는 Java와 firebase-tools가 있고
    // Hosting 에뮬레이터가 떠 있을 때만 의미가 있어서, 여기 섞이면 로컬·훅에서 항상 실패한다.
    // 실행 경로는 따로다: `npm run test:emu`(vitest.emu.config.js) · CI의 emulator-smoke job.
    exclude: [...configDefaults.exclude, "src/__tests__/emu/**"],
  },
});
