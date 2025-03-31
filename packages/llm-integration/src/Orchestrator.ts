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
import { ActionsManager, Tool } from "@piddie/actions";

/**
 * Orchestrator for LLM interactions
 * Manages LLM providers and delegates tool operations to the ActionsManager
 */
export class Orchestrator implements LlmAdapter {
  private llmProviders: Map<string, LlmProviderConfig> = new Map();
  private actionsManager: ActionsManager;
  private client: LlmClient;
  private chatManager: ChatManager | undefined;
  private toolsBuffer: Tool[] | null = null;

  private MCP_TOOL_USE = "json mcp-tool-use";

  /**
   * Creates a new Orchestrator
   * @param client The LLM client to use
   * @param chatManager Optional chat manager for persistence
   */
  constructor(client: LlmClient, chatManager: ChatManager) {
    this.client = client;
    this.chatManager = chatManager;
    this.actionsManager = ActionsManager.getInstance();
  }

  /**
   * Registers an LLM provider with the orchestrator
   * @param config The provider configuration
   */
  registerLlmProvider(config: LlmProviderConfig): void {
    this.llmProviders.set(config.provider.toLowerCase(), config);
  }

  /**
   * Gets an LLM provider by name
   * @param provider The name of the provider
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
    await this.actionsManager.registerServer(server, name);
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
    return this.actionsManager.getServer(name);
  }

  /**
   * Unregister an MCP server
   * @param name The name of the server
   * @returns True if the server was unregistered, false if it wasn't registered
   */
  unregisterMcpServer(name: string): boolean {
    const result = this.actionsManager.unregisterServer(name);
    // Invalidate the tools buffer when unregistering a server
    this.toolsBuffer = null;
    return result;
  }

