import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";

// Development-only guardrails scoped to frontend/src/. Behavior-neutral
// starting rules: unused variables/imports/arguments and React Hook rules.
// Do not enable broad style or complexity rules without a separate review.
export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Browser/runtime globals are not enumerated yet; enabling no-undef
      // here would require a globals table and is a later, separate step.
      "no-undef": "off",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
