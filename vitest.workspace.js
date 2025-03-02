import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "./vitest.config.ts",
  "./apps/files-management-ui/vite.config.ts",
  "./apps/workbench/vite.config.ts"
]);
