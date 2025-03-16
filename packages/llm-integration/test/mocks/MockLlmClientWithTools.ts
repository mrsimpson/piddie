import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "@piddie/shared-types";
import { BaseLlmClient, ToolSupportStatus } from "../../src/BaseLlmClient";
import type {
  LlmMessage,
  LlmProviderConfig,
  LlmResponse,
  LlmStreamChunk
} from "../../src/types";
import { LlmStreamEvent } from "../../src/types";
import type { ToolCall } from "@piddie/chat-management";

/**
 * Configuration for the mock LLM client
 */
export interface MockToolLlmClientConfig {
  /** Whether the client supports tools natively */
  supportsTools?: boolean;
  /** Tool calls to include in the response */
  toolCalls?: ToolCall[];
  /** Content to include in the response */
  content?: string;
  /** Whether to simulate streaming */
  streaming?: boolean;
  /** Whether to simulate an error */
  simulateError?: boolean;
  /** Whether to simulate partial tool calls in streaming */
  simulatePartialToolCalls?: boolean;
  /** Whether to simulate tool calls mixed with content */
  simulateMixedToolCalls?: boolean;
  /** Whether to simulate parameter-less tool calls */
  simulateParameterlessToolCalls?: boolean;
}

/**
 * Mock LLM client for testing tool execution
 */
export class MockLlmClientWithTools extends BaseLlmClient {
  private mockConfig: MockToolLlmClientConfig;

  /**
   * Creates a new MockToolLlmClient
   * @param llmConfig The LLM provider configuration
   * @param mockConfig The mock configuration
   */
  constructor(
    llmConfig: LlmProviderConfig,
    mockConfig: MockToolLlmClientConfig = {}
  ) {
    super(llmConfig);
    this.mockConfig = mockConfig;
    this.toolSupportStatus = mockConfig.supportsTools
      ? ToolSupportStatus.NATIVE
      : ToolSupportStatus.VIA_PROMPT;
  }

  /**
   * Updates the mock configuration
   * @param config The new configuration
   */
  updateMockConfig(config: Partial<MockToolLlmClientConfig>): void {
    this.mockConfig = { ...this.mockConfig, ...config };
    this.toolSupportStatus = this.mockConfig.supportsTools
      ? ToolSupportStatus.NATIVE
      : ToolSupportStatus.VIA_PROMPT;
  }

  /**
   * Sends a message to the mock LLM and receives a response
   * @param message The message to send
   * @returns A promise that resolves to the LLM response
   */
  override async sendMessage(message: LlmMessage): Promise<LlmResponse> {
    if (this.mockConfig.simulateError) {
      throw new Error("Simulated error in sendMessage");
    }

    // Simulate a delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create the response
    const response: LlmResponse = {
      id: uuidv4(),
      chatId: message.chatId,
      content: this.getResponseContent(message),
      role: "assistant",
      created: new Date(),
      parentId: message.id
    };

    // Add tool calls if configured
    if (this.mockConfig.toolCalls && this.mockConfig.toolCalls.length > 0) {
      if (this.mockConfig.supportsTools) {
        // For native tool support, add the tool calls directly
        response.tool_calls = this.mockConfig.toolCalls;
      } else {
        // For non-native tool support, embed the tool calls in the content
        response.content += this.getToolCallsAsText();
      }
    }

    return response;
  }

