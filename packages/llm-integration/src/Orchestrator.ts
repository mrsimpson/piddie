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
import { ActionsManager, type Tool } from "@piddie/actions";

/**
 * A queue for managing tool calls in a FIFO manner with abort functionality
 */
class ToolCallQueue {
  private queue: Array<{
    toolCall: ToolCall;
    resolve: (result: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];
  private isProcessing = false;
  private aborted = false;
  private executeToolFn: (toolCall: ToolCall) => Promise<unknown>;

  /**
   * Creates a new ToolCallQueue
   * @param executeToolFn Function to execute tool calls
   */
  constructor(executeToolFn: (toolCall: ToolCall) => Promise<unknown>) {
    this.executeToolFn = executeToolFn;
  }

  /**
   * Adds a tool call to the queue
   * @param toolCall The tool call to add
   * @returns A promise that resolves with the tool call result
   */
  async enqueue(toolCall: ToolCall): Promise<unknown> {
    // If the queue is aborted, reject immediately
    if (this.aborted) {
      return Promise.reject(new Error("Tool call queue has been aborted"));
    }

    // Return a promise that will be resolved when the tool call is executed
    return new Promise((resolve, reject) => {
      // Add the tool call to the queue
      this.queue.push({ toolCall, resolve, reject });

      // Start processing if not already doing so
      if (!this.isProcessing) {
        this.processNext();
      }
    });
  }

  /**
   * Processes the next tool call in the queue
   */
  private async processNext(): Promise<void> {
    // If the queue is empty or aborted, stop processing
    if (this.queue.length === 0 || this.aborted) {
      this.isProcessing = false;
      return;
    }

    // Mark as processing
    this.isProcessing = true;

    // Get the next tool call from the queue
    const { toolCall, resolve, reject } = this.queue.shift()!;

    try {
      // Execute the tool call
      const result = await this.executeToolFn(toolCall);
      // Resolve the promise with the result
      resolve(result);
    } catch (error) {
      // Reject the promise with the error
      reject(error);
    } finally {
      // Process the next tool call
      this.processNext();
    }
  }

  /**
   * Gets the number of pending tool calls in the queue
   * @returns The number of pending tool calls
   */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Checks if the queue is currently processing a tool call
   * @returns True if the queue is processing, false otherwise
   */
  get isActive(): boolean {
    return this.isProcessing;
  }

  /**
   * Aborts all pending tool calls in the queue
   */
  abort(): void {
    // Set the aborted flag
    this.aborted = true;

    // Reject all pending promises
    for (const { reject } of this.queue) {
      reject(new Error("Tool call aborted"));
    }

    // Clear the queue
    this.queue = [];
  }

  /**
   * Resets the queue to its initial state
   */
  reset(): void {
    this.aborted = false;
    this.isProcessing = false;
    this.queue = [];
  }
}

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
  // Track executed tool calls to avoid duplicates
  private executedToolCalls = new Set<string>();
  private MCP_TOOL_USE = "json mcp-tool-use";
  // Tool call queue for sequential execution
  private toolCallQueue: ToolCallQueue;

