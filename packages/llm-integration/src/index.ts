import { OpenAiClient } from "./openai-client";
import { Orchestrator } from "./orchestrator";
import { LlmProviderConfig } from "./types";
import { ChatManager } from "../../chat-management/src/types";

/**
 * Creates an LLM adapter with the specified configuration
 * @param config The LLM provider configuration
 * @param chatManager Optional chat manager for conversation history
 * @returns The orchestrator instance
 */
export function createLlmAdapter(
  config: LlmProviderConfig,
  chatManager?: ChatManager
) {
  const client = new OpenAiClient(config);
  const orchestrator = new Orchestrator(client, chatManager);

  return orchestrator;
}

export * from "./types";
