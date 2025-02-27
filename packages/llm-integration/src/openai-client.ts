import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmProviderConfig
} from "./types";
import { LlmStreamEvent } from "./types";
import { EventEmitter } from "./event-emitter";
// Remove direct OpenAI import
// import OpenAI from "openai";
// Keep the type imports for compatibility
import type {
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam
} from "openai/resources/chat/completions";
import type { ChatCompletionRole } from "openai/resources/chat";

// Define interfaces for OpenAI API responses
interface OpenAICompletionChoice {
  message: {
    role: ChatCompletionRole;
    content: string | null;
  };
  index: number;
  finish_reason: string;
}

interface OpenAICompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAICompletionChoice[];
}

interface OpenAIStreamChoice {
  delta: {
    content?: string;
    role?: ChatCompletionRole;
  };
  index: number;
  finish_reason: string | null;
}

interface OpenAIStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
}

export class OpenAiClient implements LlmClient {
  private config: LlmProviderConfig;
  // Remove the OpenAI client instance
  // private client: OpenAI;

  constructor(config: LlmProviderConfig) {
    this.config = config;
    // Remove OpenAI client instantiation
    // this.client = new OpenAI({
    //   apiKey: config.apiKey,
    //   baseURL: config.baseUrl
    // });
  }

  /**
   * Sends a message to the LLM and receives a response
   * @param message The message to send
   * @returns A promise that resolves to the LLM response
   */
  async sendMessage(message: LlmMessage): Promise<LlmResponse> {
    // Convert LlmMessage to the appropriate OpenAI message type
    const openaiMessage = this.convertToOpenAIMessage(message);

    // Use fetch API instead of OpenAI client
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.defaultModel,
        messages: [openaiMessage]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
      );
    }

    const data = (await response.json()) as OpenAICompletionResponse;
    const choice = data.choices[0];

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
      id: data.id,
      chatId: message.chatId,
      content: content,
      role: responseData.role,
      created: new Date(data.created * 1000), // Convert timestamp to Date
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

        // Use fetch API with streaming
        const fetchResponse = await fetch(
          `${this.config.baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify({
              model: this.config.defaultModel,
              messages: [openaiMessage],
              stream: true
            })
          }
        );

        if (!fetchResponse.ok) {
          const errorData = await fetchResponse.json().catch(() => ({}));
          throw new Error(
            `OpenAI API error: ${fetchResponse.status} ${fetchResponse.statusText} - ${JSON.stringify(errorData)}`
          );
        }

        if (!fetchResponse.body) {
          throw new Error("Response body is null");
        }

        // Create a reader from the response body stream
        const reader = fetchResponse.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        // Process the stream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Decode the chunk and add it to the buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines in the buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep the last incomplete line in the buffer

          for (const line of lines) {
            if (line.trim() === "") continue;
            if (line.trim() === "data: [DONE]") continue;

            // Remove the "data: " prefix
            const jsonLine = line.replace(/^data: /, "").trim();
            if (!jsonLine) continue;

            try {
              const chunk = JSON.parse(jsonLine) as OpenAIStreamResponse;
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
            } catch (e) {
              console.error("Error parsing JSON from stream:", e, jsonLine);
            }
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
