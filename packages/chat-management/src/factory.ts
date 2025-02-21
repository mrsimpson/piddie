import type { ChatManager } from "./types";
import { DexieChatManager } from "./internal/dexie-implementation";

/**
 * Creates a new instance of the chat manager
 * @returns A ChatManager instance
 */
export function createChatManager(): ChatManager {
  return new DexieChatManager();
}
