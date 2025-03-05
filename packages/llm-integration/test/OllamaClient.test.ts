import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaClient } from "../src/OllamaClient";
import type { LlmMessage, LlmProviderConfig } from "../src/types";
import { LlmStreamEvent } from "../src/types";
import type { MessageStatus } from "@piddie/chat-management";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OllamaClient", () => {
  let client: OllamaClient;
  let config: LlmProviderConfig;
  let message: LlmMessage;

  beforeEach(() => {
    // Reset mocks
    mockFetch.mockReset();
    // Setup test data
    config = {
      name: "Test Ollama",
      description: "Test Ollama Provider",
      apiKey: "test-api-key",
      model: "llama2",
      baseUrl: "http://localhost:11434",
      provider: "ollama"
    };

    message = {
      id: "test-message-id",
      chatId: "test-chat-id",
      content: "Hello, world!",
      role: "user",
      status: "sent" as MessageStatus,
      created: new Date(),
      provider: "ollama"
    };

    client = new OllamaClient(config);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("sendMessage", () => {
    it("should send a message and return a response", async () => {
      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "llama2",
          created_at: "2023-01-01T00:00:00Z",
          message: {
            role: "assistant",
            content: "Hello, I'm an AI assistant."
          },
          done: true
        })
      });

      const response = await client.sendMessage(message);

      // Check that fetch was called with the correct arguments
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama2",
            messages: [
              {
                role: "user",
                content: "Hello, world!"
              }
            ],
            options: {
              temperature: 0,
              top_p: 0.9
            }
          })
        }
      );

      // Check response structure
      expect(response).toEqual({
        id: expect.any(String),
        chatId: "test-chat-id",
        content: "Hello, I'm an AI assistant.",
        role: "assistant",
        created: expect.any(Date),
        parentId: "test-message-id",
        tool_calls: []
      });
    });

    it("should include system prompt if provided", async () => {
      // Add system prompt to message
      const messageWithSystem = {
        ...message,
        systemPrompt: "You are a helpful assistant."
      };

      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "llama2",
          created_at: "2023-01-01T00:00:00Z",
          message: {
            role: "assistant",
            content: "Hello, I'm a helpful assistant."
          },
          done: true
        })
      });

      await client.sendMessage(messageWithSystem);

      // Check that fetch was called with system prompt
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama2",
            messages: [
              {
                role: "system",
                content: "You are a helpful assistant."
              },
              {
                role: "user",
                content: "Hello, world!"
              }
            ],
            options: {
              temperature: 0,
              top_p: 0.9
            }
          })
        }
      );
    });

    it("should handle API errors", async () => {
      // Mock error response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ error: "Invalid model" })
      });

      // Expect the sendMessage call to throw an error
      await expect(client.sendMessage(message)).rejects.toThrow(
        'Ollama API error: 400 Bad Request - {"error":"Invalid model"}'
      );
    });
  });

  describe("streamMessage", () => {
    beforeEach(() => {
      // Mock crypto.randomUUID to return a consistent value for testing
      vi.spyOn(crypto, "randomUUID").mockReturnValue(
        "53d9d690-dc53-4efb-863f-3662346f8467"
      );
    });

    it("should stream a message and emit events", async () => {
      // Mock ReadableStream and reader
      const mockReader = {
        read: vi.fn()
      };

      // Setup mock responses for the reader
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            JSON.stringify({
              model: "llama2",
              created_at: "2023-01-01T00:00:00Z",
              message: {
                role: "assistant",
                content: "Hello, "
              },
              done: false
            }) + "\n"
          )
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            JSON.stringify({
              model: "llama2",
              created_at: "2023-01-01T00:00:00Z",
              message: {
                role: "assistant",
                content: "I'm an AI assistant."
              },
              done: true
            }) + "\n"
          )
        })
        .mockResolvedValueOnce({
          done: true,
          value: undefined
        });

      // Mock fetch response with readable stream
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => mockReader
        }
      });

      // Create event listeners
      const dataEvents: any[] = [];
      const endEvents: any[] = [];
      const errorEvents: any[] = [];

      // Get event emitter
      const emitter = client.streamMessage(message);

      // Add event listeners
      emitter.on(LlmStreamEvent.DATA, (data) => dataEvents.push(data));
      emitter.on(LlmStreamEvent.END, (data) => endEvents.push(data));
      emitter.on(LlmStreamEvent.ERROR, (error) => errorEvents.push(error));

      // Wait for all async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that fetch was called with the correct arguments
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama2",
            messages: [
              {
                role: "user",
                content: "Hello, world!"
              }
            ],
            stream: true,
            options: {
              temperature: 0,
              top_p: 0.9
            }
          })
        }
      );

      // Check events
      expect(dataEvents.length).toBe(2);
      expect(dataEvents[0]).toEqual({
        content: "Hello, ",
        isFinal: false
      });
      expect(dataEvents[1]).toEqual({
        content: "I'm an AI assistant.",
        isFinal: true
      });

      expect(endEvents.length).toBe(1);
      expect(endEvents[0]).toEqual({
        id: "53d9d690-dc53-4efb-863f-3662346f8467",
        chatId: "test-chat-id",
        content: "Hello, I'm an AI assistant.",
        role: "assistant",
        created: expect.any(Date),
        parentId: "test-message-id",
        tool_calls: []
      });

      expect(errorEvents.length).toBe(0);
    });

    it("should handle streaming errors", async () => {
      // Mock fetch to throw an error
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      // Create event listeners
      const dataEvents: any[] = [];
      const endEvents: any[] = [];
      const errorEvents: any[] = [];

      // Get event emitter
      const emitter = client.streamMessage(message);

      // Add event listeners
      emitter.on(LlmStreamEvent.DATA, (data) => dataEvents.push(data));
      emitter.on(LlmStreamEvent.END, (data) => endEvents.push(data));
      emitter.on(LlmStreamEvent.ERROR, (error) => errorEvents.push(error));

      // Wait for all async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check events
      expect(dataEvents.length).toBe(0);
      expect(endEvents.length).toBe(0);
      expect(errorEvents.length).toBe(1);
      expect(errorEvents[0].message).toBe("Network error");
    });
  });
});
