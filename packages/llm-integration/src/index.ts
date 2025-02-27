import { OpenAiClient } from "./openai-client";
import { MockLlmClient } from "./mock-client";
import { Orchestrator } from "./orchestrator";
import type {
  LlmProviderConfig,
  LlmClient,
  LlmMessage,
  LlmResponse
} from "./types";
import type { ChatManager } from "@piddie/chat-management";
import type { EventEmitter } from "./event-emitter";

/**
 * Interface for the LLM adapter
 * Provides methods for interacting with the LLM
 */
export interface LlmAdapter {
  /**
   * Processes a message by enhancing it with context and tools before sending to the LLM
   * @param message The message to process
   * @returns The LLM response
   */
  processMessage(message: LlmMessage): Promise<LlmResponse>;

  /**
   * Processes a message by enhancing it with context and tools before streaming the response from the LLM
   * @param message The message to process
   * @returns An event emitter that emits 'data', 'end', and 'error' events
   */
  processMessageStream(message: LlmMessage): Promise<EventEmitter>;
}

/**
 * Creates an LLM client with the specified configuration
 * @param config The LLM provider configuration
 * @returns The LLM client instance
 */
export function createLlmClient(config: LlmProviderConfig): LlmClient {
  // Use mock client if specified in the config
  return config.provider === "mock"
    ? new MockLlmClient()
    : new OpenAiClient(config);
}

/**
 * Creates an LLM adapter with the specified configuration
 * @param config The LLM provider configuration
 * @param chatManager The chat manager for conversation history
 * @returns The LLM adapter instance
 */
export function createLlmAdapter(
  config: LlmProviderConfig,
  chatManager: ChatManager
): LlmAdapter {
  const client = createLlmClient(config);
  return new Orchestrator(client, chatManager);
}

/**
 * Creates a mock LLM adapter for testing and development
 * @param chatManager The chat manager for conversation history
 * @returns The LLM adapter instance with a mock client
 */
export function createMockLlmAdapter(chatManager: ChatManager): LlmAdapter {
  const client = new MockLlmClient();
  return new Orchestrator(client, chatManager);
}

export * from "./types";
export * from "./mock-client";
export * from "./orchestrator";
