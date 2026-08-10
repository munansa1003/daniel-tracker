// 최소 ESLint — 목적은 스타일이 아니라 §6 지뢰 1번("빌드는 import 누락을 못 잡음") 방어.
// 규칙 4개만 켠다: no-undef(변수/import 누락), react/jsx-no-undef(<컴포넌트> 누락),
// react-hooks/rules-of-hooks(훅 호출 규칙 위반 → 런타임 크래시),
// no-dupe-keys(같은 객체에 같은 키 두 번 — 뒤엣것이 앞엣것을 조용히 덮는다).
// 스타일 규칙은 넣지 않는다.
//
// no-dupe-keys는 2026-08 구조 감사 R-32에서 사용자 지시로 추가했다. 추가하자마자 실물 2건이
// 걸렸다: App.jsx의 bodyCloudEnabled(값이 같아 무해)와 StatsTab.jsx의 padding(뒤엣것이
// 앞엣것을 덮고 있었고 결과값이 같아 눈에 안 띔). 둘 다 값이 우연히 같아서 무해했을 뿐,
// 값이 달랐다면 "에러 없이 숫자만 틀린다"(지뢰 2번과 같은 종류)로 나타났을 자리다.
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
      "no-dupe-keys": "error",
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
      "no-dupe-keys": "error",
    },
  },
];
