import { EventEmitter } from "@piddie/shared-types";
import type {
  LlmClient,
  LlmMessage,
  LlmProviderConfig,
  LlmResponse,
  LlmStreamChunk
} from "./types";
import type {
  ChatManager,
  ToolCall,
  Message,
  ToolCallResult
} from "@piddie/chat-management";
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
   * @returns A promise that resolves with the tool call itself (containing the result)
   */
  async enqueue(toolCall: ToolCall): Promise<ToolCall> {
    // If the queue is aborted, reject immediately
    if (this.aborted) {
      return Promise.reject(new Error("Tool call queue has been aborted"));
    }

    // Return a promise that will be resolved when the tool call is executed
    return new Promise((resolve, reject) => {
      // Add the tool call to the queue
      this.queue.push({
        toolCall,
        resolve: () => resolve(toolCall),
        reject
      });

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
      await this.executeToolFn(toolCall);
      // Resolve the promise with the tool call itself (now containing the result)
      resolve(toolCall);
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
    // This now expects the function to modify the toolCall in place by adding the result
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
   * Updates the tool calls of a message
   * @param chatId The chat ID
   * @param messageId The message ID
   * @param toolCalls The tool calls
   */
  private updateMessageToolCalls(
    chatId: string,
    messageId: string,
    toolCalls: ToolCall[]
  ) {
    if (!this.chatManager) {
      return;
    }

    // Use the chat manager to update the message
    this.chatManager.updateMessage(chatId, messageId, {
      tool_calls: toolCalls
    });
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
  private async executeToolCall(toolCall: ToolCall): Promise<ToolCallResult> {
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

      // Attach the result to the tool call
      toolCall.result = {
        status: result.status,
        value: result.value,
        contentType: result.contentType,
        timestamp: result.timestamp
      };

      console.log(
        `[Orchestrator] Tool call executed successfully: ${toolName}`,
        result
      );
      return result;
    } catch (error) {
      // Attach error result to the tool call
      toolCall.result = {
        status: "error",
        value: error instanceof Error ? error.message : String(error),
        contentType: "text/plain",
        timestamp: new Date()
      };

      // Return the error to be handled by the caller
      console.error(`[Orchestrator] Error executing tool call:`, error);
      throw error;
    }
  }

  /**
   * Executes a tool call but wraps the result in a structure
   * that includes both the result and any error that occurred
   * This is a synchronous version to support the non-streaming flow
   * @param toolCall The tool call to execute
   */
  private executeToolCallWrapper(toolCall: {
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }): { result: unknown; error?: string } {
    try {
      // Validate the tool call
      if (!toolCall.function || !toolCall.function.name) {
        return {
          result: null,
          error: "Invalid tool call: missing function name"
        };
      }

      // Extract the name and arguments
      const { name } = toolCall.function;

      // The actionsManager.executeToolCall returns a Promise, but we need a synchronous result
      // In the non-streaming flow, we should already have the result cached from the streaming execution
      // This is a fallback that will return a placeholder
      return {
        result: {
          status: "success",
          value: `Tool ${name} was executed`,
          contentType: "text/plain",
          timestamp: new Date()
        }
      };
    } catch (error) {
      // Return the error in a structured format
      return {
        result: null,
        error: error instanceof Error ? error.message : String(error)
      };
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
    const toolCalls: ToolCall[] = [];

    // Track processed tool calls to prevent duplicate execution
    const processedToolCallIds = new Set<string>();

    // Check if the provider supports tools natively
    const supportsTools = await this.client.checkToolSupport();

    // Helper function to emit tool result as a chunk
    const emitToolResult = (toolName: string, toolCall: ToolCall) => {
      if (!toolCall.result) {
        console.warn(`[Orchestrator] Tool call for ${toolName} has no result`);
        return;
      }

      // Create a chunk with the tool call that has the result attached
      const chunk: LlmStreamChunk = {
        tool_calls: [toolCall],
        content: "",
        isFinal: false
      };

      // Emit the chunk with the tool call + result
      console.log(`[Orchestrator] Emitting tool result chunk for ${toolName}`, {
        status: toolCall.result.status
      });
      emitter.emit("data", chunk);
      if (onChunk) onChunk(chunk);

      // Also emit a custom event to signal tool execution completion
      emitter.emit("tool_result", { toolCall });
    };

    // Helper function to generate a consistent ID for a tool call
    const getToolCallId = (toolCall: ToolCall): string => {
      if (!toolCall || !toolCall.function) return "";

      const args =
        typeof toolCall.function.arguments === "string"
          ? toolCall.function.arguments
          : JSON.stringify(toolCall.function.arguments || {});

      return `${toolCall.function.name}-${args}`;
    };

    // Helper function to execute a tool call and emit the result
    const executeAndEmitToolCall = async (
      toolCall: ToolCall
    ): Promise<boolean> => {
      if (!toolCall || !toolCall.function || !toolCall.function.name) {
        console.log(`[Orchestrator] Invalid tool call, skipping execution`);
        return false;
      }

      const toolName = toolCall.function.name;

      // Validate that arguments are in a usable form before execution
      // This prevents executing incomplete tool calls
      try {
        // Verify we can parse the arguments if they're a string
        if (typeof toolCall.function.arguments === "string") {
          try {
            JSON.parse(toolCall.function.arguments);
          } catch (parseError) {
            console.log(
              `[Orchestrator] Tool call arguments are not valid JSON, skipping execution: ${toolName}`,
              parseError
            );
            return false;
          }
        } else if (
          !toolCall.function.arguments ||
          typeof toolCall.function.arguments !== "object"
        ) {
          console.log(
            `[Orchestrator] Tool call has invalid arguments format, skipping execution: ${toolName}`
          );
          return false;
        }
      } catch (error) {
        console.error(
          `[Orchestrator] Error validating tool call arguments: ${toolName}`,
          error
        );
        return false;
      }

      // Create a unique ID for this tool call
      const toolCallId = getToolCallId(toolCall);

      // Skip if already executed
      if (processedToolCallIds.has(toolCallId)) {
        console.log(
          `[Orchestrator] Skipping already executed tool: ${toolName}`
        );
        return false;
      }

      // Mark as executed
      this.executedToolCalls.add(toolCallId);
      processedToolCallIds.add(toolCallId);

      try {
        console.log(
          `[Orchestrator] Starting execution of tool call: ${toolName}`
        );

        // Enqueue tool call for sequential processing - now returns the toolCall with result
        await this.toolCallQueue.enqueue(toolCall);

        console.log(`[Orchestrator] Tool call execution complete: ${toolName}`);

        // Emit a custom event for tracking tool execution
        emitter.emit("tool_executed", { toolCall });

        // Add to tracking
        const existingToolCall = toolCalls.find(
          (tc) => getToolCallId(tc) === toolCallId
        );

        if (!existingToolCall) {
          toolCalls.push(toolCall);
        }

        // Emit the result (without appending to content)
        emitToolResult(toolName, toolCall);
        return true;
      } catch (error) {
        console.error(
          `[Orchestrator] Error executing tool call: ${toolName}`,
          error
        );

        // The error result is already attached to the toolCall object in executeToolCall

        // Emit a custom event for tracking tool execution
        emitter.emit("tool_executed", { toolCall });

        // Emit the result (which will be an error) without appending to content
        emitToolResult(toolName, toolCall);
        return true;
      }
    };

    // Process all tool calls from a chunk, handling partial calls appropriately
    const processChunkToolCalls = async (
      chunkToolCalls: ToolCall[]
    ): Promise<void> => {
      console.log(
        `[Orchestrator] Processing ${chunkToolCalls.length} chunk tool calls`
      );

      // Filter out incomplete tool calls to avoid execution failures
      const completeToolCalls = chunkToolCalls.filter((toolCall) => {
        try {
          if (!toolCall.function || !toolCall.function.name) {
            console.log(
              `[Orchestrator] Skipping invalid tool call: missing name`
            );
            return false;
          }

          const args = toolCall.function.arguments;
          // For string arguments, try to parse as JSON
          if (typeof args === "string") {
            try {
              JSON.parse(args);
            } catch {
              console.log(
                `[Orchestrator] Skipping incomplete tool call: ${toolCall.function.name} (invalid JSON arguments)`
              );
              return false;
            }
          } else if (!args || typeof args !== "object") {
            console.log(
              `[Orchestrator] Skipping incomplete tool call: ${toolCall.function.name} (missing arguments)`
            );
            return false;
          }

          return true;
        } catch (error) {
          console.error("[Orchestrator] Error filtering tool calls:", error);
          return false;
        }
      });

      if (completeToolCalls.length < chunkToolCalls.length) {
        console.log(
          `[Orchestrator] Filtered out ${chunkToolCalls.length - completeToolCalls.length
          } incomplete tool calls`
        );
      }

      for (const toolCall of completeToolCalls) {
        await executeAndEmitToolCall(toolCall);
      }
    };

    // Helper function to process extracted tool calls (simplified now)
    const processExtractedToolCalls = async (
      extractedToolCalls: ToolCall[]
    ): Promise<void> => {
      // Use the same processing flow as chunk tool calls
      await processChunkToolCalls(extractedToolCalls);
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

          // If we found complete tool calls, update the accumulated content
          if (extractedToolCalls.length > 0) {
            console.log(
              `[Orchestrator] Extracted ${extractedToolCalls.length} tool calls from text`
            );
            fullContent = content;

            // Add the extracted tool calls to our tracking array
            for (const extractedToolCall of extractedToolCalls) {
              const toolCallId = getToolCallId(extractedToolCall);

              // Only add if not already in toolCalls array
              if (!toolCalls.some((tc) => getToolCallId(tc) === toolCallId)) {
                console.log(
                  `[Orchestrator] Adding extracted tool call to tracking: ${extractedToolCall.function.name}`
                );
                toolCalls.push(extractedToolCall);
              }
            }

            // Process extracted tool calls using the same flow
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
      originalEmitter.on("end", async (finalData: LlmStreamChunk) => {
        console.log("[Orchestrator] Stream ended");

        // Check for explicit tool_calls in the finalData
        if (
          finalData &&
          finalData.tool_calls &&
          finalData.tool_calls.length > 0
        ) {
          console.log(
            `[Orchestrator] Processing ${finalData.tool_calls.length} tool calls from final data`
          );

          // Process the tool calls
          await processChunkToolCalls(finalData.tool_calls);
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

          // Add the extracted tool calls to our tracking array
          for (const extractedToolCall of extractedToolCalls) {
            const toolCallId = getToolCallId(extractedToolCall);

            // Only add if not already in toolCalls array
            if (!toolCalls.some((tc) => getToolCallId(tc) === toolCallId)) {
              console.log(
                `[Orchestrator] Adding final extracted tool call to tracking: ${extractedToolCall.function.name}`
              );
              toolCalls.push(extractedToolCall);
            }
          }

          // Process the extracted tool calls
          await processExtractedToolCalls(extractedToolCalls);
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

        // Ensure any pending tool calls are completed before emitting the end event
        if (
          this.toolCallQueue.isActive ||
          this.toolCallQueue.pendingCount > 0
        ) {
          console.log(
            "[Orchestrator] Waiting for pending tool calls to complete before ending stream"
          );

          // Wait a short period for tool calls to complete
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Emit end event after all tool calls have been executed
        console.log(
          "[Orchestrator] Emitting end event after executing all tool calls"
        );
        emitter.emit(
          "end",
          finalData || {
            id: `response-${Date.now()}`,
            content: fullContent,
            tool_calls: toolCalls
          }
        );
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

        // Ensure any pending tool calls are completed before emitting the end event
        if (
          this.toolCallQueue.isActive ||
          this.toolCallQueue.pendingCount > 0
        ) {
          console.log(
            "[Orchestrator] Waiting for pending tool calls to complete before ending stream"
          );

          // Wait a short period for tool calls to complete
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Emit end event after all tool calls have been executed
        console.log(
          "[Orchestrator] Emitting end event after executing all tool calls"
        );
        emitter.emit("end", {
          ...(data as LlmStreamChunk),
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
    if (
      !isFinal &&
      text.length < 50 &&
      !text.includes("<tool>") &&
      !text.includes(`<${this.MCP_TOOL_USE}>`)
    ) {
      return { content: text, extractedToolCalls: [] };
    }

    const extractedToolCalls: ToolCall[] = [];
    let updatedContent = text;

    // MCP tool use format: ```json mcp-tool-use>...```
    // Only extract complete tool calls that have both opening and closing ```
    const completeToolCallRegex = new RegExp(
      `\`\`\`${this.MCP_TOOL_USE}\n(.*?)\n\`\`\``,
      "gs"
    );

    let match;
    while ((match = completeToolCallRegex.exec(text)) !== null) {
      try {
        if (match[1]) {
          const toolJson = match[1].trim();

          // Only attempt to parse if the JSON appears to be complete
          if (toolJson.includes('"name"') && toolJson.includes('"arguments"')) {
            try {
              const tool = JSON.parse(toolJson);

              // Verify the tool has required fields before adding it
              if (tool && tool.name) {
                extractedToolCalls.push({
                  function: {
                    name: tool.name,
                    arguments:
                      typeof tool.arguments === "string"
                        ? tool.arguments
                        : JSON.stringify(tool.arguments || {})
                  }
                });

                // Log successfully extracted tool call
                console.log(
                  `[Orchestrator] Successfully extracted tool call: ${tool.name}`
                );
              }
            } catch (parseError) {
              // Only log parsing errors if this is the final chunk
              if (isFinal) {
                console.error("Error parsing MCP tool call:", parseError);
              }
              // Skip this tool call if parsing fails - it might be incomplete
              continue;
            }
          }
        }
      } catch (error) {
        console.error("Error processing MCP tool call:", error);
      }
    }

    // Remove complete tool calls from the content
    if (extractedToolCalls.length > 0) {
      // Remove MCP format tools
      updatedContent = updatedContent.replace(completeToolCallRegex, "");
    }

    // If this is the final chunk, try to extract incomplete tool calls
    if (isFinal) {
      // Check for incomplete MCP tool calls - this is a best effort to extract tools from partial content
      const incompleteMcpToolRegex = new RegExp(
        `\`\`\`${this.MCP_TOOL_USE}\n(.*?)(?:\`\`\`|$)`,
        "s"
      );
      const incompleteMcpMatch = incompleteMcpToolRegex.exec(updatedContent);

      if (incompleteMcpMatch && incompleteMcpMatch[1]) {
        try {
          const toolJson = incompleteMcpMatch[1].trim();
          // Only attempt to parse if the JSON appears to be complete
          if (toolJson.includes('"name"') && toolJson.includes('"arguments"')) {
            try {
              const tool = JSON.parse(toolJson);

              if (tool && tool.name) {
                extractedToolCalls.push({
                  function: {
                    name: tool.name,
                    arguments:
                      typeof tool.arguments === "string"
                        ? tool.arguments
                        : JSON.stringify(tool.arguments || {})
                  }
                });

                // Remove the tool call from the content
                updatedContent = updatedContent.replace(
                  incompleteMcpToolRegex,
                  ""
                );
                console.log(
                  `[Orchestrator] Extracted incomplete tool call in final chunk: ${tool.name}`
                );
              }
            } catch {
              // Ignore parsing errors for incomplete tool calls in final chunk
              console.log(
                `[Orchestrator] Failed to parse incomplete tool call JSON in final chunk`
              );
            }
          }
        } catch {
          // Ignore general errors for incomplete tool calls
        }
      }
    }

    // Log when we extract tools (helpful for debugging)
    if (extractedToolCalls.length > 0) {
      console.log(
        `[Orchestrator] Extracted ${extractedToolCalls.length} tool calls from text`
      );
      console.log(
        `[Orchestrator] Tool calls:`,
        extractedToolCalls.map((tc) => tc.function?.name)
      );
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

    USE THE TOOLS!
    I will provide you with tools you can use to interact with my development environment. 
    If you utilize a tool, explain that you are doing it and why you do it.
    Make sure you populate all required parameters with the required data types of each tool you use
    You can use multiple tools in a single message if needed.
    After using a tool, continue your response based on the tool's output.
    `;

    // If the LLM doesn't support tools natively, add instructions for using tools
    if (!supportsTools) {
      systemPrompt += `\n\n
              
        When you use a tool, format EACH tool call in your response like this (one block per tool call!):

        \`\`\`${this.MCP_TOOL_USE}
        {
          "name": "tool_name",
          "arguments": {
            "arg1": "value1",
            "arg2": "value2"
          }
        }
        \`\`\`

        Simple example:

        \`\`\`${this.MCP_TOOL_USE}
        {
          "name": "search",
          "arguments": {
            "query": "What is the capital of France?"
          }
        }
        \`\`\`

        Multiple tool calls example using the same tool twice:
        \`\`\`${this.MCP_TOOL_USE}
        {
          "name": "tool1",
          "arguments": {
            "arg1": "one",
            "arg2": "two"
          }
        }
        \`\`\`

        \`\`\`${this.MCP_TOOL_USE}
        {
          "name": "tool1",
          "arguments": {
            "arg1": "three",
            "arg2": "four"
          }
        }
        \`\`\`

        Always format your tool calls exactly as shown above.
`;
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
      const accumulatedToolCalls: ToolCall[] = [];

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
            // Look for new tool calls that we haven't seen before
            for (const newToolCall of chunk.tool_calls) {
              // Skip if we already have this tool call
              const existingToolCall = accumulatedToolCalls.find(
                (tc) =>
                  tc.function.name === newToolCall.function.name &&
                  JSON.stringify(tc.function.arguments) ===
                  JSON.stringify(newToolCall.function.arguments)
              );

              if (!existingToolCall) {
                // This is a new tool call, add it to our tracking
                accumulatedToolCalls.push(newToolCall);
              } else if (newToolCall.result && !existingToolCall.result) {
                // We've seen this tool call before but now it has a result
                // Update the existing tool call with the result
                existingToolCall.result = newToolCall.result;
              }
            }

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
