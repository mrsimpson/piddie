import type { ProjectManager } from "./types";
import { DexieProjectManager } from "./internal/DexieProjectManager";

/**
 * Creates a new instance of the project manager
 * @param chatManager Optional chat manager instance for chat integration
 * @returns A ProjectManager instance
 */
export function createProjectManager(): ProjectManager {
  return new DexieProjectManager();
}
