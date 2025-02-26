import {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmProviderConfig,
  LlmStreamEvent
} from "./types";
import { EventEmitter } from "events";
import OpenAI from "openai";
import {
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam
} from "openai/resources/chat/completions";

export class OpenAiClient implements LlmClient {
  private config: LlmProviderConfig;
  private client: OpenAI;

  constructor(config: LlmProviderConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    });
  }

  /**
   * Sends a message to the LLM and receives a response
   * @param message The message to send
   * @returns A promise that resolves to the LLM response
   */
  async sendMessage(message: LlmMessage): Promise<LlmResponse> {
    // Convert LlmMessage to the appropriate OpenAI message type
    const openaiMessage = this.convertToOpenAIMessage(message);

    const response = await this.client.chat.completions.create({
      model: this.config.defaultModel,
      messages: [openaiMessage]
    });

    const choice = response.choices[0];
    if (!choice || !choice.message) {
      throw new Error("No response from OpenAI");
    }

    const responseData = choice.message;

    // Ensure content is a string, defaulting to empty string if undefined or null
    const content =
      responseData.content !== undefined && responseData.content !== null
        ? responseData.content
        : "";

    return {
      id: response.id,
      chatId: message.chatId,
      content: content,
      role: responseData.role,
      created: new Date(response.created * 1000), // Convert timestamp to Date
      parentId: message.id
    };
  }

  /**
   * Sends a message to the LLM and streams the response
   * @param message The message to send
   * @returns An event emitter that emits 'data', 'end', and 'error' events
   */
  streamMessage(message: LlmMessage): EventEmitter {
    const eventEmitter = new EventEmitter();

    // Create a new response object to build up as we receive chunks
    const response: LlmResponse = {
      id: crypto.randomUUID(),
      chatId: message.chatId,
      content: "",
      role: "assistant",
      created: new Date(),
      parentId: message.id
    };

    // Start the streaming request
    const streamRequest = async () => {
      try {
        // Convert LlmMessage to the appropriate OpenAI message type
        const openaiMessage = this.convertToOpenAIMessage(message);

        const stream = await this.client.chat.completions.create({
          model: this.config.defaultModel,
          messages: [openaiMessage],
          stream: true
        });

        // Process each chunk as it arrives
        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (!choice || !choice.delta) continue;

          const deltaContent = choice.delta.content;

          if (
            deltaContent !== undefined &&
            deltaContent !== null &&
            deltaContent !== ""
          ) {
            response.content += deltaContent;
            eventEmitter.emit(LlmStreamEvent.DATA, { ...response });
          }
        }

        // Emit the end event when the stream is complete
        eventEmitter.emit(LlmStreamEvent.END, response);
      } catch (error) {
        console.error("Error streaming response:", error);
        eventEmitter.emit(LlmStreamEvent.ERROR, error);
      }
    };

    // Start the streaming process
    streamRequest();

    return eventEmitter;
  }

  /**
   * Converts an LlmMessage to the appropriate OpenAI message type
   * @param message The LlmMessage to convert
   * @returns The appropriate OpenAI message type
   */
  private convertToOpenAIMessage(
    message: LlmMessage
  ):
    | ChatCompletionUserMessageParam
    | ChatCompletionAssistantMessageParam
    | ChatCompletionSystemMessageParam {
    switch (message.role) {
      case "user":
        return {
          role: "user",
          content: message.content
        };
      case "assistant":
        return {
          role: "assistant",
          content: message.content
        };
      case "system":
        return {
          role: "system",
          content: message.content
        };
      default:
        // Default to user if role is not recognized
        return {
          role: "user",
          content: message.content
        };
    }
  }
}
