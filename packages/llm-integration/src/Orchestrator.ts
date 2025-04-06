import { EventEmitter } from "@piddie/shared-types";
import type {
  LlmClient,
  LlmMessage,
  LlmProviderConfig,
  LlmStreamChunk
} from "./types";
import type {
  ChatManager,
  ToolCall,
  Message} from "@piddie/chat-management";
import { MessageStatus } from "@piddie/chat-management";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LlmAdapter } from "./index";
import { ActionsManager, type Tool } from "@piddie/actions";
import { AgentManager } from "./AgentManager";
import { ToolCallQueue } from "./utils/ToolCallQueue";
import { extractToolCallsFromPartialText } from "./utils/toolExtractor";
import {
  executeToolCall,
  getToolCallId,
  filterValidToolCalls,
  processToolCall,
  prepareAndEmitEndEvent
} from "./utils/toolCallUtils";
import {
  updateMessageStatus,
  updateMessageContent,
  updateMessageToolCalls
} from "./utils/chatMessageUpdateUtils";
import {
  enhanceMessageWithHistoryAndTools,
  enhanceMessageWithSystemPrompt
} from "./utils/messagePreparationUtils";
import { compileSystemPrompt } from "./utils/systemPromptUtils";

/**
 * Configuration for agentic behavior
 */
export interface AgentConfig {
  /** Whether agentic behavior is enabled */
  enabled: boolean;
  /** Maximum number of agentic roundtrips before terminating */
  maxRoundtrips: number;
  /** Whether to continue automatically after tool execution */
  autoContinue: boolean;
  /** Custom system prompt to use for agentic communication */
  customSystemPrompt?: string;
}

/**
 * Orchestrator for LLM interactions
 * Manages LLM providers and delegates tool operations to the ActionsManager
 */
export class Orchestrator implements LlmAdapter {
  private llmProviders: Map<string, LlmProviderConfig> = new Map();
  private client: LlmClient;
  private chatManager: ChatManager | undefined;
  private actionsManager: ActionsManager;
  // Track executed tool calls to avoid duplicates
  private executedToolCalls = new Set<string>();
  public readonly MCP_TOOL_USE = "mcp-tool-use";
  // Tool call queue for sequential execution
  private toolCallQueue: ToolCallQueue;
  // Agent manager for handling agentic flow
  private agentManager: AgentManager | undefined;

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
    this.toolCallQueue = new ToolCallQueue(
      (toolCall: ToolCall) => executeToolCall(toolCall, actionsManager)
    );

