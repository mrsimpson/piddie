import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmStreamChunk,
  LlmProviderConfig
} from "./types";
import { McpHost } from "./mcp";
import type { Transport } from "./mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EventEmitter } from "@piddie/shared-types";
import { InMemoryTransport } from "./mcp/InMemoryTransport";
import type { ChatManager } from "@piddie/chat-management";
import { v4 as uuidv4 } from "uuid";
import { MessageStatus } from "@piddie/chat-management";
import type { LlmAdapter } from "./index";

// Define Tool interface locally to avoid import issues
interface Tool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
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
  registerLocalMcpServer(server: McpServer, name: string): void {
    const transport = new InMemoryTransport();
    this.mcpHost.registerLocalServer(server, name, transport);
  }

  /**
   * Register an external MCP server with custom transport
   * @param name The name of the server
   * @param transport The transport to use
   */
  registerExternalMcpServer(name: string, transport: Transport): void {
    this.mcpHost.registerExternalServer(name, transport);
  }

  /**
   * Register an MCP server (backward compatibility)
   * @param server The MCP server to register
   * @param name The name to register the server under
   */
  registerMcpServer(server: McpServer, name: string): void {
    this.registerLocalMcpServer(server, name);
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
    // This is a simplified implementation
    // In a real implementation, you would need to close the connection
    return this.mcpHost.getConnection(name) !== undefined;
  }

  /**
   * Retrieves available tools from the MCP host
   * @returns Array of available tools
   */
  private async getAvailableTools(): Promise<Tool[]> {
    try {
      const tools = await this.mcpHost.listTools();
      console.log(`Retrieved ${tools.length} tools`);
      return tools;
    } catch (error) {
      console.error("Error retrieving tools:", error);
      // Continue without tools rather than failing the entire request
      return [];
    }
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
      console.error(`Error updating message status for ${messageId}:`, error);
      // Continue processing even if status update fails
    }
  }

  /**
   * Handles the response from the LLM by either updating an existing assistant message or creating a new one
   * @param message The original user message
   * @param response The response from the LLM
   */
  private async handleLlmResponse(
    message: LlmMessage,
    response: LlmResponse
  ): Promise<void> {
    if (!this.chatManager) {
      return;
    }

    try {
      // Update the user message status to sent
      await this.updateMessageStatus(
        message.chatId,
        message.id,
        MessageStatus.SENT
      );

      if (message.assistantMessageId) {
        // Update the existing assistant message
        await this.chatManager.updateMessageContent(
          message.chatId,
          message.assistantMessageId,
          response.content
        );
      } else {
        // Add a new assistant response to the chat
        await this.chatManager.addMessage(
          message.chatId,
          response.content,
          response.role,
          "assistant",
          message.id
        );
      }
    } catch (error) {
      console.error("Error handling LLM response:", error);
      // Continue even if chat update fails
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
          parameters: tool.inputSchema
        }
      }));
    } else {
      enhancedMessage.tools = [];
    }

    return enhancedMessage;
  }

  /**
   * Process tool calls from an LLM response
   * @param response The LLM response containing tool calls
   * @param tools Available tools
   * @returns The tool results
   */
  private async processToolCalls(
    response: LlmResponse,
    tools: Tool[]
  ): Promise<unknown[]> {
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return [];
    }

    console.log(`Processing ${response.tool_calls.length} tool calls`);

    // Execute each tool call
    const toolResults = await Promise.all(
      response.tool_calls.map(async (call) => {
        const toolInfo = tools.find((t) => t.name === call.function.name);
        if (!toolInfo) {
          console.warn(`Tool ${call.function.name} not found`);
          throw new Error(`Tool ${call.function.name} not found`);
        }

        console.log(`Calling tool: ${call.function.name}`);
        // Call the tool using the callTool method
        return this.mcpHost.callTool(
          call.function.name,
          typeof call.function.arguments === "string"
            ? JSON.parse(call.function.arguments)
            : call.function.arguments
        );
      })
    );

    console.log("Tool calls completed");
    return toolResults;
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

    // Get available tools for processing tool calls
    const tools = await this.getAvailableTools();

    // Process tool calls if present
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolResults = await this.processToolCalls(response, tools);

      // Include tool results in the response
      (response as LlmResponseWithToolResults).toolResults = toolResults;
    }

    // Handle the LLM response (update or create assistant message)
    await this.handleLlmResponse(message, response);

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

      // Update message status to processing
      await this.updateMessageStatus(
        message.chatId,
        message.id,
        MessageStatus.SENT
      );

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
          // Get available tools for processing tool calls
          const tools = await this.getAvailableTools();

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

            const toolResults = await this.processToolCalls(response, tools);

            console.log("[Orchestrator] Stream tool calls completed");
            // Emit the tool results
            newEmitter.emit("tool_results", toolResults);

            // Include tool results in the response
            (response as LlmResponseWithToolResults).toolResults = toolResults;
          }

          // Handle the LLM response (update or create assistant message)
          await this.handleLlmResponse(message, response);

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
