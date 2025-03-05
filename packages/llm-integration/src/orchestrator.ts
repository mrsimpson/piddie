import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmStreamChunk,
  LlmProviderConfig
} from "./types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EventEmitter } from "@piddie/shared-types";
import type { ChatManager } from "@piddie/chat-management";
import { v4 as uuidv4 } from "uuid";
import { MessageStatus } from "@piddie/chat-management";
import type { LlmAdapter } from "./index";
import { McpHost } from "./mcp/McpHost";

// Define Tool interface locally to avoid import issues
interface Tool {
  name: string;
  description?: string | undefined;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown> | undefined;
  };
}

/**
 * Interface for tool call in LLM responses
 */
interface ToolCall {
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

/**
 * Extended LLM response with tool results
 */
interface LlmResponseWithToolResults extends LlmResponse {
  toolResults?: unknown[];
}

/**
 * Orchestrator for LLM interactions
 * Manages LLM providers and MCP servers
 */
export class Orchestrator implements LlmAdapter {
  private llmProviders: Map<string, LlmProviderConfig> = new Map();
  private mcpHost: McpHost;
  private client: LlmClient;
  private chatManager: ChatManager | undefined;
  private toolsBuffer: Tool[] | null = null;

  /**
   * Creates a new Orchestrator instance
   * @param client The LLM client to use
   * @param chatManager Optional chat manager for persistence
   */
  constructor(client: LlmClient, chatManager: ChatManager) {
    this.client = client;
    this.chatManager = chatManager;
    this.mcpHost = new McpHost();
  }

  /**
   * Registers an LLM provider with the orchestrator
   * @param name The name of the provider
   * @param config The provider configuration
   */
  registerLlmProvider(name: string, config: LlmProviderConfig): void {
    this.llmProviders.set(name, config);
  }

  /**
   * Gets an LLM provider by name
   * @param name The name of the provider
   * @returns The provider configuration or undefined if not found
   */
  getLlmProvider(name: string): LlmProviderConfig | undefined {
    return this.llmProviders.get(name);
  }

  /**
   * Unregisters an LLM provider from the orchestrator
   * @param name The name of the provider
   * @returns True if the provider was unregistered, false if it wasn't registered
   */
  unregisterLlmProvider(name: string): boolean {
    return this.llmProviders.delete(name);
  }

  /**
   * Registers a local MCP server with the orchestrator
   * @param server The MCP server to register
   * @param name The name of the server
   */
  async registerLocalMcpServer(server: McpServer, name: string): Promise<void> {
    await this.mcpHost.registerLocalServer(server, name);
    // Invalidate the tools buffer when registering a new server
    this.toolsBuffer = null;
  }

  /**
   * Register an MCP server (backward compatibility)
   * @param server The MCP server to register
   * @param name The name to register the server under
   */
  async registerMcpServer(server: McpServer, name: string): Promise<void> {
    await this.registerLocalMcpServer(server, name);
  }

  /**
   * Get an MCP server by name
   * @param name The name of the server
   * @returns The server or undefined if not found
   */
  getMcpServer(name: string): McpServer | undefined {
    const connection = this.mcpHost.getConnection(name);
    return connection?.server;
  }

  /**
   * Unregister an MCP server
   * @param name The name of the server
   * @returns True if the server was unregistered, false if it wasn't registered
   */
  unregisterMcpServer(name: string): boolean {
    const connection = this.mcpHost.getConnection(name);
    const result = connection !== undefined;
    if (result) {
      // Invalidate the tools buffer
      this.toolsBuffer = null;
    }
    return result;
  }

  /**
   * Checks if the current LLM provider supports function calling/tools
   * @param providerName The name of the provider to check
   * @returns A promise that resolves to true if tools are supported, false otherwise
   */
  async checkToolSupport(providerName: string): Promise<boolean> {
    const provider = this.getLlmProvider(providerName);
    if (!provider || !provider.client) {
      return false;
    }

    return provider.client.checkToolSupport();
  }

  /**
   * Get all available tools from registered MCP servers
   * @returns A promise that resolves to an array of tools
   */
  private async getAvailableTools(): Promise<Tool[]> {
    if (this.toolsBuffer === null) {
      this.toolsBuffer = await this.mcpHost.listTools() as unknown as Tool[];
    }
    return this.toolsBuffer || [];
  }

