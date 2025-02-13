import { IgnoreService } from "@piddie/shared-types";
import ignore from "ignore";

/**
 * Default implementation of IgnoreService using gitignore-style pattern matching
 */
export class DefaultIgnoreService implements IgnoreService {
  private ignoreInstance = ignore();
  private patterns: string[] = [];

  /**
   * Check if a path should be ignored
   */
  isIgnored(path: string): boolean {
    try {
      return this.ignoreInstance.ignores(path);
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
    this.ignoreInstance = ignore().add(patterns);
  }

  /**
   * Get current patterns
   */
  getPatterns(): string[] {
    return [...this.patterns];
  }
}
