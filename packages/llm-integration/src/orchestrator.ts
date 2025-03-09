import { EventEmitter } from "@piddie/shared-types";
import type {
  LlmClient,
  LlmMessage,
  LlmProviderConfig,
  LlmResponse,
  LlmStreamChunk
} from "./types";
import type { ChatManager, ToolCall, Message } from "@piddie/chat-management";
import { MessageStatus } from "@piddie/chat-management";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  private mcpHost: any; // Use any for now to avoid import issues
  private client: LlmClient;
  private chatManager: ChatManager | undefined;
  private toolsBuffer: Tool[] | null = null;

  /**
   * Creates a new Orchestrator
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
  registerLlmProvider(config: LlmProviderConfig): void {
    this.llmProviders.set(config.provider.toLowerCase(), config);
  }

  /**
   * Gets an LLM provider by name
   * @param name The name of the provider
   * @returns The provider configuration or undefined if not found
   */
  getLlmProvider(provider: string): LlmProviderConfig | undefined {
    return this.llmProviders.get(provider.toLowerCase());
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
   * Register a local MCP server
   * @param server The MCP server to register
   * @param name The name to register the server under
   */
  async registerLocalMcpServer(server: McpServer, name: string): Promise<void> {
    if (!this.mcpHost) {
      console.warn("McpHost is not initialized, cannot register server");
      return;
    }

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
    if (!this.mcpHost) {
      console.warn("McpHost is not initialized, cannot get server");
      return undefined;
    }

    const connection = this.mcpHost.getConnection(name);
    return connection?.server;
  }

  /**
   * Unregister an MCP server
   * @param name The name of the server
   * @returns True if the server was unregistered, false if it wasn't registered
   */
  unregisterMcpServer(name: string): boolean {
    if (!this.mcpHost) {
      console.warn("McpHost is not initialized, cannot unregister server");
      return false;
    }

    const result = this.mcpHost.unregisterServer(name);
    // Invalidate the tools buffer when unregistering a server
    this.toolsBuffer = null;
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
    if (!this.mcpHost) {
      console.warn("McpHost is not initialized, no tools available");
      return [];
    }

    if (this.toolsBuffer === null) {
      try {
        this.toolsBuffer = (await this.mcpHost.listTools()) as unknown as Tool[];
      } catch (error) {
        console.error("Error listing tools:", error);
        this.toolsBuffer = [];
      }
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
   * Updates the status of a message
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
      console.warn(
        "[Orchestrator] No chat manager available to update message status"
      );
      return;
    }

    // Skip database updates for temporary messages (they're handled by the chat store)
    if (messageId.startsWith('temp_')) {
      console.log(`[Orchestrator] Skipping database update for temporary message ${messageId}`);
      return;
    }

    try {
      await this.chatManager.updateMessageStatus(chatId, messageId, status);
    } catch (error) {
      console.error(`Error updating message status for ${messageId}:`, error);
    }
  }

  /**
   * Updates the tool calls for a message
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param toolCalls The tool calls to add
   */
  private async updateMessageToolCalls(
    chatId: string,
    messageId: string,
    toolCalls: ToolCall[]
  ): Promise<void> {
    if (!this.chatManager) {
      console.warn(
        "[Orchestrator] No chat manager available to update message tool calls"
      );
      return;
    }

    // Skip database updates for temporary messages (they're handled by the chat store)
    if (messageId.startsWith('temp_')) {
      console.log(`[Orchestrator] Skipping database update for temporary message ${messageId}`);
      return;
    }

    try {
      await this.chatManager.updateMessageToolCalls(chatId, messageId, toolCalls);
    } catch (error) {
      console.error(`Error updating tool calls for ${messageId}:`, error);
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

    try {
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
              ...(tool.inputSchema.type !== "object"
                ? { type: tool.inputSchema.type }
                : {})
            }
          }
        }));
      } else {
        enhancedMessage.tools = [];
      }
    } catch (error) {
      console.error("Error enhancing message with history and tools:", error);
      // Ensure we at least have an empty history if there was an error
      enhancedMessage.messages = enhancedMessage.messages || [];
      enhancedMessage.tools = enhancedMessage.tools || [];
    }

    return enhancedMessage;
  }

  /**
   * Process tool calls in an LLM response
   * @param response The LLM response
   * @param tools The available tools
   * @returns A promise that resolves to an array of tool results
   */
  private async processToolCalls(response: LlmResponse): Promise<unknown[]> {
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return [];
    }

    const results: unknown[] = [];

    for (const toolCall of response.tool_calls) {
      try {
        const toolName = toolCall.function.name;
        const toolArgs =
          typeof toolCall.function.arguments === "string" &&
            toolCall.function.arguments.trim() !== ""
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
   * Process a message using the LLM client
   * @param message The message to process
   * @returns The LLM response
   */
  async processMessage(message: LlmMessage): Promise<LlmResponse> {
    try {
      console.log("[Orchestrator] Processing message");

      // Enhance the message with chat history and tools
      const enhancedMessage = await this.enhanceMessageWithHistoryAndTools(
        message
      );

      // Get the provider config
      const providerConfig = this.llmProviders.get(message.provider);
      if (!providerConfig) {
        throw new Error(`Provider ${message.provider} not found`);
      }

      console.log("[Orchestrator] Sending message to LLM");
      // Process the message
      const response = await this.client.sendMessage(enhancedMessage);

      console.log("[Orchestrator] Received response from LLM");

      // If we have a chat manager and an assistant message ID, update the message
      if (message.assistantMessageId) {
        // Skip database updates for temporary messages
        if (!message.assistantMessageId.startsWith('temp_') && this.chatManager) {
          // Convert tool calls to the correct format if present
          const convertedToolCalls: ToolCall[] | undefined = response.tool_calls?.map((toolCall: any) => {
            const functionArgs = typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;

            return {
              function: {
                name: toolCall.function.name,
                arguments: functionArgs as Record<string, unknown>
              }
            };
          });

          // Update the message content and status
          await this.chatManager.updateMessage(
            message.chatId,
            message.assistantMessageId,
            {
              content: response.content,
              status: MessageStatus.SENT,
              tool_calls: convertedToolCalls || []
            }
          );
        }

        // Update the message status
        await this.updateMessageStatus(
          message.chatId,
          message.assistantMessageId,
          MessageStatus.SENT
        );
      }

      // Process tool calls if present
      if (response.tool_calls && response.tool_calls.length > 0) {
        console.log(
          `[Orchestrator] Processing ${response.tool_calls.length} tool calls`
        );

        const toolResults = await this.processToolCalls(response);
        (response as LlmResponseWithToolResults).toolResults = toolResults;
      }

      return response;
    } catch (error) {
      console.error("[Orchestrator] Error processing message:", error);

      // Update message status to error
      if (message.assistantMessageId) {
        await this.updateMessageStatus(
          message.chatId,
          message.assistantMessageId,
          MessageStatus.ERROR
        );
      }

      throw error;
    }
  }

  /**
   * Process a message stream from the LLM
   * @param message The message to process
   * @param onChunk Optional callback for each chunk
   * @returns An event emitter for the stream
   */
  async processMessageStream(
    message: LlmMessage,
    onChunk?: (chunk: LlmStreamChunk) => void
  ): Promise<EventEmitter> {
    // Enhance the message with history and tools
    const enhancedMessage = await this.enhanceMessageWithHistoryAndTools(
      message
    );

    // Get the provider config
    const providerConfig = this.llmProviders.get(message.provider);
    if (!providerConfig) {
      throw new Error(`Provider ${message.provider} not found`);
    }

    // Create an event emitter for the stream
    const emitter = new EventEmitter();

    try {
      // Process the message with the provider
      const stream = await this.client.streamMessage(enhancedMessage);

      // Track accumulated content and tool calls
      let accumulatedContent = "";
      let accumulatedToolCalls: ToolCall[] = [];

      // Process the stream
      stream.on("data", (data: unknown) => {
        const chunk = data as LlmStreamChunk;

        // Append content if present
        if (chunk.content) {
          accumulatedContent += chunk.content;
        }

        // Accumulate tool calls if present
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          // Convert tool calls to the correct format
          const convertedToolCalls: ToolCall[] = chunk.tool_calls.map((tc: any) => {
            const args = typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;

            return {
              function: {
                name: tc.function.name,
                arguments: args as Record<string, unknown>
              }
            };
          });

          accumulatedToolCalls = [...accumulatedToolCalls, ...convertedToolCalls];
        }

        // Emit the chunk
        emitter.emit("data", chunk);

        // Call the onChunk callback if provided
        if (onChunk) {
          onChunk(chunk);
        }
      });

      // Handle the end of the stream
      stream.on("end", () => {
        console.log("[Orchestrator] Stream ended");

        // Create the response object
        const response: LlmResponse = {
          id: `resp_${Date.now()}`,
          chatId: message.chatId,
          content: accumulatedContent,
          role: "assistant",
          created: new Date(),
          parentId: message.id,
          tool_calls: accumulatedToolCalls
        };

        // Process tool calls if present
        if (response.tool_calls && response.tool_calls.length > 0) {
          try {
            console.log(
              `[Orchestrator] Processing ${response.tool_calls.length} tool calls`
            );

            // Skip updating tool calls for temporary messages
            if (message.assistantMessageId && !message.assistantMessageId.startsWith('temp_') && this.chatManager) {
              // Convert tool calls to the correct format
              const formattedToolCalls: ToolCall[] = response.tool_calls.map((tc: any) => {
                const args = typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : tc.function.arguments;

                return {
                  function: {
                    name: tc.function.name,
                    arguments: args as Record<string, unknown>
                  }
                };
              });

              // Update the tool calls in the chat manager
              this.updateMessageToolCalls(
                message.chatId,
                message.assistantMessageId,
                formattedToolCalls
              );
            }

            // Process the tool calls
            this.processToolCalls(response).then(toolResults => {
              if (toolResults.length > 0) {
                emitter.emit("tool_results", toolResults);

                // Add the tool results to the response
                (response as LlmResponseWithToolResults).toolResults = toolResults;
              }

              // Update the message status
              if (message.assistantMessageId) {
                this.updateMessageStatus(
                  message.chatId,
                  message.assistantMessageId,
                  MessageStatus.SENT
                );
              }

              // Emit the end event with the response
              emitter.emit("end", response);
            }).catch(error => {
              console.error("[Orchestrator] Error processing tool calls:", error);
              emitter.emit("error", error);
            });
          } catch (error) {
            console.error("[Orchestrator] Error processing tool calls from stream:", error);
            emitter.emit("error", error);
          }
        } else {
          // Update the message status
          if (message.assistantMessageId) {
            this.updateMessageStatus(
              message.chatId,
              message.assistantMessageId,
              MessageStatus.SENT
            ).then(() => {
              // Emit the end event with the response
              emitter.emit("end", response);
            }).catch(error => {
              console.error("[Orchestrator] Error updating message status:", error);
              emitter.emit("error", error);
            });
          } else {
            // Emit the end event with the response
            emitter.emit("end", response);
          }
        }
      });

      // Handle errors
      stream.on("error", (error: unknown) => {
        console.error("[Orchestrator] Stream error:", error);

        // Update the message status
        if (message.assistantMessageId) {
          this.updateMessageStatus(
            message.chatId,
            message.assistantMessageId,
            MessageStatus.ERROR
          ).catch(updateError => {
            console.error("[Orchestrator] Error updating message status:", updateError);
          });
        }

        // Emit the error
        emitter.emit("error", error);
      });
    } catch (error) {
      console.error("[Orchestrator] Error setting up stream:", error);
      emitter.emit("error", error);
    }

    return emitter;
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

  /**
   * Get a completion for a user message and update the assistant placeholder
   * @param userMessage The user message
   * @param assistantPlaceholder The assistant placeholder message
   * @param providerConfig The LLM provider configuration
   * @param useStreaming Whether to use streaming
   * @returns The completed assistant message
   */
  async getCompletion(
    userMessage: Message,
    assistantPlaceholder: Message,
    providerConfig: LlmProviderConfig,
    useStreaming: boolean = true
  ): Promise<Message> {
    try {
      // Register the provider if not already registered
      if (!this.getLlmProvider(providerConfig.provider)) {
        this.registerLlmProvider(providerConfig);
      }

      // Create LLM message with all necessary context
      const llmMessage = {
        id: userMessage.id,
        chatId: userMessage.chatId,
        content: userMessage.content,
        role: userMessage.role,
        status: MessageStatus.SENT,
        created: userMessage.created instanceof Date ? userMessage.created : new Date(userMessage.created),
        parentId: userMessage.parentId || "",
        provider: providerConfig.provider,
        assistantMessageId: assistantPlaceholder.id
      } as LlmMessage;

      // Enhance the message with history and tools
      const enhancedMessage = await this.enhanceMessageWithHistoryAndTools(llmMessage);

      // Track accumulated content and tool calls
      let accumulatedContent = "";
      let accumulatedToolCalls: ToolCall[] = [];

      if (useStreaming) {
        // Process with streaming
        const emitter = await this.processMessageStream(enhancedMessage);

        // Create a promise that resolves when streaming is complete
        return new Promise((resolve, reject) => {
          // Handle data chunks
          emitter.on("data", (data: unknown) => {
            const chunk = data as LlmStreamChunk;

            // Accumulate content
            if (chunk.content) {
              accumulatedContent += chunk.content;

              // Update the assistant placeholder content
              if (this.chatManager) {
                this.updateMessageContent(
                  assistantPlaceholder.chatId,
                  assistantPlaceholder.id,
                  accumulatedContent
                );
              }
            }

            // Handle tool calls
            if (chunk.tool_calls && chunk.tool_calls.length > 0) {
              // Convert tool calls to the correct format
              const convertedToolCalls = chunk.tool_calls.map((tc: any) => {
                const args = typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : tc.function.arguments;

                return {
                  function: {
                    name: tc.function.name,
                    arguments: args as Record<string, unknown>
                  }
                };
              });

              // Add to accumulated tool calls
              accumulatedToolCalls = [...accumulatedToolCalls, ...convertedToolCalls];

              // Update the assistant placeholder tool calls
              if (this.chatManager) {
                this.updateMessageToolCalls(
                  assistantPlaceholder.chatId,
                  assistantPlaceholder.id,
                  accumulatedToolCalls
                );
              }
            }
          });

          // Handle completion
          emitter.on("end", async () => {
            try {
              // Persist the assistant placeholder
              if (this.chatManager) {
                await this.chatManager.updateMessage(
                  assistantPlaceholder.chatId,
                  assistantPlaceholder.id,
                  {
                    content: accumulatedContent,
                    status: MessageStatus.SENT,
                    tool_calls: accumulatedToolCalls
                  }
                );
              }

              // Return the completed message
              resolve({
                ...assistantPlaceholder,
                content: accumulatedContent,
                status: MessageStatus.SENT,
                tool_calls: accumulatedToolCalls
              });
            } catch (error) {
              reject(error);
            }
          });

          // Handle errors
          emitter.on("error", (error: unknown) => {
            // Update the assistant placeholder status
            if (this.chatManager) {
              this.updateMessageStatus(
                assistantPlaceholder.chatId,
                assistantPlaceholder.id,
                MessageStatus.ERROR
              );
            }

            reject(error);
          });
        });
      } else {
        // Process without streaming
        const response = await this.processMessage(enhancedMessage);

        // Convert tool calls to the correct format if present
        if (response.tool_calls && response.tool_calls.length > 0) {
          accumulatedToolCalls = response.tool_calls.map((tc: any) => {
            const args = typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;

            return {
              function: {
                name: tc.function.name,
                arguments: args as Record<string, unknown>
              }
            };
          });
        }

        // Update the assistant placeholder
        if (this.chatManager) {
          // Persist the assistant placeholder
          await this.chatManager.updateMessage(
            assistantPlaceholder.chatId,
            assistantPlaceholder.id,
            {
              content: response.content,
              status: MessageStatus.SENT,
              tool_calls: accumulatedToolCalls
            }
          );
        }

        // Return the completed message
        return {
          ...assistantPlaceholder,
          content: response.content,
          status: MessageStatus.SENT,
          tool_calls: accumulatedToolCalls
        };
      }
    } catch (error) {
      console.error("[Orchestrator] Error getting completion:", error);

      // Update the assistant placeholder status
      if (this.chatManager) {
        this.updateMessageStatus(
          assistantPlaceholder.chatId,
          assistantPlaceholder.id,
          MessageStatus.ERROR
        );
      }

      throw error;
    }
  }

  /**
   * Update a message's content
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param content The new content
   */
  private async updateMessageContent(
    chatId: string,
    messageId: string,
    content: string
  ): Promise<void> {
    if (!this.chatManager) {
      console.warn(
        "[Orchestrator] No chat manager available to update message content"
      );
      return;
    }

    // Skip database updates for temporary messages (they're handled by the chat store)
    if (messageId.startsWith('temp_')) {
      console.log(`[Orchestrator] Skipping database update for temporary message ${messageId}`);
      return;
    }

    try {
      await this.chatManager.updateMessageContent(chatId, messageId, content);
    } catch (error) {
      console.error(`Error updating message content for ${messageId}:`, error);
    }
  }
}