  /**
   * Retrieves chat history for a message
   * @param chatId The ID of the chat to retrieve history for
   * @param assistantMessageId Optional ID of the assistant message to exclude from history
   * @returns Array of messages in the format expected by the LLM
   */
  private async getChatHistory(
    chatId: string,
    assistantMessageId?: string
  ): Promise<Array<{ role: string; content: string }>> {
    if (!this.chatManager) {
      return [];
    }

    try {
      const chat = await this.chatManager.getChat(chatId);
      const history = chat.messages;

      // Filter out the placeholder assistant message if it exists
      const filteredHistory = assistantMessageId
        ? history.filter(
          (msg) => msg.id !== assistantMessageId || msg.content.trim() !== ""
        )
        : history;

      // Map to the format expected by the LLM
      const chatHistory = filteredHistory.map((msg) => ({
        role: msg.role,
        content: msg.content
      }));

      console.log(`Retrieved ${chatHistory.length} messages from chat history`);
      return chatHistory;
    } catch (error) {
      console.error("Error retrieving chat history:", error);
      // Continue without history rather than failing
      return [];
    }
  }

  /**
   * Updates message status in the chat manager
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param status The new status
   */
  private async updateMessageStatus(
    chatId: string,
    messageId: string,
    status: MessageStatus
  ): Promise<void> {
    if (!this.chatManager) {
      return;
    }

    try {
      await this.chatManager.updateMessageStatus(chatId, messageId, status);
    } catch (error) {
      //TODO: we keep on getting errors like this:
      //   {
      //     "name": "InvalidStateError",
      //     "message": "Failed to execute 'objectStore' on 'IDBTransaction': The transaction has finished.\n InvalidStateError: Failed to execute 'objectStore' on 'IDBTransaction': The transaction has finished.",
      //     "inner": {}
      // }
      // This is for sure not desirable, but it doesn't kill the whole processing. So let's look at this later

      console.warn(`Error updating message status for ${messageId}:`, error);
      // Continue processing even if status update fails
    }
  }

