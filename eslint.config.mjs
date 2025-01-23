import js from "@eslint/js";
import { parser, configs } from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  ...configs.recommended,
  prettier,
  {
    // Config for TypeScript files
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser,
      parserOptions: {
        project: [
          "./tsconfig.json",
          "./docs/.vitepress/tsconfig.json",
          "./packages/*/tsconfig.json"
        ]
      }
    }
  },
  {
    // Config for JavaScript files - no TypeScript parsing
    files: ["**/*.{js,jsx}"],
    ...js.configs.recommended
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      ".pnpm-store/**",
      "pnpm-lock.yaml",
      "/packages/**",
      "docs/.vitepress/cache/**"
    ]
  }
];
