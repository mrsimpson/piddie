import { IgnoreService } from "@piddie/shared-types";
import ignore from "ignore";

/**
 * Default implementation of IgnoreService using gitignore-style pattern matching
 */
export class DefaultIgnoreService implements IgnoreService {
  private ignoreInstance = ignore();
  private patterns: string[] = [];

  // These patterns are always applied, regardless of user settings
  private static readonly PROTECTED_PATTERNS = [
    ".git",
    ".git/**",
    "**/.git/",
    "**/.git/**"
  ];

  constructor() {
    // Initialize with default patterns
    this.setPatterns([
      // Node.js
      "**/node_modules/**",
      "node_modules",
      "npm-debug.log",
      "yarn-debug.log*",
      "yarn-error.log*",
      ".npm",
      ".yarn",
      ".pnp.*",

      // TypeScript
      "*.tsbuildinfo",
      "**/dist/**",
      "dist",
      "**/build/**",
      "build",
      ".next",
      "out",

      // JavaScript
      "*.js.map",
      "**/coverage/**",
      "coverage",
      "**/.nyc_output/**",
      ".nyc_output",
      "**/.env.local",
      "**/.env.development.local",
      "**/.env.test.local",
      "**/.env.production.local",

      // Java
      "*.class",
      "*.jar",
      "*.war",
      "*.ear",
      "*.log",
      "**/target/**",
      "target",
      "**/.gradle/**",
      ".gradle",
      "**/build/**",
      "build",
      "**/.idea/**",
      ".idea",
      "*.iml",
      "**/.settings/**",
      ".settings",
      ".project",
      ".classpath",

      // IDEs and Editors
      "**/.vscode/**",
      ".vscode",
      "**/.idea/**",
      ".idea",
      "*.swp",
      "*.swo",
      ".DS_Store",
      "Thumbs.db",

      // Package manager locks (usually should be versioned, but not synced)
      "**/package-lock.json",
      "**/yarn.lock",
      "**/pnpm-lock.yaml",

      // Temporary files
      "**/tmp/**",
      "tmp/",
      "**/temp/**",
      "temp/",
      "*.tmp",
      "*.temp"
    ]);
  }

  /**
   * Check if a path should be ignored
   */
  isIgnored(path: string): boolean {
    try {
      // Remove leading slash if present to make path relative
      const relativePath = path.startsWith("/") ? path.slice(1) : path;
      return this.ignoreInstance.ignores(relativePath);
    } catch (error) {
      // Log error but don't block operations
      console.error("Error checking ignore pattern:", error);
      return false;
    }
  }

  /**
   * Set ignore patterns
   */
  setPatterns(patterns: string[]): void {
    this.patterns = patterns;
    // Create new instance with both protected and user patterns
    this.ignoreInstance = ignore()
      .add(DefaultIgnoreService.PROTECTED_PATTERNS)
      .add(patterns);
  }

  /**
   * Get current patterns
   */
  getPatterns(): string[] {
    // Return both protected and user patterns
    return [...DefaultIgnoreService.PROTECTED_PATTERNS, ...this.patterns];
  }
}
