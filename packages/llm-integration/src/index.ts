import { ChatManager } from "@piddie/chat-management";
import { LLMClient } from "./client";
import { LLMClientConfig } from "./types/client";

export { LLMClient } from "./client";
export type { LLMClientConfig } from "./types/client";

export function createLLMClient(
  chatManager: ChatManager,
  config: LLMClientConfig
): LLMClient {
  return new LLMClient(chatManager, config);
}
