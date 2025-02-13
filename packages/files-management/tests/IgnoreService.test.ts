import { describe, it, expect, beforeEach } from "vitest";
import { DefaultIgnoreService } from "../src/DefaultIgnoreService";

describe("IgnoreService", () => {
  let ignoreService: DefaultIgnoreService;

  beforeEach(() => {
    ignoreService = new DefaultIgnoreService();
  });

  describe("Global Patterns", () => {
    it("should ignore files matching global patterns", () => {
      ignoreService.setPatterns(["*.tmp", "node_modules/**"]);

      expect(ignoreService.isIgnored("test.tmp")).toBe(true);
      expect(ignoreService.isIgnored("node_modules/package/index.js")).toBe(
        true
      );
      expect(ignoreService.isIgnored("src/main.ts")).toBe(false);
    });

    it("should handle multiple global patterns", () => {
      ignoreService.setPatterns(["*.tmp", "*.log", ".git/**"]);

      expect(ignoreService.isIgnored("error.log")).toBe(true);
      expect(ignoreService.isIgnored("temp.tmp")).toBe(true);
      expect(ignoreService.isIgnored(".git/HEAD")).toBe(true);
      expect(ignoreService.isIgnored("src/app.ts")).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty patterns", () => {
      expect(ignoreService.isIgnored("test.ts")).toBe(false);
    });

    it("should handle invalid glob patterns gracefully", () => {
      ignoreService.setPatterns(["[invalid-glob"]);
      expect(() => ignoreService.isIgnored("test.ts")).not.toThrow();
    });
  });
});
