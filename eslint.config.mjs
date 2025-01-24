import js from "@eslint/js";
import { parser, configs } from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Get __dirname equivalent for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

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
          resolve(__dirname, "./tsconfig.json"),
          resolve(__dirname, "./docs/.vitepress/tsconfig.json"),
          resolve(__dirname, "./packages/*/tsconfig.json")
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