  /**
   * Creates a new Orchestrator
   * @param client The LLM client to use
   * @param chatManager Chat manager for message handling
   * @param actionsManager Actions manager for tool execution
   */
  constructor(
    client: LlmClient,
    chatManager: ChatManager,
    actionsManager: ActionsManager
  ) {
    this.client = client;
    this.chatManager = chatManager;
    this.actionsManager = actionsManager;

    // Initialize the tool call queue with the execute tool function
    this.toolCallQueue = new ToolCallQueue(this.executeToolCall.bind(this));
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
    if (!toolCall || !toolCall.function || !toolCall.function.name) {
      throw new Error("Invalid tool call");
    }

    const toolName = toolCall.function.name;
    const toolArgs = toolCall.function.arguments || {};
    let parsedArgs;

    try {
      // If arguments are provided as a string, parse them to an object
      if (typeof toolArgs === "string") {
        parsedArgs = JSON.parse(toolArgs);
      } else {
        parsedArgs = toolArgs;
      }

      // Call the tool via the ActionsManager
      console.log(`[Orchestrator] Executing tool call: ${toolName}`);
      const result = await this.actionsManager.executeToolCall(
        toolName,
        parsedArgs
      );
      console.log(
        `[Orchestrator] Tool call executed successfully: ${toolName}`,
        result
      );
      return result;
    } catch (error) {
      // Return the error to be handled by the caller
      console.error(`[Orchestrator] Error executing tool call:`, error);
      throw error;
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
    if (!toolCalls || toolCalls.length === 0) {
      return {};
    }

    console.log(`[Orchestrator] Executing ${toolCalls.length} tool calls`);
    const results: Record<string, unknown> = {};

    // Execute each tool call in sequence and collect results
    for (const toolCall of toolCalls) {
      try {
        // Create a unique ID for this tool call to avoid duplicates
        const toolCallId = `${toolCall.function.name}-${JSON.stringify(toolCall.function.arguments)}`;

        // Skip if already executed
        if (this.executedToolCalls.has(toolCallId)) {
          console.log(
            `[Orchestrator] Skipping already executed tool: ${toolCall.function.name}`
          );
          continue;
        }

        // Mark as executed
        this.executedToolCalls.add(toolCallId);

        // Execute the tool call
        const result = await this.executeToolCall(toolCall);

        // Store the result
        results[toolCall.function.name] = result;
      } catch (error) {
        // Store the error as the result
        results[toolCall.function.name] = {
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

      // Create a response object to accumulate results
      const response: LlmResponse = {
        chatId: message.chatId,
        role: message.role,
        created: new Date(),
        id: "",
        content: "",
        tool_calls: [],
        tool_results: {}
      };

      // Create collections to accumulate content and tool calls
      let accumulatedContent = "";
      const toolCalls: ToolCall[] = [];
      const toolResults: Record<string, unknown> = {};

      // Create a promise that will resolve when the stream completes
      return new Promise((resolve, reject) => {
        // Use processMessageStream internally
        this.processMessageStream(message, (chunk) => {
          // Accumulate content
          if (chunk.content) {
            accumulatedContent += chunk.content;
          }

          // Track tool calls
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            for (const toolCall of chunk.tool_calls) {
              toolCalls.push(toolCall);
            }
          }
        })
          .then((emitter) => {
            // Track executed tool calls for tool results
            const executeToolCallsHandler = async (toolCall: ToolCall) => {
              try {
                // Execute the tool call
                const result = await this.executeToolCall(toolCall);
                // Store the result
                toolResults[toolCall.function.name] = result;
                return result;
              } catch (error) {
                // Store the error as the result
                toolResults[toolCall.function.name] = {
                  error: error instanceof Error ? error.message : String(error)
                };
                throw error;
              }
            };

            // Listen for tool executions to capture results
            emitter.on("tool_executed", (data: { toolCall: ToolCall; result: unknown }) => {
              toolResults[data.toolCall.function.name] = data.result;
            });

            // Handle stream completion
            emitter.on("end", async (finalData: any) => {
              console.log("[Orchestrator] Processing end event in processMessage",
                finalData ?
                  {
                    id: finalData.id,
                    hasToolCalls: finalData.tool_calls ? finalData.tool_calls.length > 0 : false
                  } :
                  'No final data'
              );

              // Extract tool calls from finalData if present
              if (finalData && finalData.tool_calls && finalData.tool_calls.length > 0) {
                console.log(`[Orchestrator] Found ${finalData.tool_calls.length} tool calls in final data`);
                // Add any tool calls from the final data that aren't already tracked
                for (const toolCall of finalData.tool_calls) {
                  // Simple check to avoid duplicates - check if we already have this tool call
                  const existingToolCall = toolCalls.find(tc =>
                    tc.function && toolCall.function &&
                    tc.function.name === toolCall.function.name &&
                    JSON.stringify(tc.function.arguments) === JSON.stringify(toolCall.function.arguments)
                  );

                  if (!existingToolCall) {
                    console.log(`[Orchestrator] Adding new tool call from final data: ${toolCall.function.name}`);
                    toolCalls.push(toolCall);
                  }
                }
              }

              // Also check for any additional tool calls in the text content
              // This is especially important for non-native tool support
              if (finalData && finalData.content && typeof finalData.content === 'string') {
                const { extractedToolCalls } = this.extractToolCallsFromPartialText(
                  finalData.content,
                  true // isFinal
                );

                if (extractedToolCalls.length > 0) {
                  console.log(`[Orchestrator] Extracted ${extractedToolCalls.length} tool calls from final content`);

                  // Add any newly extracted tool calls that aren't duplicates
                  for (const toolCall of extractedToolCalls) {
                    const existingToolCall = toolCalls.find(tc =>
                      tc.function && toolCall.function &&
                      tc.function.name === toolCall.function.name &&
                      JSON.stringify(tc.function.arguments) === JSON.stringify(toolCall.function.arguments)
                    );

                    if (!existingToolCall) {
                      console.log(`[Orchestrator] Adding extracted tool call from final content: ${toolCall.function.name}`);
                      toolCalls.push(toolCall);
                    }
                  }
                }
              }

              // Check if all tool calls have already been executed via streaming
              // If not, execute them now
              for (const toolCall of toolCalls) {
                if (!toolCall.function || !toolCall.function.name) {
                  console.warn("[Orchestrator] Invalid tool call found:", toolCall);
                  continue;
                }

                const toolName = toolCall.function.name;
                if (!toolResults[toolName]) {
                  try {
                    console.log(`[Orchestrator] Executing remaining tool call: ${toolName}`);
                    // Execute any remaining tool calls
                    const result = await this.executeToolCall(toolCall);
                    toolResults[toolName] = result;
                  } catch (error) {
                    console.error(`[Orchestrator] Error executing tool call ${toolName}:`, error);
                    toolResults[toolName] = {
                      error: error instanceof Error ? error.message : String(error)
                    };
                  }
                }
              }

              // Populate the response object
              response.id = finalData?.id || `response-${Date.now()}`;
              response.content = finalData?.content || accumulatedContent;
              response.tool_calls = toolCalls;
              response.tool_results = toolResults;

              // Format the content to include tool results as expected by tests
              if (Object.keys(toolResults).length > 0) {
                response.content += "\n\n**Tool Results:**\n\n";
                for (const [toolName, result] of Object.entries(toolResults)) {
                  response.content += `**${toolName}**: ${JSON.stringify(result, null, 2)}\n\n`;
                }
              }

              // If we have a chat manager and an assistant message ID, update the message
              if (message.assistantMessageId && this.chatManager) {
                // Skip database updates for temporary messages
                if (!message.assistantMessageId.startsWith("temp_")) {
                  // Convert tool calls to the correct format if present
                  const convertedToolCalls: ToolCall[] = toolCalls.map((toolCall: ToolCall) => {
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
                  });

                  // Update the message content and status
                  this.chatManager.updateMessage(
                    message.chatId,
                    message.assistantMessageId,
                    {
                      content: response.content || "",
                      status: MessageStatus.SENT,
                      tool_calls: convertedToolCalls
                    }
                  ).catch(error => {
                    console.error("[Orchestrator] Error updating message:", error);
                  });
                }
              }

              resolve(response);
            });

            // Handle errors
            emitter.on("error", (error) => {
              console.error("[Orchestrator] Error processing message:", error);
              reject(error);
            });
          })
          .catch(reject);
      });
    } catch (error) {
      console.error("[Orchestrator] Error processing message:", error);
      throw error;
    }
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
    console.log("[Orchestrator] Processing message stream");

    // Reset the executed tool calls set and tool call queue for this stream
    this.executedToolCalls.clear();
    this.toolCallQueue.reset();

    // Create a new emitter
    const emitter = new EventEmitter();

    // Enhance the message with history and tools
    const enhancedMessage =
      await this.enhanceMessageWithHistoryAndTools(message);

    // Track accumulated content for extracting tool calls
    let fullContent = "";

    // Track tool calls for updating the message
    let toolCalls: ToolCall[] = [];

    // Check if the provider supports tools natively
    const supportsTools = await this.client.checkToolSupport();

    // Helper function to emit tool result as a chunk
    const emitToolResult = (toolName: string, result: unknown) => {
      const content = `\n\n**Tool Result (${toolName}):**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)
        }\n\n`;

      const chunk: LlmStreamChunk = {
        content,
        isFinal: false
      };

      emitter.emit("data", chunk);
      if (onChunk) onChunk(chunk);
    };

    // Helper function to emit tool error as a chunk
    const emitToolError = (toolName: string, error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const content = `\n\n**Tool Error (${toolName}):**\n\n${errorMessage}\n\n`;

      const chunk: LlmStreamChunk = {
        content,
        isFinal: false
      };

      emitter.emit("data", chunk);
      if (onChunk) onChunk(chunk);
    };

    // Helper function to execute a tool call and emit the result
    const executeAndEmitToolCall = async (
      toolCall: ToolCall
    ): Promise<boolean> => {
      if (!toolCall || !toolCall.function || !toolCall.function.name) {
        return false;
      }

      const toolName = toolCall.function.name;

      // Create a unique ID for this tool call
      const toolCallId = `${toolName}-${JSON.stringify(toolCall.function.arguments)}`;

      // Skip if already executed
      if (this.executedToolCalls.has(toolCallId)) {
        console.log(
          `[Orchestrator] Skipping already executed tool: ${toolName}`
        );
        return false;
      }

      // Mark as executed
      this.executedToolCalls.add(toolCallId);

      try {
        console.log(
          `[Orchestrator] Starting execution of tool call: ${toolName}`
        );

        // Enqueue tool call for sequential processing
        const result = await this.toolCallQueue.enqueue(toolCall);

        console.log(
          `[Orchestrator] Tool call execution complete: ${toolName} with result:`,
          result
        );

        // Emit a custom event for tracking tool execution results
        emitter.emit("tool_executed", { toolCall, result });

        // Emit the result
        emitToolResult(toolName, result);
        return true;
      } catch (error) {
        console.error(
          `[Orchestrator] Error executing tool call: ${toolName}`,
          error
        );

        // Emit a custom event for tracking tool execution errors
        emitter.emit("tool_executed", {
          toolCall,
          result: { error: error instanceof Error ? error.message : String(error) }
        });

        // Emit the error
        emitToolError(toolName, error);
        return true;
      }
    };

    // Helper function to process tool calls extracted from text
    const processExtractedToolCalls = async (
      extractedToolCalls: ToolCall[]
    ) => {
      if (extractedToolCalls.length === 0) {
        return;
      }

      console.log(
        `[Orchestrator] Processing ${extractedToolCalls.length} extracted tool calls`
      );

      // Process each extracted tool call sequentially
      for (const toolCall of extractedToolCalls) {
        await executeAndEmitToolCall(toolCall);
      }
    };

    // Helper function to process tool calls from a chunk
    const processChunkToolCalls = async (chunkToolCalls: ToolCall[]) => {
      if (chunkToolCalls.length === 0) {
        return;
      }

      console.log(
        `[Orchestrator] Processing ${chunkToolCalls.length} chunk tool calls`
      );

      // Process each tool call from the chunk sequentially
      for (const toolCall of chunkToolCalls) {
        await executeAndEmitToolCall(toolCall);
      }
    };

    if (!supportsTools) {
      // If the provider doesn't support tools natively, we need to extract them from the text
      // Create a wrapper for the onChunk callback
      const wrappedOnChunk = async (data: unknown) => {
        const chunk = data as LlmStreamChunk;
        console.log(
          `[Orchestrator] NON-NATIVE: Received chunk: ${JSON.stringify({
            content:
              chunk.content?.substring(0, 20) +
              (chunk.content && chunk.content.length > 20 ? "..." : ""),
            tool_calls: chunk.tool_calls?.map((tc) => tc.function.name),
            isFinal: chunk.isFinal
          })}`
        );

        // We need to ensure tools are executed sequentially
        // Process any tool calls in this chunk BEFORE emitting to avoid race conditions
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          console.log(
            `[Orchestrator] Processing ${chunk.tool_calls.length} chunk tool calls first`
          );

          // Add to tracking
          toolCalls = [...toolCalls, ...chunk.tool_calls];

          // Process each tool call in sequence
          await processChunkToolCalls(chunk.tool_calls);
        }

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

            // Process extracted tool calls
            await processExtractedToolCalls(extractedToolCalls);
          }
        }
      };

      // Stream the message with the wrapped callback
      const originalEmitter = await this.client.streamMessage(enhancedMessage);

      // Add data event handler with the wrapped callback
      originalEmitter.on("data", async (data: unknown) => {
        await wrappedOnChunk(data);
      });

      // Handle end event
      originalEmitter.on("end", async (data: unknown) => {
        console.log("[Orchestrator] Stream ended");

        // Process the finalData for potential tool calls (same as in native mode)
        const finalData = data as any;

        // Check for explicit tool_calls in the finalData
        if (finalData && finalData.tool_calls && finalData.tool_calls.length > 0) {
          console.log(
            `[Orchestrator] Processing ${finalData.tool_calls.length} tool calls from final data`
          );

          // Add to tracking
          for (const toolCall of finalData.tool_calls) {
            // Check if we already have this tool call tracked
            const existingToolCall = toolCalls.find(tc =>
              tc.function && toolCall.function &&
              tc.function.name === toolCall.function.name &&
              JSON.stringify(tc.function.arguments) === JSON.stringify(toolCall.function.arguments)
            );

            if (!existingToolCall) {
              console.log(`[Orchestrator] Adding new tool call from final data: ${toolCall.function.name}`);
              toolCalls.push(toolCall);

              // Also process this tool call
              await executeAndEmitToolCall(toolCall);
            }
          }
        }

        // Check for tool calls embedded in content
        if (finalData && finalData.content) {
          fullContent = finalData.content;
        }

        // Optionally extract and process any remaining tool calls from the accumulated content
        const { extractedToolCalls } = this.extractToolCallsFromPartialText(
          fullContent,
          true // isFinal
        );
        if (extractedToolCalls.length > 0) {
          console.log(
            `[Orchestrator] Extracted ${extractedToolCalls.length} remaining tool calls from final content`
          );

          // Process any newly found tool calls
          for (const toolCall of extractedToolCalls) {
            // Check if we already have processed this tool call
            const existingToolCall = toolCalls.find(tc =>
              tc.function && toolCall.function &&
              tc.function.name === toolCall.function.name &&
              JSON.stringify(tc.function.arguments) === JSON.stringify(toolCall.function.arguments)
            );

            if (!existingToolCall) {
              // Add to tracking
              toolCalls.push(toolCall);

              // Process this tool call
              await executeAndEmitToolCall(toolCall);
            }
          }
        }

        // Update the message with the full text and tool calls
        try {
          // Update message in chat manager if available
          if (this.chatManager) {
            await this.updateMessageContent(
              message.chatId,
              message.id,
              fullContent
            );

            if (toolCalls.length > 0) {
              await this.updateMessageToolCalls(
                message.chatId,
                message.id,
                toolCalls
              );
            }

            await this.updateMessageStatus(
              message.chatId,
              message.id,
              MessageStatus.SENT
            );
          }
        } catch (error) {
          console.error("[Orchestrator] Error updating message:", error);
        }

        // Emit end event after all tool calls have been executed
        console.log(
          "[Orchestrator] Emitting end event after executing all tool calls"
        );
        emitter.emit("end", finalData || {
          id: `response-${Date.now()}`,
          content: fullContent,
          tool_calls: toolCalls
        });
      });

      // Handle error event
      originalEmitter.on("error", (error: unknown) => {
        // Abort any pending tool calls
        this.toolCallQueue.abort();

        console.error("[Orchestrator] Stream error:", error);
        emitter.emit("error", error);
      });
    } else {
      // If the provider supports tools natively, process each chunk
      const originalEmitter = await this.client.streamMessage(enhancedMessage);

      // Add data event handler with synchronous processing
      originalEmitter.on("data", async (data: unknown) => {
        try {
          const chunk = data as LlmStreamChunk;

          console.log(
            `[Orchestrator] NATIVE: Received chunk: ${JSON.stringify({
              content:
                chunk.content?.substring(0, 20) +
                (chunk.content && chunk.content.length > 20 ? "..." : ""),
              tool_calls: chunk.tool_calls?.map((tc) => tc.function.name),
              isFinal: chunk.isFinal
            })}`
          );

          // Process tool calls BEFORE emitting the chunk (to maintain correct order)
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            console.log(
              `[Orchestrator] Native tool support: Processing ${chunk.tool_calls.length} tools from chunk`
            );

            // Update tracking
            toolCalls = [...toolCalls, ...chunk.tool_calls];

            // Process each tool call SEQUENTIALLY
            await processChunkToolCalls(chunk.tool_calls);
          }

          // Forward chunk to client after processing any tools
          emitter.emit("data", chunk);
          if (onChunk) onChunk(chunk);
        } catch (error) {
          console.error("[Orchestrator] Error processing chunk:", error);
        }
      });

