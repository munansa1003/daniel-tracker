import { defineConfig } from "vitest/config";

// 테스트 전용 설정 — vite.config.js(PWA 플러그인 포함)와 분리해
// 테스트 실행 시 서비스워커 생성 등 불필요한 부수효과를 피한다.
export default defineConfig({
  test: {
    environment: "node",
  },
});
