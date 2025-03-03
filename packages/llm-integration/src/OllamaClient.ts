import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmProviderConfig,
  LlmStreamChunk
} from "./types";
import { LlmStreamEvent } from "./types";
import { EventEmitter } from "@piddie/shared-types";
import type { ChatCompletionRole } from "openai/resources/chat";

// Define interfaces for Ollama API requests and responses
interface OllamaCompletionRequest {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    stop?: string[];
  };
}

interface OllamaCompletionResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

/**
 * Client implementation for the Ollama API
 */
export class OllamaClient implements LlmClient {
  private config: LlmProviderConfig;

  /**
   * Creates a new Ollama client
   * @param config The LLM provider configuration
   */
  constructor(config: LlmProviderConfig) {
    this.config = config;
  }

  /**
   * Sends a message to the Ollama API and receives a response
   * @param message The message to send
   * @returns A promise that resolves to the LLM response
   */
  async sendMessage(message: LlmMessage): Promise<LlmResponse> {
    // Prepare the request payload
    const payload: OllamaCompletionRequest = {
      model:
        this.config.selectedModel ||
        this.config.model ||
        this.config.defaultModel ||
        "llama2",
      prompt: message.content,
      options: {
        temperature: 0.7,
        top_p: 0.9
      }
    };

    // Add system prompt if present
    if (message.systemPrompt) {
      payload.system = message.systemPrompt;
    }

    // Use fetch API to send the request
    const response = await fetch(
      `${this.config.baseUrl || "http://localhost:11434"}/api/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
      );
    }

    const data = (await response.json()) as OllamaCompletionResponse;

    // Create and return the LLM response
    return {
      id: crypto.randomUUID(), // Ollama doesn't provide an ID, so we generate one
      chatId: message.chatId,
      content: data.response,
      role: "assistant" as ChatCompletionRole,
      created: new Date(), // Ollama provides created_at but it's a string, so we use current time
      parentId: message.id
    };
  }

  /**
   * Sends a message to the Ollama API and streams the response
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
        // Prepare the request payload
        const payload: OllamaCompletionRequest = {
          model:
            this.config.selectedModel ||
            this.config.model ||
            this.config.defaultModel ||
            "llama2",
          prompt: message.content,
          stream: true,
          options: {
            temperature: 0.7,
            top_p: 0.9
          }
        };

        // Add system prompt if present
        if (message.systemPrompt) {
          payload.system = message.systemPrompt;
        }

        // Use fetch API with streaming
        const fetchResponse = await fetch(
          `${this.config.baseUrl || "http://localhost:11434"}/api/generate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          }
        );

        if (!fetchResponse.ok) {
          const errorData = await fetchResponse.json().catch(() => ({}));
          throw new Error(
            `Ollama API error: ${fetchResponse.status} ${fetchResponse.statusText} - ${JSON.stringify(errorData)}`
          );
        }

        if (!fetchResponse.body) {
          throw new Error("Response body is null");
        }

        // Create a reader from the response body stream
        const reader = fetchResponse.body.getReader();
        const decoder = new TextDecoder("utf-8");

        // Process the stream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Decode the chunk
          const chunk = decoder.decode(value);

          // Ollama returns each chunk as a JSON object
          // Split by newlines in case multiple chunks are received
          const lines = chunk.split("\n").filter((line) => line.trim() !== "");

          for (const line of lines) {
            try {
              const data = JSON.parse(line) as OllamaCompletionResponse;

              // Add the response text to our accumulated response
              if (data.response) {
                response.content += data.response;

                // Emit a data event with the chunk
                const streamChunk: LlmStreamChunk = {
                  content: data.response,
                  isFinal: data.done
                };

                eventEmitter.emit(LlmStreamEvent.DATA, streamChunk);

                // If this is the final chunk, emit the end event
                if (data.done) {
                  eventEmitter.emit(LlmStreamEvent.END, response);
                  return;
                }
              }
            } catch (e) {
              console.error("Error parsing JSON from stream:", e, line);
              // Continue processing other chunks
            }
          }
        }

        // If we get here, the stream ended without a done: true message
        // Emit a final chunk and end event
        const finalChunk: LlmStreamChunk = {
          content: response.content,
          isFinal: true
        };
        eventEmitter.emit(LlmStreamEvent.DATA, finalChunk);
        eventEmitter.emit(LlmStreamEvent.END, response);
      } catch (error) {
        console.error("Error streaming response from Ollama:", error);
        eventEmitter.emit(LlmStreamEvent.ERROR, error);
      }
    };

    // Start the streaming process
    streamRequest();

    return eventEmitter;
  }
}
