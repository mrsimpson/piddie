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

    it("should handle paths with leading slashes", () => {
      ignoreService.setPatterns(["dist/", "*.log"]);

      expect(ignoreService.isIgnored("/dist/main.js")).toBe(true);
      expect(ignoreService.isIgnored("/error.log")).toBe(true);
      expect(ignoreService.isIgnored("/src/app.ts")).toBe(false);
    });
  });

  describe("Protected Patterns", () => {
    it("should always ignore .git directory regardless of patterns", () => {
      // Set empty patterns to override defaults
      ignoreService.setPatterns([]);

      expect(ignoreService.isIgnored(".git/config")).toBe(true);
      expect(ignoreService.isIgnored("/.git/HEAD")).toBe(true);
      expect(ignoreService.isIgnored(".git/refs/heads/main")).toBe(true);
    });

    it("should combine protected patterns with user patterns", () => {
      ignoreService.setPatterns(["*.log"]);

      expect(ignoreService.isIgnored(".git/config")).toBe(true);
      expect(ignoreService.isIgnored("error.log")).toBe(true);
      expect(ignoreService.isIgnored("src/app.ts")).toBe(false);
    });

    it("should include protected patterns in getPatterns result", () => {
      ignoreService.setPatterns(["*.log"]);
      const patterns = ignoreService.getPatterns();

      expect(patterns).toContain(".git");
      expect(patterns).toContain(".git/**");
      expect(patterns).toContain("*.log");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty patterns", () => {
      ignoreService.setPatterns([]);
      expect(ignoreService.isIgnored("test.ts")).toBe(false);
      // .git should still be ignored
      expect(ignoreService.isIgnored(".git/config")).toBe(true);
    });

    it("should handle invalid glob patterns gracefully", () => {
      ignoreService.setPatterns(["[invalid-glob"]);
      expect(() => ignoreService.isIgnored("test.ts")).not.toThrow();
    });

    it("should handle deep paths with leading slashes", () => {
      ignoreService.setPatterns([
        "**/dist/**/*.js", // Match dist directory anywhere in the path
        "dist/**/*.js" // Match dist directory at root
      ]);

      // Should match dist anywhere in the path
      expect(ignoreService.isIgnored("/deep/path/dist/nested/file.js")).toBe(
        true
      );
      expect(ignoreService.isIgnored("/dist/nested/file.js")).toBe(true);
      // Should not match non-js files or paths without dist
      expect(ignoreService.isIgnored("/deep/path/src/nested/file.js")).toBe(
        false
      );
      expect(ignoreService.isIgnored("/deep/path/dist/nested/file.css")).toBe(
        false
      );
    });

    it("should handle nested directory patterns", () => {
      ignoreService.setPatterns([
        "**/node_modules/**", // Match node_modules anywhere
        "build/**", // Match build only at root
        "**/temp/" // Match temp directory anywhere
      ]);

      expect(
        ignoreService.isIgnored("/project/node_modules/package/file.js")
      ).toBe(true);
      expect(ignoreService.isIgnored("/node_modules/file.js")).toBe(true);
      expect(ignoreService.isIgnored("/build/output.js")).toBe(true);
      expect(ignoreService.isIgnored("/src/build/output.js")).toBe(false);
      expect(ignoreService.isIgnored("/src/temp/file.js")).toBe(true);
      expect(ignoreService.isIgnored("/temp/file.js")).toBe(true);
    });
  });
});
