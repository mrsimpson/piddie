import type { ChatManager } from "./types";
import { DexieChatManager } from "./internal/DexieChatManager";

/**
 * Creates a new instance of the chat manager
 * @returns A ChatManager instance
 */
export function createChatManager(): ChatManager {
  return new DexieChatManager();
}
