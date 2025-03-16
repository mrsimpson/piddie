import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { LlmStreamEvent } from "../src/types";
import { MessageStatus } from "@piddie/chat-management";
import type { LlmMessage, LlmProviderConfig } from "../src/types";
import { Orchestrator } from "../src/Orchestrator";
import { LiteLlmClient } from "../src/LiteLlmClient";

// Define mockChatManager before using it in mocks
let mockChatManager: any;

// Mock the chat-management module first
vi.mock("@piddie/chat-management", () => {
  return {
    getChatManager: vi.fn().mockImplementation(() => mockChatManager),
    MessageStatus: {
      SENDING: "sending",
      SENT: "sent",
      ERROR: "error"
    }
  };
});

// Mock the LiteLlmClient
vi.mock("../src/LiteLlmClient", () => {
  return {
    LiteLlmClient: vi.fn().mockImplementation(() => {
      return {
        sendMessage: vi.fn().mockResolvedValue({
          id: "response-id",
          content: "This is a response",
          model: "test-model"
        }),
        streamMessage: vi.fn().mockImplementation(() => {
          const emitter = new EventEmitter();

          // Simulate streaming response
          setTimeout(() => {
            emitter.emit(LlmStreamEvent.DATA, {
              id: "chunk-1",
              content: "This is ",
              model: "test-model"
            });

            emitter.emit(LlmStreamEvent.DATA, {
              id: "chunk-2",
              content: "a streaming ",
              model: "test-model"
            });

            emitter.emit(LlmStreamEvent.DATA, {
              id: "chunk-3",
              content: "response",
              model: "test-model"
            });

            emitter.emit(LlmStreamEvent.END, {
              id: "response-id",
              content: "This is a streaming response",
              model: "test-model"
            });
          }, 10);

          return emitter;
        })
      };
    })
  };
});

// Mock the EventEmitter from shared-types
vi.mock("@piddie/shared-types", () => {
  return {
    EventEmitter: vi.fn().mockImplementation(() => {
      return new EventEmitter();
    })
  };
});

describe("LLM Adapter", () => {
  let adapter: Orchestrator;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Create a fresh mock chat manager for each test
    mockChatManager = {
      createChat: vi.fn().mockResolvedValue({ id: "chat-id" }),
      addMessage: vi.fn().mockResolvedValue({ id: "message-id" }),
      getChat: vi.fn().mockResolvedValue({
        id: "chat-id",
        messages: []
      }),
      listChats: vi.fn().mockResolvedValue([]),
      updateMessageStatus: vi.fn().mockResolvedValue(true),
      deleteChat: vi.fn().mockResolvedValue(true),
      updateMessageContent: vi.fn().mockResolvedValue(true)
    };

    // Create adapter with mock client only (no chat manager)
    const config: LlmProviderConfig = {
      name: "Test Provider",
      description: "Test Provider Description",
      provider: "litellm",
      apiKey: "test-key",
      model: "test-model"
    };

    adapter = new Orchestrator(new LiteLlmClient(config), mockChatManager);

    adapter.registerLlmProvider(config);
  });

  describe("processMessage", () => {
    it("should process a message and return a response", async () => {
      const message: LlmMessage = {
        id: "message-id",
        chatId: "chat-id",
        content: "Hello, world!",
        role: "user",
        status: MessageStatus.SENDING,
        created: new Date(),
        provider: "litellm"
      };

      const response = await adapter.processMessage(message);

      // Verify the response
      expect(response).toEqual({
        id: "response-id",
        content: "This is a response",
        model: "test-model"
      });
    });

    it("should handle errors during message processing", async () => {
      // Mock client that throws an error when sendMessage is called
      const errorClient = {
        sendMessage: vi.fn().mockImplementation(() => {
          throw new Error("Test error");
        }),
        streamMessage: vi.fn(),
        checkToolSupport: vi.fn().mockResolvedValue(false)
      };

      const errorConfig = {
        name: "Error Provider",
        description: "Error Provider Description",
        provider: "litellm",
        apiKey: "test-key",
        model: "test-model"
      };

      const errorAdapter = new Orchestrator(errorClient, mockChatManager);
      errorAdapter.registerLlmProvider(errorConfig);

      const message: LlmMessage = {
        id: "message-id",
        chatId: "chat-id",
        content: "Hello, world!",
        role: "user",
        status: MessageStatus.SENDING,
        created: new Date(),
        provider: "litellm"
      };

      // Process message should throw
      let error: any;
      try {
        await errorAdapter.processMessage(message);
      } catch (e) {
        error = e;
      }

      // Verify error was thrown
      expect(error).toBeDefined();
      expect(error.message).toBe("Test error");

      // No longer verify updateMessageStatus was called
    });
  });

  describe("processMessageStream", () => {
    it("should stream a message and emit events", async () => {
      const message: LlmMessage = {
        id: "message-id",
        chatId: "chat-id",
        content: "Hello, world!",
        role: "user",
        status: MessageStatus.SENDING,
        created: new Date(),
        provider: "litellm"
      };

      const chunks: any[] = [];
      const onChunk = vi.fn((chunk) => {
        chunks.push(chunk);
      });

      const stream = await adapter.processMessageStream(message, onChunk);

      // Set up event handlers for testing
      const onData = vi.fn();
      const onEnd = vi.fn();
      const onError = vi.fn();

      // Use the stream as an EventEmitter
      stream.on(LlmStreamEvent.DATA, onData);
      stream.on(LlmStreamEvent.END, onEnd);
      stream.on(LlmStreamEvent.ERROR, onError);

      // Wait for streaming to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify events were emitted
      expect(onData).toHaveBeenCalledTimes(4);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      // Verify chunks were collected
      expect(chunks).toHaveLength(4);
      expect(chunks[0].content).toBe("This is ");
      expect(chunks[1].content).toBe("a streaming ");
      expect(chunks[2].content).toBe("response");
      expect(chunks[3].content).toBe("This is a streaming response");

      // No longer verify chat manager was called
    });

    it("should handle errors during streaming", async () => {
      // Mock client to throw an error
      const errorClient = {
        checkToolSupport: vi.fn().mockResolvedValue(false),
        sendMessage: vi.fn(),
        streamMessage: vi.fn().mockImplementation(() => {
          const emitter = new EventEmitter();

          // Simulate error
          setTimeout(() => {
            emitter.emit(LlmStreamEvent.ERROR, new Error("Stream error"));
          }, 10);

          return emitter;
        })
      };

      const errorAdapter = new Orchestrator(errorClient, mockChatManager);
      const errorConfig = {
        name: "Error Provider",
        description: "Error Provider Description",
        provider: "litellm",
        apiKey: "test-key",
        model: "test-model"
      };
      errorAdapter.registerLlmProvider(errorConfig);

      const message: LlmMessage = {
        id: "message-id",
        chatId: "chat-id",
        content: "Hello, world!",
        role: "user",
        status: MessageStatus.SENDING,
        created: new Date(),
        provider: "litellm"
      };

      const stream = await errorAdapter.processMessageStream(message);

      // Set up event handlers for testing
      const onError = vi.fn();

      // Use the stream as an EventEmitter
      stream.on(LlmStreamEvent.ERROR, onError);

      // Wait for error to be emitted
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify error was emitted
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBe("Stream error");

      // No longer verify error status was set
    });
  });
});
