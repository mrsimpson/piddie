import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmStreamChunk
} from "./types";
import { LlmStreamEvent } from "./types";
import { EventEmitter } from "@piddie/shared-types";

/**
 * A mock implementation of the LLM client for testing and development
 */
export class MockLlmClient implements LlmClient {
  /**
   * Sends a message to the mock LLM and receives a response
   * @param message The message to send
   * @returns A promise that resolves to the LLM response
   */
  async sendMessage(message: LlmMessage): Promise<LlmResponse> {
    // Simulate a delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Return a mock response
    return {
      id: crypto.randomUUID(),
      chatId: message.chatId,
      content: `This is a mock response to: "${message.content}"`,
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
  streamMessage(message: LlmMessage): EventEmitter {
    // Create an event emitter
    const eventEmitter = new EventEmitter();

    // Create a full response object that will be emitted with the END event
    const fullResponse: LlmResponse = {
      id: crypto.randomUUID(),
      chatId: message.chatId,
      content: `This is a mock response to: "${message.content}"`,
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

    return eventEmitter;
  }
}