  /**
   * Sends a message to the mock LLM and streams the response
   * @param message The message to send
   * @returns An event emitter that emits 'data', 'end', and 'error' events
   */
  override streamMessage(message: LlmMessage): EventEmitter {
    const eventEmitter = new EventEmitter();

    // Process the message asynchronously
    (async () => {
      if (this.mockConfig.simulateError) {
        eventEmitter.emit(
          LlmStreamEvent.ERROR,
          new Error("Simulated error in streamMessage")
        );
        return;
      }

      // Create a full response object that will be emitted with the END event
      const fullResponse: LlmResponse = {
        id: uuidv4(),
        chatId: message.chatId,
        content: this.getResponseContent(message),
        role: "assistant",
        created: new Date(),
        parentId: message.id
      };

      // Add tool calls if configured
      if (this.mockConfig.toolCalls && this.mockConfig.toolCalls.length > 0) {
        fullResponse.tool_calls = this.mockConfig.toolCalls;
      }

      // Simulate streaming
      if (this.mockConfig.streaming) {
        // Emit content in chunks
        if (fullResponse.content) {
          const contentChunks = this.splitContentIntoChunks(
            fullResponse.content,
            3
          );

          for (let i = 0; i < contentChunks.length; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100));

            const chunk: LlmStreamChunk = {
              content: contentChunks[i] || "",
              isFinal: i === contentChunks.length - 1
            };

            // If we're simulating mixed tool calls, add tool calls to some content chunks
            if (
              this.mockConfig.simulateMixedToolCalls &&
              this.mockConfig.toolCalls &&
              i === 1
            ) {
              chunk.tool_calls = this.mockConfig.toolCalls.slice(0, 1);
            }

            eventEmitter.emit(LlmStreamEvent.DATA, chunk);
          }
        }

        // Emit tool calls in chunks if configured
        if (this.mockConfig.toolCalls && this.mockConfig.toolCalls.length > 0) {
          if (this.mockConfig.simulatePartialToolCalls) {
            // Emit partial tool calls
            for (const toolCall of this.mockConfig.toolCalls) {
              await new Promise((resolve) => setTimeout(resolve, 100));

              // For partial tool calls, split the arguments into chunks
              if (typeof toolCall.function.arguments === "object") {
                // Instead of trying to parse partial JSON, just emit the complete tool call
                // but in multiple chunks to simulate partial tool calls
                const chunk1: LlmStreamChunk = {
                  content: "",
                  tool_calls: [
                    {
                      function: {
                        name: toolCall.function.name,
                        arguments: { param1: "value1" }
                      }
                    }
                  ],
                  isFinal: false
                };

                eventEmitter.emit(LlmStreamEvent.DATA, chunk1);
                await new Promise((resolve) => setTimeout(resolve, 50));

                // Second chunk with just content, not a tool call
                // This simulates the LLM continuing after a partial tool call
                const chunk2: LlmStreamChunk = {
                  content: " (continuing after partial tool call)",
                  isFinal: false
                };

                eventEmitter.emit(LlmStreamEvent.DATA, chunk2);
              } else if (!this.mockConfig.simulateMixedToolCalls) {
                // If not mixed with content and not an object, emit as is
                const chunk: LlmStreamChunk = {
                  content: "",
                  tool_calls: [toolCall],
                  isFinal: false
                };

                eventEmitter.emit(LlmStreamEvent.DATA, chunk);
              }
            }
          } else if (!this.mockConfig.simulateMixedToolCalls) {
            // Emit all tool calls at once
            await new Promise((resolve) => setTimeout(resolve, 100));

            const chunk: LlmStreamChunk = {
              content: "",
              tool_calls: this.mockConfig.toolCalls,
              isFinal: false
            };

            eventEmitter.emit(LlmStreamEvent.DATA, chunk);
          }
        }

        // Emit a final chunk
        await new Promise((resolve) => setTimeout(resolve, 100));

        const finalChunk: LlmStreamChunk = {
          content: "",
          isFinal: true
        };

        eventEmitter.emit(LlmStreamEvent.DATA, finalChunk);
      } else {
        // Emit the entire response at once
        await new Promise((resolve) => setTimeout(resolve, 100));

        const chunk: LlmStreamChunk = {
          content: fullResponse.content,
          isFinal: true
        };

        if (this.mockConfig.toolCalls && this.mockConfig.toolCalls.length > 0) {
          chunk.tool_calls = this.mockConfig.toolCalls;
        }

        eventEmitter.emit(LlmStreamEvent.DATA, chunk);
      }

      // Emit the end event
      eventEmitter.emit(LlmStreamEvent.END, fullResponse);
    })().catch((error) => {
      eventEmitter.emit(LlmStreamEvent.ERROR, error);
    });

    return eventEmitter;
  }

  /**
   * Checks if the mock LLM supports function calling/tools
   * @returns A promise that resolves to the configured tool support status
   */
  override async checkToolSupport(): Promise<boolean> {
    return this.mockConfig.supportsTools || false;
  }

  /**
   * Checks if the mock LLM supports function calling/tools by making a direct API call
   * @returns A promise that resolves to the configured tool support status
   */
  protected override async checkToolSupportDirectly(): Promise<boolean> {
    return this.mockConfig.supportsTools || false;
  }

  /**
   * Gets the response content
   * @param message The message to respond to
   * @returns The response content
   */
  private getResponseContent(message: LlmMessage): string {
    if (this.mockConfig.content) {
      return this.mockConfig.content;
    }
    return `This is a mock response to: "${message.content}"`;
  }

  /**
   * Gets the tool calls as text for non-native tool support
   * @returns The tool calls as text
   */
  private getToolCallsAsText(): string {
    if (!this.mockConfig.toolCalls || this.mockConfig.toolCalls.length === 0) {
      return "";
    }

    let text = "";
    for (const toolCall of this.mockConfig.toolCalls) {
      const args =
        typeof toolCall.function.arguments === "string"
          ? toolCall.function.arguments
          : JSON.stringify(toolCall.function.arguments || {});

      text += `\n\n<json mcp-tool-use>
{
  "name": "${toolCall.function.name}",
  "arguments": ${args}
}
<json mcp-tool-use>\n\n`;
    }
    return text;
  }

  /**
   * Splits content into chunks for streaming
   * @param content The content to split
   * @param numChunks The number of chunks to split into
   * @returns The content chunks
   */
  private splitContentIntoChunks(content: string, numChunks: number): string[] {
    const chunkSize = Math.ceil(content.length / numChunks);
    const chunks: string[] = [];

    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, content.length);
      chunks.push(content.substring(start, end));
    }

    return chunks;
  }
}