      // Handle end event
      originalEmitter.on("end", async (data: unknown) => {
        console.log("[Orchestrator] Stream ended");

        // Update message in chat manager if available
        try {
          if (this.chatManager && toolCalls.length > 0) {
            await this.updateMessageToolCalls(
              message.chatId,
              message.id,
              toolCalls
            );
          }
        } catch (error) {
          console.error("[Orchestrator] Error updating message:", error);
        }

        // Emit end event after all tool calls have been executed
        console.log(
          "[Orchestrator] Emitting end event after executing all tool calls"
        );
        emitter.emit("end", data);
      });

      // Handle error event
      originalEmitter.on("error", (error: unknown) => {
        // Abort any pending tool calls
        this.toolCallQueue.abort();

        console.error("[Orchestrator] Stream error:", error);
        emitter.emit("error", error);
      });
    }

    return emitter;
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
    if (!isFinal && text.length < 50 && !text.includes("<tool>") && !text.includes(`<${this.MCP_TOOL_USE}>`)) {
      return { content: text, extractedToolCalls: [] };
    }

    const extractedToolCalls: ToolCall[] = [];
    let updatedContent = text;

    // First check for standard tool format: <tool>...</tool>
    let standardToolRegex = /<tool>([\s\S]*?)<\/tool>/g;
    let match;

    // Extract complete tool calls with standard format
    while ((match = standardToolRegex.exec(text)) !== null) {
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
        console.error("Error parsing standard tool call:", error);
      }
    }

    // Then check MCP tool use format: <json mcp-tool-use>...</json mcp-tool-use>
    const mcpToolRegex = new RegExp(
      `<${this.MCP_TOOL_USE}>([\\s\\S]*?)<(?:\\/)?${this.MCP_TOOL_USE}>`,
      "g"
    );

    // Extract complete tool calls with MCP format
    while ((match = mcpToolRegex.exec(text)) !== null) {
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
        console.error("Error parsing MCP tool call:", error);
      }
    }

    // Remove complete tool calls from the content
    if (extractedToolCalls.length > 0) {
      // Remove standard format tools
      updatedContent = updatedContent.replace(standardToolRegex, "");

      // Remove MCP format tools
      updatedContent = updatedContent.replace(mcpToolRegex, "");
    }

    // If this is the final chunk, try to extract incomplete tool calls
    if (isFinal) {
      // Check for incomplete standard tool calls
      const incompleteStandardToolRegex = /<tool>([\s\S]*)$/;
      const incompleteStandardMatch = incompleteStandardToolRegex.exec(updatedContent);

      if (incompleteStandardMatch && incompleteStandardMatch[1]) {
        try {
          const toolJson = incompleteStandardMatch[1].trim();
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
          updatedContent = updatedContent.replace(incompleteStandardToolRegex, "");
        } catch {
          // Ignore parsing errors for incomplete tool calls
        }
      }

      // Check for incomplete MCP tool calls
      const incompleteMcpToolRegex = new RegExp(`<${this.MCP_TOOL_USE}>([\\\s\\\S]*)$`);
      const incompleteMcpMatch = incompleteMcpToolRegex.exec(updatedContent);

      if (incompleteMcpMatch && incompleteMcpMatch[1]) {
        try {
          const toolJson = incompleteMcpMatch[1].trim();
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
          updatedContent = updatedContent.replace(incompleteMcpToolRegex, "");
        } catch {
          // Ignore parsing errors for incomplete tool calls
        }
      }
    }

    // Log when we extract tools (helpful for debugging)
    if (extractedToolCalls.length > 0) {
      console.log(`[Orchestrator] Extracted ${extractedToolCalls.length} tool calls from text`);
      console.log(`[Orchestrator] Tool calls:`, extractedToolCalls.map(tc => tc.function.name));
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