  /**
   * Get the McpHost instance (for backward compatibility)
   * @returns The McpHost instance
   * @deprecated Use ActionsManager.getInstance() instead
   */
  getMcpHost(): any {
    return this.actionsManager.getMcpHost();
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
      try {
        this.toolsBuffer = await this.actionsManager.getAvailableTools();
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
    if (messageId.startsWith("temp_")) {
      console.log(
        `[Orchestrator] Skipping database update for temporary message ${messageId}`
      );
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
    if (messageId.startsWith("temp_")) {
      console.log(
        `[Orchestrator] Skipping database update for temporary message ${messageId}`
      );
      return;
    }

    try {
      await this.chatManager.updateMessageToolCalls(
        chatId,
        messageId,
        toolCalls
      );
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
   * Execute a tool call by delegating to the ActionsManager
   * @param toolCall The tool call to execute
   * @returns The result of the tool call
   */
  private async executeToolCall(toolCall: ToolCall): Promise<unknown> {
    try {
      console.log(
        `[Orchestrator] Executing tool call: ${toolCall.function.name}`
      );

      // Extract the tool name and arguments
      const toolName = toolCall.function.name;
      const toolArgs =
        typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;

      // Delegate tool execution to the ActionsManager
      const result = await this.actionsManager.executeToolCall(toolName, toolArgs);
      console.log(
        `[Orchestrator] Tool call executed successfully: ${toolName}`,
        result
      );

      // Return the result directly or format an error message if present
      if (result.error) {
        return {
          error: result.error
        };
      }

      return result.result;
    } catch (error) {
      console.error("[Orchestrator] Error executing tool call:", error);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute multiple tool calls
   * @param toolCalls The tool calls to execute
   * @returns The results of the tool calls
   */
  private async executeToolCalls(
    toolCalls: ToolCall[]
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;

      try {
        results[toolName] = await this.executeToolCall(toolCall);
      } catch (error) {
        console.error(
          `[Orchestrator] Error executing tool call ${toolName}:`,
          error
        );
        results[toolName] = {
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return results;
  }

  /**
   * Process a message and return a response
   * @param message The message to process
   * @returns The response from the LLM
   */
  async processMessage(message: LlmMessage): Promise<LlmResponse> {
    try {
      console.log("[Orchestrator] Processing message");

      // Get the provider config
      const providerConfig = this.llmProviders.get(message.provider);
      if (!providerConfig) {
        throw new Error(`Provider ${message.provider} not found`);
      }

      // Check if the provider supports tools
      const supportsTools = await this.checkToolSupport(message.provider);

      // Enhance the message with chat history and tools
      const enhancedMessage =
        await this.enhanceMessageWithHistoryAndTools(message);

      // Add system prompt with appropriate instructions based on tool support
      if (!enhancedMessage.systemPrompt) {
        enhancedMessage.systemPrompt = this.generateSystemPrompt(supportsTools);
      }

      console.log("[Orchestrator] Sending message to LLM");
      // Process the message
      const response = await this.client.sendMessage(enhancedMessage);

      console.log("[Orchestrator] Received response from LLM");

      // If the provider doesn't support tools natively, parse the response for tool calls
      if (!supportsTools && response.content) {
        const toolCalls = this.parseToolCallsFromText(response.content);
        if (toolCalls.length > 0) {
          response.tool_calls = toolCalls;
          // Remove the tool calls from the content
          response.content = this.removeToolCallsFromText(response.content);
        }
      }

      // Execute tool calls if present
      if (response.tool_calls && response.tool_calls.length > 0) {
        console.log(
          `[Orchestrator] Executing ${response.tool_calls.length} tool calls`
        );
        const toolResults = await this.executeToolCalls(response.tool_calls);

        // Add tool results to the response
        response.tool_results = toolResults;

        // Append tool results to the content for display
        if (Object.keys(toolResults).length > 0) {
          response.content += "\n\n**Tool Results:**\n\n";
          for (const [toolName, result] of Object.entries(toolResults)) {
            response.content += `**${toolName}**: ${JSON.stringify(result, null, 2)}\n\n`;
          }
        }
      }

      // If we have a chat manager and an assistant message ID, update the message
      if (message.assistantMessageId) {
        // Skip database updates for temporary messages
        if (
          !message.assistantMessageId.startsWith("temp_") &&
          this.chatManager
        ) {
          // Convert tool calls to the correct format if present
          const convertedToolCalls: ToolCall[] =
            response.tool_calls?.map((toolCall: ToolCall) => {
              const functionArgs =
                typeof toolCall.function.arguments === "string"
                  ? JSON.parse(toolCall.function.arguments)
                  : toolCall.function.arguments;

              return {
                function: {
                  name: toolCall.function.name,
                  arguments: functionArgs as Record<string, unknown>
                }
              };
            }) || [];

          // Update the message content and status
          await this.chatManager.updateMessage(
            message.chatId,
            message.assistantMessageId,
            {
              content: response.content || "",
              status: MessageStatus.SENT,
              tool_calls: convertedToolCalls
            }
          );
        }
      }

      return response;
    } catch (error) {
      console.error("[Orchestrator] Error processing message:", error);
      throw error;
    }
  }

  /**
   * Parse tool calls from text response
   * @param text The text to parse
   * @returns Array of tool calls
   */
  private parseToolCallsFromText(text: string): ToolCall[] {
    const toolCalls = [];
    const toolRegex = new RegExp(
      `<${this.MCP_TOOL_USE}>([\\s\\S]*?)<${this.MCP_TOOL_USE}>`,
      "g"
    );
    let match;

    while ((match = toolRegex.exec(text)) !== null) {
      try {
        if (match[1]) {
          const toolJson = match[1].trim();
          const tool = JSON.parse(toolJson);

          toolCalls.push({
            type: "function",
            function: {
              name: tool.name,
              arguments:
                typeof tool.arguments === "string"
                  ? tool.arguments
                  : JSON.stringify(tool.arguments)
            }
          });
        }
      } catch (error) {
        console.error("Error parsing tool call:", error);
      }
    }

    return toolCalls;
  }

  /**
   * Remove tool calls from text
   * @param text The text to process
   * @returns Text with tool calls removed
   */
  private removeToolCallsFromText(text: string): string {
    return text.replace(/<tool>[\s\S]*?<\/tool>/g, "").trim();
  }

  /**
   * Process a message and stream the response
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

      // Get the provider config
      const providerConfig = this.llmProviders.get(message.provider);
      if (!providerConfig) {
        throw new Error(`Provider ${message.provider} not found`);
      }

      // Check if the provider supports tools
      const supportsTools = await this.checkToolSupport(message.provider);

      // Enhance the message with chat history and tools
      const enhancedMessage =
        await this.enhanceMessageWithHistoryAndTools(message);

      // Add system prompt with appropriate instructions based on tool support
      if (!enhancedMessage.systemPrompt) {
        enhancedMessage.systemPrompt = this.generateSystemPrompt(supportsTools);
      }

      // Create an event emitter to return
      const emitter = new EventEmitter();

      // Set up variables to track the full content and tool calls
      let fullContent = "";
      let toolCalls: ToolCall[] = [];

      // Track which tool calls have been executed
      const executedToolCalls = new Set<string>();

      if (!supportsTools) {
        // If the provider doesn't support tools natively, we need to extract them from the text
        // Set up a Set to track which tool calls have been executed
        // Track which tool calls have been executed

        // Create a wrapper for the onChunk callback
        const wrappedOnChunk = (data: unknown) => {
          const chunk = data as LlmStreamChunk;
          console.log(
            `[Orchestrator] Received chunk: ${chunk.content ? `content: "${chunk.content.substring(0, 20)}${chunk.content.length > 20 ? "..." : ""}"` : "no content"}, tool_calls: ${chunk.tool_calls ? chunk.tool_calls.length : 0}`
          );

          // Emit the chunk immediately to ensure UI updates without delay
          // This ensures content appears in real-time
          emitter.emit("data", chunk);
          if (onChunk) onChunk(chunk);

          // Accumulate the content
          if (chunk.content) {
            fullContent += chunk.content;

            // Check for complete tool calls in the accumulated content
            // This happens after emitting the chunk to avoid delaying UI updates
            const { content, extractedToolCalls } =
              this.extractToolCallsFromPartialText(fullContent);

            // If we found complete tool calls, update the accumulated content and tool calls
            if (extractedToolCalls.length > 0) {
              console.log(
                `[Orchestrator] Extracted ${extractedToolCalls.length} tool calls from text`
              );
              fullContent = content;
              toolCalls = [...toolCalls, ...extractedToolCalls];

              // Execute each new tool call and emit the results
              extractedToolCalls.forEach(async (toolCall) => {
                // Create a unique ID for this tool call to avoid duplicate execution
                const toolCallId = `${toolCall.function.name}-${JSON.stringify(toolCall.function.arguments)}`;

                // Skip if we've already executed this tool call
                if (executedToolCalls.has(toolCallId)) {
                  return;
                }

                executedToolCalls.add(toolCallId);

                // Emit the tool call first
                const toolCallChunk: LlmStreamChunk = {
                  content: "",
                  isFinal: false,
                  tool_calls: [toolCall]
                };
                emitter.emit("data", toolCallChunk);
                if (onChunk) onChunk(toolCallChunk);

                // Execute the tool call
                try {
                  const result = await this.executeToolCall(toolCall);

                  // Emit the tool result
                  const resultChunk: LlmStreamChunk = {
                    content: `\n\n**Tool Result (${toolCall.function.name}):**\n\n${JSON.stringify(result, null, 2)}\n\n`,
                    isFinal: false
                  };
                  emitter.emit("data", resultChunk);
                  if (onChunk) onChunk(resultChunk);
                } catch (error) {
                  console.error(
                    `[Orchestrator] Error executing tool call ${toolCall.function.name}:`,
                    error
                  );

                  // Emit error as a chunk
                  const errorChunk: LlmStreamChunk = {
                    content: `\n\n**Tool Error (${toolCall.function.name}):**\n\n${error instanceof Error ? error.message : String(error)}\n\n`,
                    isFinal: false
                  };
                  emitter.emit("data", errorChunk);
                  if (onChunk) onChunk(errorChunk);
                }
              });
            }
          }

          // Handle tool calls in the chunk (for providers with native tool support)
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            // Execute each tool call and emit the results
            chunk.tool_calls.forEach(async (toolCall) => {
              // Create a unique ID for this tool call to avoid duplicate execution
              const toolCallId = `${toolCall.function.name}-${JSON.stringify(toolCall.function.arguments)}`;

              // Skip if we've already executed this tool call
              if (executedToolCalls.has(toolCallId)) {
                return;
              }

              executedToolCalls.add(toolCallId);

              // Execute the tool call
              try {
                const result = await this.executeToolCall(toolCall);

                // Emit the tool result
                const resultChunk: LlmStreamChunk = {
                  content: `\n\n**Tool Result (${toolCall.function.name}):**\n\n${JSON.stringify(result, null, 2)}\n\n`,
                  isFinal: false
                };
                emitter.emit("data", resultChunk);
                if (onChunk) onChunk(resultChunk);
              } catch (error) {
                console.error(
                  `[Orchestrator] Error executing tool call ${toolCall.function.name}:`,
                  error
                );

                // Emit error as a chunk
                const errorChunk: LlmStreamChunk = {
                  content: `\n\n**Tool Error (${toolCall.function.name}):**\n\n${error instanceof Error ? error.message : String(error)}\n\n`,
                  isFinal: false
                };
                emitter.emit("data", errorChunk);
                if (onChunk) onChunk(errorChunk);
              }
            });
          }
        };

        // Process the message with streaming
        const originalEmitter =
          await this.client.streamMessage(enhancedMessage);

        // Add the data event listener
        originalEmitter.on("data", wrappedOnChunk);

        // Forward events from the original emitter
        originalEmitter.on("error", (err: unknown) => {
          console.error("[Orchestrator] Stream error:", err);
          emitter.emit("error", err);
        });

        originalEmitter.on("end", (response?: unknown) => {
          console.log("[Orchestrator] Stream ended");
          // Check for any remaining tool calls in the full content
          const { content, extractedToolCalls } =
            this.extractToolCallsFromPartialText(fullContent, true);

          // If we found more tool calls, emit them
          if (extractedToolCalls.length > 0) {
            console.log(
              `[Orchestrator] Extracted ${extractedToolCalls.length} final tool calls`
            );
            toolCalls = [...toolCalls, ...extractedToolCalls];

            // Emit a tool call event for each extracted tool call
            extractedToolCalls.forEach((toolCall) => {
              const toolCallChunk: LlmStreamChunk = {
                content: "",
                isFinal: false,
                tool_calls: [toolCall]
              };
              emitter.emit("data", toolCallChunk);
              if (onChunk) onChunk(toolCallChunk);
            });

            // Emit the final content without tool calls
            if (content !== fullContent) {
              const contentChunk: LlmStreamChunk = {
                content,
                isFinal: true,
                tool_calls: []
              };
              emitter.emit("data", contentChunk);
              if (onChunk) onChunk(contentChunk);
            }
          }

          // Execute any remaining tool calls that haven't been executed yet
          const remainingToolCalls = toolCalls.filter((toolCall) => {
            const toolCallId = `${toolCall.function.name}-${JSON.stringify(toolCall.function.arguments)}`;
            return !executedToolCalls.has(toolCallId);
          });

          if (remainingToolCalls.length > 0) {
            console.log(
              `[Orchestrator] Executing ${remainingToolCalls.length} remaining tool calls`
            );

            // Execute each remaining tool call
            Promise.all(
              remainingToolCalls.map(async (toolCall) => {
                const toolCallId = `${toolCall.function.name}-${JSON.stringify(toolCall.function.arguments)}`;

                // Skip if we've already executed this tool call
                if (executedToolCalls.has(toolCallId)) {
                  return;
                }

                executedToolCalls.add(toolCallId);

                try {
                  const result = await this.executeToolCall(toolCall);

                  // Emit the tool result
                  const resultChunk: LlmStreamChunk = {
                    content: `\n\n**Tool Result (${toolCall.function.name}):**\n\n${JSON.stringify(result, null, 2)}\n\n`,
                    isFinal: false
                  };
                  emitter.emit("data", resultChunk);
                  if (onChunk) onChunk(resultChunk);
                } catch (error) {
                  console.error(
                    `[Orchestrator] Error executing tool call ${toolCall.function.name}:`,
                    error
                  );

                  // Emit error as a chunk
                  const errorChunk: LlmStreamChunk = {
                    content: `\n\n**Tool Error (${toolCall.function.name}):**\n\n${error instanceof Error ? error.message : String(error)}\n\n`,
                    isFinal: false
                  };
                  emitter.emit("data", errorChunk);
                  if (onChunk) onChunk(errorChunk);
                }
              })
            ).then(() => {
              // After all tool calls are executed, emit the final chunk
              const finalChunk: LlmStreamChunk = {
                content: fullContent,
                tool_calls: toolCalls,
                isFinal: true
              };
              emitter.emit("data", finalChunk);
              if (onChunk) onChunk(finalChunk);

              // Finally emit the end event
              console.log(
                "[Orchestrator] Emitting end event after executing all tool calls"
              );
              emitter.emit("end", response);
            });
          } else {
            // If no remaining tool calls, emit the final chunk and end event
            const finalChunk: LlmStreamChunk = {
              content: fullContent,
              tool_calls: toolCalls,
              isFinal: true
            };
            emitter.emit("data", finalChunk);
            if (onChunk) onChunk(finalChunk);

            // Finally emit the end event
            console.log(
              "[Orchestrator] Emitting end event (no remaining tool calls)"
            );
            emitter.emit("end", response);
          }
        });
      } else {
        // If the provider supports tools natively, just forward the stream
        const originalEmitter =
          await this.client.streamMessage(enhancedMessage);

        // Add data event handler
        originalEmitter.on("data", (data: unknown) => {
          const chunk = data as LlmStreamChunk;
          emitter.emit("data", chunk);
          if (onChunk) onChunk(chunk);
        });

        originalEmitter.on("error", (err: unknown) => {
          emitter.emit("error", err);
        });

        originalEmitter.on("end", (data?: unknown) => {
          console.log("[Orchestrator] Native tool support stream ended");

          // For native tool support, we need to collect all tool calls from the response
          // and execute any that haven't been executed yet
          const response = data as LlmResponse;
          if (
            response &&
            response.tool_calls &&
            response.tool_calls.length > 0
          ) {
            const remainingToolCalls = response.tool_calls.filter(
              (toolCall: ToolCall) => {
                const toolCallId = `${toolCall.function.name}-${JSON.stringify(toolCall.function.arguments)}`;
                return !executedToolCalls.has(toolCallId);
              }
            );

            if (remainingToolCalls.length > 0) {
              console.log(
                `[Orchestrator] Executing ${remainingToolCalls.length} remaining native tool calls`
              );

              // Execute each remaining tool call
              Promise.all(
                remainingToolCalls.map(async (toolCall: ToolCall) => {
                  const toolCallId = `${toolCall.function.name}-${JSON.stringify(toolCall.function.arguments)}`;

                  // Skip if we've already executed this tool call
                  if (executedToolCalls.has(toolCallId)) {
                    return;
                  }

                  executedToolCalls.add(toolCallId);

                  try {
                    const result = await this.executeToolCall(toolCall);

                    // Emit the tool result
                    const resultChunk: LlmStreamChunk = {
                      content: `\n\n**Tool Result (${toolCall.function.name}):**\n\n${JSON.stringify(result, null, 2)}\n\n`,
                      isFinal: false
                    };
                    emitter.emit("data", resultChunk);
                    if (onChunk) onChunk(resultChunk);
                  } catch (error) {
                    console.error(
                      `[Orchestrator] Error executing native tool call ${toolCall.function.name}:`,
                      error
                    );

                    // Emit error as a chunk
                    const errorChunk: LlmStreamChunk = {
                      content: `\n\n**Tool Error (${toolCall.function.name}):**\n\n${error instanceof Error ? error.message : String(error)}\n\n`,
                      isFinal: false
                    };
                    emitter.emit("data", errorChunk);
                    if (onChunk) onChunk(errorChunk);
                  }
                })
              ).then(() => {
                // After all tool calls are executed, emit the final chunk
                const finalChunk: LlmStreamChunk = {
                  content: "",
                  isFinal: true
                };
                emitter.emit("data", finalChunk);
                if (onChunk) onChunk(finalChunk);

                // Finally emit the end event
                console.log(
                  "[Orchestrator] Emitting end event after executing all native tool calls"
                );
                emitter.emit("end", response);
              });
            } else {
              // If no remaining tool calls, emit the final chunk and end event
              const finalChunk: LlmStreamChunk = {
                content: "",
                isFinal: true
              };
              emitter.emit("data", finalChunk);
              if (onChunk) onChunk(finalChunk);

              // Finally emit the end event
              console.log(
                "[Orchestrator] Emitting end event (no remaining native tool calls)"
              );
              emitter.emit("end", response);
            }
          } else {
            // If no tool calls in the response, emit the final chunk and end event
            const finalChunk: LlmStreamChunk = {
              content: "",
              isFinal: true
            };
            emitter.emit("data", finalChunk);
            if (onChunk) onChunk(finalChunk);

            // Finally emit the end event
            console.log(
              "[Orchestrator] Emitting end event (no native tool calls)"
            );
            emitter.emit("end", response);
          }
        });
      }

      return emitter;
    } catch (error) {
      console.error("[Orchestrator] Error processing message stream:", error);
      throw error;
    }
  }

  /**
   * Extract tool calls from partial text
   * @param text The text to parse
   * @param isFinal Whether this is the final chunk of text
   * @returns Object with the updated content and extracted tool calls
   */
  private extractToolCallsFromPartialText(
    text: string,
    isFinal: boolean = false
  ): { content: string; extractedToolCalls: ToolCall[] } {
    // Skip extraction for non-final chunks if text is too short to contain a complete tool call
    // This optimization prevents unnecessary regex processing on small chunks
    if (!isFinal && text.length < 50 && !text.includes("<tool>")) {
      return { content: text, extractedToolCalls: [] };
    }

    const extractedToolCalls: ToolCall[] = [];
    let updatedContent = text;

    // Regular expression to match complete tool calls
    const toolRegex = /<tool>([\s\S]*?)<\/tool>/g;
    let match;

    // Extract complete tool calls
    while ((match = toolRegex.exec(text)) !== null) {
      try {
        if (match[1]) {
          const toolJson = match[1].trim();
          const tool = JSON.parse(toolJson);

          extractedToolCalls.push({
            function: {
              name: tool.name,
              arguments:
                typeof tool.arguments === "string"
                  ? tool.arguments
                  : JSON.stringify(tool.arguments)
            }
          });
        }
      } catch (error) {
        console.error("Error parsing tool call:", error);
      }
    }

    // Remove complete tool calls from the content
    if (extractedToolCalls.length > 0) {
      updatedContent = text.replace(toolRegex, "");
    }

    // If this is the final chunk, try to extract incomplete tool calls
    if (isFinal) {
      // Check for incomplete tool calls (opening tag without closing tag)
      const incompleteToolRegex = /<tool>([\s\S]*)$/;
      const incompleteMatch = incompleteToolRegex.exec(updatedContent);

      if (incompleteMatch && incompleteMatch[1]) {
        try {
          const toolJson = incompleteMatch[1].trim();
          const tool = JSON.parse(toolJson);

          extractedToolCalls.push({
            function: {
              name: tool.name,
              arguments:
                typeof tool.arguments === "string"
                  ? tool.arguments
                  : JSON.stringify(tool.arguments)
            }
          });

          // Remove the incomplete tool call from the content
          updatedContent = updatedContent.replace(incompleteToolRegex, "");
        } catch {
          // Ignore parsing errors for incomplete tool calls
        }
      }
    }

    return { content: updatedContent.trim(), extractedToolCalls };
  }

  /**
   * Enhance a message with system prompt
   * @param message The message to enhance
   * @returns The enhanced message
   */
  enhanceMessage(message: LlmMessage): LlmMessage {
    // Add system prompt if not present
    const enhancedMessage = { ...message };

    if (!enhancedMessage.systemPrompt) {
      // Check if the provider supports tools
      const provider = this.getLlmProvider(message.provider);
      let supportsTools = true;

      if (provider?.client?.checkToolSupport) {
        try {
          // We can't await here, so we'll use a default value
          supportsTools = true;
        } catch (error) {
          console.error("Error checking tool support:", error);
        }
      }

      enhancedMessage.systemPrompt = this.generateSystemPrompt(supportsTools);
    }

    return enhancedMessage;
  }

  /**
   * Generate a system prompt
   * @param supportsTools Whether the LLM provider supports tools natively
   * @returns The system prompt
   */
  generateSystemPrompt(supportsTools: boolean = true): string {
    let systemPrompt = `You are a helpful coding assistant.
    I want you to help me analyze and structure existing code as well as new artifacts.
    I will provide you with tools you can use. If you utilize a tool, explain that you are doing it and why you do it.
    `;

    // If the LLM doesn't support tools natively, add instructions for using tools
    if (!supportsTools) {
      systemPrompt += `\n\nYou have access to the following tools:
      
When you need to use a tool, format your response like this:

\`\`\`${this.MCP_TOOL_USE}
{
  "name": "tool_name",
  "arguments": {
    "arg1": "value1",
    "arg2": "value2"
  }
}
\`\`\`

For example:

\`\`\`${this.MCP_TOOL_USE}
{
  "name": "search",
  "arguments": {
    "query": "What is the capital of France?"
  }
}
\`\`\`

You can use multiple tools in a single response if needed.
Always format your tool calls exactly as shown above.
After using a tool, continue your response based on the tool's output.`;
    }

    return systemPrompt;
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
        created:
          userMessage.created instanceof Date
            ? userMessage.created
            : new Date(userMessage.created),
        parentId: userMessage.parentId || "",
        provider: providerConfig.provider,
        assistantMessageId: assistantPlaceholder.id
      } as LlmMessage;

      // Enhance the message with history and tools
      const enhancedMessage =
        await this.enhanceMessageWithHistoryAndTools(llmMessage);

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
              const convertedToolCalls = chunk.tool_calls.map(
                (tc: ToolCall) => {
                  const args =
                    typeof tc.function.arguments === "string"
                      ? JSON.parse(tc.function.arguments)
                      : tc.function.arguments;

                  return {
                    function: {
                      name: tc.function.name,
                      arguments: args as Record<string, unknown>
                    }
                  };
                }
              );

              // Add to accumulated tool calls
              accumulatedToolCalls = [
                ...accumulatedToolCalls,
                ...convertedToolCalls
              ];

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
          accumulatedToolCalls = response.tool_calls.map((tc: ToolCall) => {
            const args =
              typeof tc.function.arguments === "string"
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
    if (messageId.startsWith("temp_")) {
      console.log(
        `[Orchestrator] Skipping database update for temporary message ${messageId}`
      );
      return;
    }

    try {
      await this.chatManager.updateMessageContent(chatId, messageId, content);
    } catch (error) {
      console.error(`Error updating message content for ${messageId}:`, error);
    }
  }
}
