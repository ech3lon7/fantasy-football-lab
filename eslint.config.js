import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["dist/**", "node_modules/**", ".private/**", "test-results/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["scripts/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
);
