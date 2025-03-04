import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LiteLlmClient } from "./LiteLlmClient";
import { MockLlmClient } from "./MockClient";
import { OllamaClient } from "./OllamaClient";
import { Orchestrator } from "./Orchestrator";
import type {
  LlmProviderConfig,
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmStreamChunk
} from "./types";
import { EventEmitter } from "@piddie/shared-types";
import type { ChatManager } from "@piddie/chat-management";

/**
 * Interface for LLM adapter
 */
export interface LlmAdapter {
  /**
   * Register an LLM provider
   * @param name The name of the provider
   * @param config The provider configuration
   */
  registerLlmProvider(name: string, config: LlmProviderConfig): void;

  /**
   * Get an LLM provider by name
   * @param name The name of the provider
   * @returns The provider configuration
   */
  getLlmProvider(name: string): LlmProviderConfig | undefined;

  /**
   * Unregister an LLM provider
   * @param name The name of the provider
   * @returns True if the provider was unregistered, false if it wasn't registered
   */
  unregisterLlmProvider(name: string): boolean;

  /**
   * Register an MCP server
   * @param server The MCP server to register
   * @param name The name of the server which is use to identitfy it lateron
   */
  registerMcpServer(server: McpServer, name: string): void;

  /**
   * Get an MCP server by name
   * @param name The name of the server
   * @returns The MCP server
   */
  getMcpServer(name: string): McpServer | undefined;

  /**
   * Unregister an MCP server
   * @param name The name of the server
   * @returns True if the server was unregistered, false if it wasn't registered
   */
  unregisterMcpServer(name: string): boolean;

  /**
   * Process a message and return a response
   * @param message The message to process
   * @returns The response from the LLM
   */
  processMessage(message: LlmMessage): Promise<LlmResponse>;

  /**
   * Process a message and stream the response
   * @param message The message to process
   * @param onChunk Callback for each chunk of the response
   * @returns The event emitter for the stream
   */
  processMessageStream(
    message: LlmMessage,
    onChunk: (chunk: LlmStreamChunk) => void
  ): Promise<EventEmitter>;
}

/**
 * Creates an LLM client with the specified configuration
 * @param config The LLM provider configuration
 * @returns The LLM client instance
 */
export function createLlmClient(config: LlmProviderConfig): LlmClient {
  // Use appropriate client based on provider type
  if (config.provider === "mock") {
    return new MockLlmClient();
  } else if (config.provider === "ollama") {
    return new OllamaClient(config);
  } else {
    // Default to OpenAI client
    return new LiteLlmClient(config);
  }
}

/**
 * Creates an LLM adapter with the specified configuration
 * @param config The LLM provider configuration
 * @param chatManager Optional chat manager for persistence
 * @returns The LLM adapter instance
 */
export function createLlmAdapter(
  config: LlmProviderConfig,
  chatManager: ChatManager
): LlmAdapter {
  const client = createLlmClient(config);
  if (!chatManager) {
    throw new Error("Chat manager is required");
  }
  return new Orchestrator(client, chatManager);
}

/**
 * Creates a mock LLM adapter for testing and development
 * @param chatManager Optional chat manager for persistence
 * @returns The LLM adapter instance with a mock client
 */
export function createMockLlmAdapter(chatManager: ChatManager): LlmAdapter {
  const client = new MockLlmClient();
  return new Orchestrator(client, chatManager);
}

export * from "./types";
export * from "./MockClient";
export * from "./LiteLlmClient";
export * from "./Orchestrator";
export * from "./mcp";
