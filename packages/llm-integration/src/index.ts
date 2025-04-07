import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LiteLlmClient } from "./LiteLlmClient";
import { MockLlmClient } from "./MockClient";
import { OllamaClient } from "./OllamaClient";
import { Orchestrator } from "./Orchestrator";
import type {
  LlmClient,
  LlmMessage,
  LlmProviderConfig,
  _LlmResponse,
  LlmStreamChunk
} from "./types";
import { EventEmitter } from "@piddie/shared-types";
import type { ChatManager } from "@piddie/chat-management";
import { LlmProviderFactory } from "./adapters/LlmProviderFactory";
import { ActionsManager } from "@piddie/actions";

export { LlmProviderFactory };

export interface LlmAdapter {
  /**
   * Register an LLM provider
   * @param name The name of the provider
   * @param config The provider configuration
   */
  registerLlmProvider(config: LlmProviderConfig): void;

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
  registerMcpServer(server: McpServer, name: string): Promise<void>;

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
   * Check if the LLM provider supports tools
   * @param providerName The name of the provider
   * @returns True if the provider supports tools, false otherwise
   */
  checkToolSupport(providerName: string): Promise<boolean>;

  /**
   * Process a message and stream the response
   * @param message The message to process
   * @param onChunk Optional callback for each chunk
   * @returns An event emitter for the stream
   */
  processMessageStream(
    message: LlmMessage,
    onChunk?: (chunk: LlmStreamChunk) => void
  ): Promise<EventEmitter>;

  /**
   * Configure agentic behavior for a chat
   * @param chatId The ID of the chat to configure
   * @param config Configuration options
   */
  configureAgent(
    chatId: string,
    config: {
      enabled: boolean;
      maxRoundtrips?: number;
      autoContinue?: boolean;
      customSystemPrompt?: string;
    }
  ): void;

  /**
   * Reset agentic context for a chat
   * @param chatId The ID of the chat to reset
   */
  resetAgent(chatId: string): void;

  /**
   * Check if agent is enabled for a chat
   * @param chatId The ID of the chat to check
   * @returns True if agent is enabled, false otherwise
   */
  isAgentEnabled(chatId: string): boolean;
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
 * @param chatManager Chat manager for message handling
 * @param actionsManager Actions manager for tool execution
 * @returns The LLM adapter instance
 */
export function createLlmAdapter(
  config: LlmProviderConfig,
  chatManager: ChatManager,
  actionsManager: ActionsManager = ActionsManager.getInstance()
): LlmAdapter {
  const client = createLlmClient(config);
  config.client = client;

  if (!chatManager) {
    throw new Error("Chat manager is required");
  }

  if (!actionsManager) {
    throw new Error("Actions manager is required");
  }

  const adapter = new Orchestrator(client, chatManager, actionsManager);
  adapter.registerLlmProvider(config);

  return adapter;
}

/**
 * Creates a mock LLM adapter for testing and development
 * @param chatManager Optional chat manager for persistence
 * @param actionsManager Optional actions manager for tool execution
 * @returns The LLM adapter instance with a mock client
 */
export function createMockLlmAdapter(
  chatManager: ChatManager,
  actionsManager: ActionsManager = ActionsManager.getInstance()
): LlmAdapter {
  const client = new MockLlmClient();

  if (!chatManager) {
    throw new Error("Chat manager is required");
  }

  if (!actionsManager) {
    throw new Error("Actions manager is required");
  }

  const adapter = new Orchestrator(client, chatManager, actionsManager);

  const mockConfig: LlmProviderConfig = {
    name: "mock",
    description: "Mock LLM provider for testing",
    apiKey: "mock-api-key",
    model: "mock-model",
    provider: "mock",
    client: client
  };

  adapter.registerLlmProvider(mockConfig);

  return adapter;
}

export * from "./types";
export { LiteLlmClient } from "./LiteLlmClient";
export { MockLlmClient } from "./MockClient";
export { OllamaClient } from "./OllamaClient";
export { BaseLlmClient, ToolSupportStatus } from "./BaseLlmClient";
export * from "./Orchestrator";
