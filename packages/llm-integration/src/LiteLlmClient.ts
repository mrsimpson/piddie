import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmProviderConfig,
  LlmStreamChunk
} from "./types";
import { LlmStreamEvent } from "./types";
import { EventEmitter } from "@piddie/shared-types";
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

export class LiteLlmClient implements LlmClient {
  private config: LlmProviderConfig;

  constructor(config: LlmProviderConfig) {
    this.config = config;
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
        model:
          this.config.selectedModel ||
          this.config.model ||
          this.config.defaultModel,
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

    // Flag to track if we've had any successful chunks
    let hasReceivedAnyChunks = false;

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
              model:
                this.config.selectedModel ||
                this.config.model ||
                this.config.defaultModel,
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

              // Check if chunk and choices exist before accessing
              if (
                !chunk ||
                !chunk.choices ||
                !Array.isArray(chunk.choices) ||
                chunk.choices.length === 0
              ) {
                console.warn(
                  "Received malformed chunk from OpenAI API:",
                  jsonLine
                );
                continue;
              }

              const choice = chunk.choices[0];

              if (!choice || !choice.delta) continue;

              const deltaContent = choice.delta.content;

              if (
                deltaContent !== undefined &&
                deltaContent !== null &&
                deltaContent !== ""
              ) {
                response.content += deltaContent;
                const streamChunk: LlmStreamChunk = {
                  content: deltaContent,
                  isFinal: false
                };
                eventEmitter.emit(LlmStreamEvent.DATA, streamChunk);
                hasReceivedAnyChunks = true;
              }
            } catch (e) {
              console.error("Error parsing JSON from stream:", e, jsonLine);
              // Log the raw response for debugging
              console.error("Raw response that caused the error:", jsonLine);

              // Don't emit an error event here, just log it and continue processing
              // This allows the stream to continue even if one chunk is malformed
            }
          }
        }

        // Send a final chunk with isFinal=true
        const finalChunk: LlmStreamChunk = {
          content: response.content,
          isFinal: true
        };
        eventEmitter.emit(LlmStreamEvent.DATA, finalChunk);

        // Emit the end event when the stream is complete
        eventEmitter.emit(LlmStreamEvent.END, response);
      } catch (error) {
        console.error("Error streaming response:", error);

        // Check if the error is related to the LiteLLM proxy serialization issue
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("MockValSer") &&
          errorMessage.includes("SchemaSerializer")
        ) {
          console.warn(
            "Detected LiteLLM proxy serialization issue. This is likely a server-side configuration problem."
          );

          // If we haven't received any chunks yet, try falling back to non-streaming API
          if (!hasReceivedAnyChunks) {
            console.log("Attempting to fall back to non-streaming API...");
            try {
              // Try to use the non-streaming API as a fallback
              const fallbackResponse = await this.sendMessage(message);
              eventEmitter.emit(LlmStreamEvent.DATA, fallbackResponse);
              eventEmitter.emit(LlmStreamEvent.END, fallbackResponse);
              return;
            } catch (fallbackError) {
              console.error(
                "Fallback to non-streaming API also failed:",
                fallbackError
              );
            }
          }

          // Create a more user-friendly error
          const friendlyError = new Error(
            "The LLM service encountered a serialization error. This is likely a server-side configuration issue. " +
              "Please check your LLM provider settings or try again later."
          );

          eventEmitter.emit(LlmStreamEvent.ERROR, friendlyError);
        } else {
          // For other errors, just pass them through
          eventEmitter.emit(LlmStreamEvent.ERROR, error);
        }
      }
    };

    // Start the streaming process
    streamRequest();

    return eventEmitter;
  }

  /**
   * Converts an LlmMessage to an OpenAI message format
   * @param message The LlmMessage to convert
   * @returns The OpenAI message format
   */
  private convertToOpenAIMessage(
    message: LlmMessage
  ):
    | ChatCompletionUserMessageParam
    | ChatCompletionAssistantMessageParam
    | ChatCompletionSystemMessageParam {
    // Handle system prompt if present
    if (message.systemPrompt) {
      return {
        role: "system",
        content: message.systemPrompt
      };
    }

    // Handle regular message based on role
    if (message.role === "user") {
      return {
        role: "user",
        content: message.content
      };
    } else if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content
      };
    } else if (message.role === "system") {
      return {
        role: "system",
        content: message.content
      };
    }

    // Default to user if role is not recognized
    return {
      role: "user",
      content: message.content
    };
  }
}