  /**
   * Enhances a message with chat history and tools
   * @param message The message to enhance
   * @returns The enhanced message
   */
  private async enhanceMessageWithHistoryAndTools(
    message: LlmMessage
  ): Promise<LlmMessage> {
    const enhancedMessage: LlmMessage = { ...message };

    // Get available tools
    const tools = await this.getAvailableTools();

    // Get chat history
    const chatHistory = await this.getChatHistory(
      message.chatId,
      message.assistantMessageId
    );

    // Add chat history to the message
    if (chatHistory.length > 0) {
      enhancedMessage.messages = chatHistory;
    }

    // Add tools to the message if any were retrieved
    if (tools.length > 0) {
      enhancedMessage.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: {
            type: "object",
            properties: tool.inputSchema.properties || {},
            ...(tool.inputSchema.type !== "object" ? { type: tool.inputSchema.type } : {})
          }
        }
      }));
    } else {
      enhancedMessage.tools = [];
    }

    return enhancedMessage;
  }

  /**
   * Process tool calls in an LLM response
   * @param response The LLM response
   * @param tools The available tools
   * @returns A promise that resolves to an array of tool results
   */
  private async processToolCalls(
    response: LlmResponse,
  ): Promise<unknown[]> {
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return [];
    }

    const results: unknown[] = [];

    for (const toolCall of response.tool_calls) {
      try {
        const toolName = toolCall.function.name;
        const toolArgs = typeof toolCall.function.arguments === "string" && toolCall.function.arguments.trim() !== ""
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;

        // Call the tool through the McpHost
        const result = await this.mcpHost.callTool(toolName, toolArgs);
        results.push(result);
      } catch (error) {
        console.error("Error processing tool call:", error);
        results.push({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  /**
   * Processes a message using the LLM client
   * @param message The message to process
   * @returns A promise that resolves to the LLM response
   */
  async processMessage(message: LlmMessage): Promise<LlmResponse> {
    console.log(`Processing message: ${message.id}`);

    // Update message status to processing
    await this.updateMessageStatus(
      message.chatId,
      message.id,
      MessageStatus.SENT
    );

    // Enhance the message with chat history and tools
    const enhancedMessage =
      await this.enhanceMessageWithHistoryAndTools(message);

    // Send the enhanced message to the LLM
    console.log("Sending message to LLM");
    const response = await this.client.sendMessage(enhancedMessage);
    console.log("Received response from LLM");

    // Process tool calls if present
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolResults = await this.processToolCalls(response);

      // Include tool results in the response
      (response as LlmResponseWithToolResults).toolResults = toolResults;
    }

    return response;
  }

  /**
   * Process a message using the LLM client with streaming
   * @param message The message to process
   * @param onChunk Optional callback for each chunk
   * @returns An event emitter for the stream
   */
  async processMessageStream(
    message: LlmMessage,
    onChunk?: (chunk: LlmStreamChunk) => void
  ): Promise<EventEmitter> {
    try {
      console.log("[Orchestrator] Processing message stream");

      // Enhance the message with chat history and tools
      const enhancedMessage =
        await this.enhanceMessageWithHistoryAndTools(message);

      console.log("[Orchestrator] Starting stream from LLM");
      // Process the message with streaming
      const emitter = await this.client.streamMessage(enhancedMessage);

      // Create a new emitter to handle tool calls
      const newEmitter = new EventEmitter();

      // Collect tool calls
      let toolCalls: ToolCall[] = [];
      let accumulatedContent = "";

      // Handle chunks
      emitter.on("data", (data: unknown) => {
        const chunk = data as LlmStreamChunk;

        // Accumulate content for the final response
        if (chunk.content) {
          accumulatedContent += chunk.content;
        }

        // Pass the chunk to the callback
        if (onChunk) {
          onChunk(chunk);
        }

        // Emit the chunk
        newEmitter.emit("data", chunk);

        // Collect tool calls if present
        if (chunk.tool_calls) {
          toolCalls = [...toolCalls, ...chunk.tool_calls];
        }
      });

      // Handle the end of the stream
      emitter.on("end", async () => {
        try {

          // Create a response object for the ChatManager
          const response = {
            id: uuidv4(),
            chatId: message.chatId,
            content: accumulatedContent,
            role: "assistant" as const,
            created: new Date(),
            parentId: message.id,
            tool_calls: toolCalls.length > 0 ? toolCalls : []
          } as LlmResponse;

          // Execute tool calls if present
          if (toolCalls.length > 0) {
            console.log(
              `[Orchestrator] Processing ${toolCalls.length} tool calls from stream`
            );

            const toolResults = await this.processToolCalls(response);

            console.log("[Orchestrator] Stream tool calls completed");
            // Emit the tool results
            newEmitter.emit("tool_results", toolResults);

            // Include tool results in the response
            (response as LlmResponseWithToolResults).toolResults = toolResults;
          }

          console.log(
            "[Orchestrator] Stream processing complete, emitting end event"
          );
          // Emit the end event
          newEmitter.emit("end");
        } catch (error: unknown) {
          console.error(
            "[Orchestrator] Error processing tool calls from stream:",
            error
          );

          // Update message status to error
          await this.updateMessageStatus(
            message.chatId,
            message.id,
            MessageStatus.ERROR
          );

          // Emit the error
          newEmitter.emit("error", error);
        }
      });

      // Handle errors
      emitter.on("error", (error: unknown) => {
        console.error("[Orchestrator] Stream error:", error);

        // Update message status to error
        this.updateMessageStatus(
          message.chatId,
          message.id,
          MessageStatus.ERROR
        ).catch((updateError) => {
          console.error(
            "[Orchestrator] Error updating message status:",
            updateError
          );
        });

        newEmitter.emit("error", error);
      });

      return newEmitter;
    } catch (error) {
      console.error("[Orchestrator] Error processing message stream:", error);

      // Update message status to error
      await this.updateMessageStatus(
        message.chatId,
        message.id,
        MessageStatus.ERROR
      );

      throw error;
    }
  }

  /**
   * Enhance a message with system prompt and tools
   * @param message The message to enhance
   * @returns The enhanced message
   */
  enhanceMessage(message: LlmMessage): LlmMessage {
    // Add system prompt if not present
    const enhancedMessage = { ...message };

    if (!enhancedMessage.systemPrompt) {
      enhancedMessage.systemPrompt = this.generateSystemPrompt();
    }

    return enhancedMessage;
  }

  /**
   * Generate a system prompt
   * @returns The system prompt
   */
  generateSystemPrompt(): string {
    return "You are a helpful assistant.";
  }
}
