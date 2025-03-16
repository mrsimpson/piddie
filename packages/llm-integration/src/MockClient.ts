import type {
  LlmMessage,
  LlmResponse,
  LlmStreamChunk,
  LlmProviderConfig
} from "./types";
import { LlmStreamEvent } from "./types";
import { EventEmitter } from "@piddie/shared-types";
import { BaseLlmClient, ToolSupportStatus } from "./BaseLlmClient";
import { v4 as uuidv4 } from "uuid";

/**
 * A mock implementation of the LLM client for testing and development
 */
export class MockLlmClient extends BaseLlmClient {
  /**
   * Creates a new MockLlmClient
   * @param config The LLM provider configuration
   */
  constructor() {
    super({} as LlmProviderConfig);
    this.toolSupportStatus = ToolSupportStatus.VIA_PROMPT;
  }

  /**
   * Sends a message to the mock LLM and receives a response
   * @param message The message to send
   * @returns A promise that resolves to the LLM response
   */
  override async sendMessage(message: LlmMessage): Promise<LlmResponse> {
    // Enhance message with tool instructions if needed
    // const { message: enhancedMessage } = await this.addProvidedTools(message);

    // Simulate a delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Return a mock response
    return {
      id: uuidv4(),
      chatId: message.chatId,
      content: this.getMessageContent(message),
      role: "assistant",
      created: new Date(),
      parentId: message.id
    };
  }

  /**
   * Sends a message to the mock LLM and streams the response
   * @param message The message to send
   * @returns An event emitter that emits 'data', 'end', and 'error' events
   */
  override streamMessage(message: LlmMessage): EventEmitter {
    // Create an event emitter
    const eventEmitter = new EventEmitter();

    // Process the message asynchronously
    (async () => {
      // Enhance message with tool instructions if needed
      // const enhancedMessage = await this.addProvidedTools(message);

      // Create a full response object that will be emitted with the END event
      const fullResponse: LlmResponse = {
        id: uuidv4(),
        chatId: message.chatId,
        content: this.getMessageContent(message),
        role: "assistant",
        created: new Date(),
        parentId: message.id
      };

      // Simulate streaming with a delay
      setTimeout(() => {
        // Emit the data event with the content
        const chunk: LlmStreamChunk = {
          content: fullResponse.content,
          isFinal: true
        };
        eventEmitter.emit(LlmStreamEvent.DATA, chunk);

        // Emit the end event after a short delay to simulate streaming completion
        setTimeout(() => {
          eventEmitter.emit(LlmStreamEvent.END, fullResponse);
        }, 500);
      }, 1000);
    })().catch((error) => {
      eventEmitter.emit(LlmStreamEvent.ERROR, error);
    });

    return eventEmitter;
  }

  /**
   * Creates a messages that pictures what's been sent to the llm
   * @param message The message to get the content from
   * @returns The content of the message
   */
  private getMessageContent(message: LlmMessage): string {
    const messageBody = `This is a mock response to: "${message.content}"`;
    return messageBody;
  }

  /**
   * Checks if the mock LLM supports function calling/tools
   * @returns A promise that resolves to false since the mock client doesn't support tools
   */
  override async checkToolSupport(): Promise<boolean> {
    // Mock client doesn't support tools by default
    return false;
  }

  /**
   * Checks if the mock LLM supports function calling/tools by making a direct API call
   * @returns A promise that resolves to false since the mock client doesn't support tools
   */
  protected override async checkToolSupportDirectly(): Promise<boolean> {
    // Mock client doesn't support tools
    return false;
  }
}
