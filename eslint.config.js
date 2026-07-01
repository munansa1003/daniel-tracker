// 최소 ESLint — 목적은 스타일이 아니라 §6 지뢰 1번("빌드는 import 누락을 못 잡음") 방어.
// 규칙 3개만 켠다: no-undef(변수/import 누락), react/jsx-no-undef(<컴포넌트> 누락),
// react-hooks/rules-of-hooks(훅 호출 규칙 위반 → 런타임 크래시). 스타일 규칙은 넣지 않는다.
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "error",
    },
  },
];