    // Initialize agent manager if chat manager is available
    if (this.chatManager) {
      this.agentManager = new AgentManager(
        this.chatManager,
        this.getLlmProvider.bind(this),
        this.getCompletion.bind(this),
        ""  // Will be set when a provider is used
      );
    }
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
    return this.llmProviders.delete(name.toLowerCase());
  }

  /**
   * Register a local MCP server
   * @param server The MCP server to register
   * @param name The name to register the server under
   */
  async registerLocalMcpServer(server: McpServer, name: string): Promise<void> {
    await this.actionsManager.registerServer(server, name);
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
    return this.actionsManager.unregisterServer(name);
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
    try {
      return await this.actionsManager.getAvailableTools();
    } catch (error) {
      console.error("[Orchestrator] Error listing tools:", error);
      return [];
    }
  }

  /**
   * Configure agentic behavior for a chat
   * @param chatId The ID of the chat to configure
   * @param config Configuration options
   */
  configureAgent(chatId: string, config: {
    enabled: boolean;
    maxRoundtrips?: number;
    autoContinue?: boolean;
    customSystemPrompt?: string;
  }): void {
    if (this.agentManager) {
      this.agentManager.configureAgent(chatId, config);
    } else {
      console.warn("[Orchestrator] Agent manager not available, cannot configure agent");
    }
  }

  /**
   * Reset agentic context for a chat
   * @param chatId The ID of the chat to reset
   */
  resetAgent(chatId: string): void {
    if (this.agentManager) {
      this.agentManager.resetAgent(chatId);
    }
  }

  /**
   * Check if agent is enabled for a chat
   * @param chatId The ID of the chat to check
   * @returns True if agent is enabled, false otherwise
   */
  isAgentEnabled(chatId: string): boolean {
    return this.agentManager ? this.agentManager.isAgentEnabled(chatId) : false;
  }

  /**
   * Enhances a message with chat history and tools
   * @param message The message to enhance
   * @returns The enhanced message
   */
  private async enhanceMessageWithHistoryAndTools(
    message: LlmMessage
  ): Promise<LlmMessage> {
    // Get available tools first
    const availableTools = await this.getAvailableTools();

    return enhanceMessageWithHistoryAndTools(
      message,
      this.chatManager,
      this.agentManager,
      availableTools
    );
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

    // Helper function to execute a tool call and emit the result
    const executeAndEmitToolCall = async (
      toolCall: ToolCall
    ): Promise<boolean> => {
      const wasProcessed = await processToolCall(
        toolCall,
        processedToolCallIds,
        toolCalls,
        this.toolCallQueue
      );

      if (wasProcessed && toolCall.result) {
        // Add to global tracking
        this.executedToolCalls.add(getToolCallId(toolCall));

        // Emit the result
        emitToolResult(toolCall.function.name, toolCall);

        // Emit a custom event for tracking tool execution
        emitter.emit("tool_executed", { toolCall });
      }

      return wasProcessed;
    };

    // Process all tool calls from a chunk, handling partial calls appropriately
    const processChunkToolCalls = async (
      chunkToolCalls: ToolCall[]
    ): Promise<void> => {
      console.log(
        `[Orchestrator] Processing ${chunkToolCalls.length} chunk tool calls`
      );

      // Filter out incomplete tool calls to avoid execution failures
      const completeToolCalls = filterValidToolCalls(chunkToolCalls);

      for (const toolCall of completeToolCalls) {
        await executeAndEmitToolCall(toolCall);
      }
    };

    // Helper function to process extracted tool calls
    const processExtractedToolCalls = async (
      extractedToolCalls: ToolCall[]
    ): Promise<void> => {
      await processChunkToolCalls(extractedToolCalls);
    };

    // Helper function to update messages with tool calls and handle agent processing
    const updateMessageWithToolCalls = async () => {
      if (this.chatManager && toolCalls.length > 0) {
        updateMessageToolCalls(
          message.chatId,
          message.id,
          toolCalls,
          this.chatManager
        );

        // Handle agentic flow if enabled
        if (this.agentManager && this.agentManager.isAgentEnabled(message.chatId)) {
          console.log(`[Orchestrator] Agent is enabled for chat ${message.chatId}, processing tool calls`);
          await this.agentManager.processToolCalls(message.chatId, message.id, toolCalls);
        } else {
          console.log(`[Orchestrator] Agent is NOT enabled for chat ${message.chatId}, skipping tool call processing`);
        }
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

        // Process any tool calls in this chunk BEFORE emitting to avoid race conditions
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          console.log(
            `[Orchestrator] Processing ${chunk.tool_calls.length} chunk tool calls first`
          );
          await processChunkToolCalls(chunk.tool_calls);
        }

        // Emit the chunk immediately to ensure UI updates without delay
        emitter.emit("data", chunk);
        if (onChunk) onChunk(chunk);

        // Accumulate the content
        if (chunk.content) {
          fullContent += chunk.content;

          // Extract and process any tool calls from accumulated content
          const { content, extractedToolCalls } =
            this.extractToolCallsFromPartialText(fullContent);

          if (extractedToolCalls.length > 0) {
            console.log(
              `[Orchestrator] Extracted ${extractedToolCalls.length} tool calls from text`
            );
            fullContent = content;

            // Add the extracted tool calls to our tracking array
            for (const extractedToolCall of extractedToolCalls) {
              const toolCallId = getToolCallId(extractedToolCall);
              if (!toolCalls.some((tc) => getToolCallId(tc) === toolCallId)) {
                console.log(
                  `[Orchestrator] Adding extracted tool call to tracking: ${extractedToolCall.function.name}`
                );
                toolCalls.push(extractedToolCall);
              }
            }

            await processExtractedToolCalls(extractedToolCalls);
          }
        }
      };

      // Stream the message with the wrapped callback
      const originalEmitter = await this.client.streamMessage(enhancedMessage);
      originalEmitter.on("data", async (data: unknown) => {
        await wrappedOnChunk(data);
      });

      // Handle end event
      originalEmitter.on("end", async (finalData: LlmStreamChunk) => {
        console.log("[Orchestrator] Stream ended");

        // Process any explicit tool_calls in finalData
        if (finalData?.tool_calls && finalData.tool_calls.length > 0) {
          console.log(
            `[Orchestrator] Processing ${finalData.tool_calls.length} tool calls from final data`
          );
          await processChunkToolCalls(finalData.tool_calls);
        }

        // Update content with final data if available
        if (finalData?.content) {
          fullContent = finalData.content;
        }

        // Extract and process any remaining tool calls from final content
        const { extractedToolCalls } = this.extractToolCallsFromPartialText(
          fullContent,
          true // isFinal
        );

        if (extractedToolCalls.length > 0) {
          console.log(
            `[Orchestrator] Extracted ${extractedToolCalls.length} remaining tool calls from final content`
          );

          for (const extractedToolCall of extractedToolCalls) {
            const toolCallId = getToolCallId(extractedToolCall);
            if (!toolCalls.some((tc) => getToolCallId(tc) === toolCallId)) {
              console.log(
                `[Orchestrator] Adding final extracted tool call to tracking: ${extractedToolCall.function.name}`
              );
              toolCalls.push(extractedToolCall);
            }
          }

          await processExtractedToolCalls(extractedToolCalls);
        }

        // Update message with tool calls and process agent if enabled
        try {
          // Ensure we wait for the update to complete before ending
          await updateMessageWithToolCalls();

          // Add small delay to ensure agent processing completes
          await new Promise(resolve => setTimeout(resolve, 10));

          updateMessageStatus(
            message.chatId,
            message.id,
            MessageStatus.SENT,
            this.chatManager
          );
        } catch (error) {
          console.error("[Orchestrator] Error updating message:", error);
        }

        // Emit end event after all tool calls have been executed
        await prepareAndEmitEndEvent(
          emitter,
          this.toolCallQueue,
          finalData,
          toolCalls,
          fullContent
        );
      });

      // Handle error event
      originalEmitter.on("error", (error: unknown) => {
        this.toolCallQueue.abort();
        console.error("[Orchestrator] Stream error:", error);
        emitter.emit("error", error);
      });
    } else {
      // Handle native tool support
      const originalEmitter = await this.client.streamMessage(enhancedMessage);

      // Process data chunks
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

          // Process tool calls before emitting
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            console.log(
              `[Orchestrator] Native tool support: Processing ${chunk.tool_calls.length} tools from chunk`
            );
            await processChunkToolCalls(chunk.tool_calls);
          }

          // Forward chunk to client
          emitter.emit("data", chunk);
          if (onChunk) onChunk(chunk);
        } catch (error) {
          console.error("[Orchestrator] Error processing chunk:", error);
        }
      });

      // Handle end event
      originalEmitter.on("end", async (data: unknown) => {
        console.log("[Orchestrator] Stream ended");

        // Update message with tool calls and process agent if enabled
        try {
          await updateMessageWithToolCalls();
        } catch (error) {
          console.error("[Orchestrator] Error updating message:", error);
        }

        // Emit end event
        await prepareAndEmitEndEvent(
          emitter,
          this.toolCallQueue,
          data as LlmStreamChunk,
          toolCalls
        );
      });

      // Handle error event
      originalEmitter.on("error", (error: unknown) => {
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
    return extractToolCallsFromPartialText(text, this.MCP_TOOL_USE, isFinal);
  }

  /**
   * Enhance a message with system prompt
   * @param message The message to enhance
   * @returns The enhanced message
   */
  enhanceMessage(message: LlmMessage): LlmMessage {

    return enhanceMessageWithSystemPrompt(message, !!this.client.checkToolSupport, this.MCP_TOOL_USE);
  }

  /**
   * Generate a system prompt
   * @param supportsTools Whether the LLM provider supports tools natively
   * @returns The system prompt
   */
  generateSystemPrompt(supportsTools: boolean = true): string {
    return compileSystemPrompt(supportsTools, this.MCP_TOOL_USE);
  }

  /**
   * Get a completion for a user message and update the assistant placeholder
   * @param userMessage The user message
   * @param assistantPlaceholder The assistant placeholder message
   * @param providerConfig The LLM provider configuration
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
              updateMessageContent(
                assistantPlaceholder.chatId,
                assistantPlaceholder.id,
                accumulatedContent,
                this.chatManager
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
              updateMessageToolCalls(
                assistantPlaceholder.chatId,
                assistantPlaceholder.id,
                accumulatedToolCalls,
                this.chatManager
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
            updateMessageStatus(
              assistantPlaceholder.chatId,
              assistantPlaceholder.id,
              MessageStatus.ERROR,
              this.chatManager
            );
          }

          reject(error);
        });
      });
    } catch (error) {
      console.error("[Orchestrator] Error getting completion:", error);

      // Update the assistant placeholder status
      if (this.chatManager) {
        updateMessageStatus(
          assistantPlaceholder.chatId,
          assistantPlaceholder.id,
          MessageStatus.ERROR,
          this.chatManager
        );
      }

      throw error;
    }
  }
}
