import { EventEmitter } from "@piddie/shared-types";
import { BaseLlmClient, ToolSupportStatus } from "./BaseLlmClient";
import type { LlmMessage, LlmResponse, LlmStreamChunk } from "./types";
import { LlmStreamEvent } from "./types";
import { v4 as uuidv4 } from "uuid";

/**
 * Mock LLM client for testing
 */
export class MockLlmClient extends BaseLlmClient {
  private mockResponse: LlmResponse | null = null;
  private mockStream: LlmStreamChunk[] | null = null;
  private mockDelay = 0;
  private toolSupport = ToolSupportStatus.NATIVE;

  /**
   * Sets the mock response for non-streaming calls
   * @param response The response to return
   */
  setMockResponse(response: LlmResponse): void {
    this.mockResponse = response;
  }

  /**
   * Sets the mock stream chunks for streaming calls
   * @param chunks The chunks to return in sequence
   */
  setMockStream(chunks: LlmStreamChunk[]): void {
    this.mockStream = chunks;
  }

  /**
   * Sets a delay for mock responses to simulate network latency
   * @param ms Delay in milliseconds
   */
  setMockDelay(ms: number): void {
    this.mockDelay = ms;
  }

  /**
   * Sets the mock tool support status
   * @param status The tool support status
   */
  setToolSupportStatus(status: ToolSupportStatus): void {
    this.toolSupport = status;
  }

  /**
   * Check if the provider supports function calling/tools
   * @returns Promise that resolves to true if supported, false otherwise
   */
  override async checkToolSupport(): Promise<boolean> {
    return this.toolSupport !== ToolSupportStatus.VIA_PROMPT;
  }

  /**
   * Process a message and return a response
   * @param message The message to process
   * @returns Promise that resolves to the response
   */
  override async sendMessage(message: LlmMessage): Promise<LlmResponse> {
    if (this.mockDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.mockDelay));
    }

    if (!this.mockResponse) {
      return {
        id: `mock-${uuidv4()}`,
        role: "assistant",
        created: new Date(),
        content: "This is a mock response",
        chatId: message.chatId,
        tool_calls: [],
        tool_results: {}
      };
    }

    return {
      ...this.mockResponse,
      chatId: message.chatId
    };
  }

  /**
   * Stream a message processing
   * @param message The message to process
   * @returns EventEmitter that emits chunks and completion
   */
  override streamMessage(): EventEmitter {
    const eventEmitter = new EventEmitter();

    // Use timeout to simulate async processing
    setTimeout(async () => {
      try {
        // If we have specific stream chunks, use those
        if (this.mockStream && this.mockStream.length > 0) {
          for (let i = 0; i < this.mockStream.length; i++) {
            const chunk = this.mockStream[i];

            // Add delay between chunks if specified
            if (this.mockDelay > 0) {
              await new Promise((resolve) =>
                setTimeout(resolve, this.mockDelay)
              );
            }

            // Emit each chunk
            eventEmitter.emit(LlmStreamEvent.DATA, chunk);
          }

          // Emit end with the final chunk content
          const finalChunk = this.mockStream[this.mockStream.length - 1];
          eventEmitter.emit(LlmStreamEvent.END, {
            id: `mock-${uuidv4()}`,
            role: "assistant",
            content: finalChunk.content,
            created: new Date(),
            tool_calls: finalChunk.tool_calls || []
          });
        } else {
          // Otherwise, generate a mock stream from mockResponse or defaults
          // First emit a content chunk
          const content =
            this.mockResponse?.content || "This is a mock response";
          eventEmitter.emit(LlmStreamEvent.DATA, {
            content,
            isFinal: false
          });

          // If there are tool calls in the mock response, emit them
          if (
            this.mockResponse?.tool_calls &&
            this.mockResponse.tool_calls.length > 0
          ) {
            // Add delay for tool calls if specified
            if (this.mockDelay > 0) {
              await new Promise((resolve) =>
                setTimeout(resolve, this.mockDelay)
              );
            }

            eventEmitter.emit(LlmStreamEvent.DATA, {
              content: "",
              tool_calls: this.mockResponse.tool_calls,
              isFinal: false
            });
          }

          // Emit end event with the full response
          eventEmitter.emit(
            LlmStreamEvent.END,
            this.mockResponse || {
              id: `mock-${uuidv4()}`,
              role: "assistant",
              content,
              created: new Date(),
              tool_calls: this.mockResponse!.tool_calls || []
            }
          );
        }
      } catch (error) {
        eventEmitter.emit(LlmStreamEvent.ERROR, error);
      }
    }, 0);

    return eventEmitter;
  }
}
