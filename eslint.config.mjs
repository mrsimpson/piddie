import js from "@eslint/js";
import { parser, configs } from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Get __dirname equivalent for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig[]} */
const config = [
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
      },
      globals: {
        console: true
      }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true
        }
      ]
    }
  },
  {
    // Config for test files - relax typing
    files: ["**/*.test.ts", "**/*.spec.ts", "**/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    // Config for JavaScript files - no TypeScript parsing
    files: ["**/*.{js,jsx}"],
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        console: true
      }
    }
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      ".pnpm-store/**",
      "pnpm-lock.yaml",
      "/packages/**",
      "docs/.vitepress/cache/**",
      "cline",
      "**/*.d.ts" // Ignore declaration files
    ]
  }
];

export default config;
