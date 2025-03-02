import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLlmAdapter, createMockLlmAdapter } from "../src";
import { Orchestrator } from "../src/Orchestrator";
import { LiteLlmClient } from "../src/LiteLlmClient";
import {
  LlmStreamEvent,
  type LlmMessage,
  type LlmProviderConfig
} from "../src/types";
import { MessageStatus } from "@piddie/chat-management";
import { EventEmitter } from "../src/EventEmitter";

// Mock the ChatManager
const mockChatManager = {
  getChat: vi.fn(),
  updateMessageStatus: vi.fn(),
  createChat: vi.fn(),
  addMessage: vi.fn(),
  listChats: vi.fn(),
  updateMessageContent: vi.fn(),
  deleteChat: vi.fn()
};

// Mock the OpenAI client
vi.mock("../src/openai-client", () => {
  return {
    LiteLlmClient: vi.fn().mockImplementation(() => ({
      sendMessage: vi.fn().mockResolvedValue({
        id: "response-id",
        chatId: "chat-id",
        content: "This is a response from the mocked OpenAI client",
        role: "assistant",
        created: new Date(),
        parentId: "message-id"
      }),
      streamMessage: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis()
      })
    }))
  };
});

// Mock the EventEmitter
vi.mock("../src/event-emitter", () => {
  return {
    EventEmitter: vi.fn().mockImplementation(() => ({
      on: vi.fn().mockReturnThis(),
      emit: vi.fn()
    }))
  };
});

describe("LLM Adapter", () => {
  let config: LlmProviderConfig;
  let message: LlmMessage;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup test data
    config = {
      name: "LiteLLM",
      description: "LiteLLM API",
      model: "gpt-3.5-turbo",
      apiKey: "test-api-key",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-3.5-turbo",
      provider: "litellm" as const
    };

    message = {
      id: "message-id",
      chatId: "chat-id",
      content: "Hello, world!",
      role: "user",
      status: MessageStatus.SENT,
      created: new Date(),
      provider: "litellm" as const
    };

    // Mock chat history
    mockChatManager.getChat.mockResolvedValue({
      id: "chat-id",
      messages: [
        {
          id: "previous-message-id",
          chatId: "chat-id",
          content: "Previous message",
          role: "user",
          status: MessageStatus.SENT,
          created: new Date(Date.now() - 1000),
          username: undefined,
          parentId: undefined
        }
      ],
      created: new Date(Date.now() - 2000),
      lastUpdated: new Date(Date.now() - 1000),
      metadata: undefined
    });
  });

  describe("Factory Functions", () => {
    it("should create an OpenAI adapter when provider is openai", () => {
      const adapter = createLlmAdapter(config);
      expect(adapter).toBeInstanceOf(Orchestrator);
      expect(LiteLlmClient).toHaveBeenCalledWith(config);
    });

    it("should create a mock adapter when provider is mock", () => {
      const mockConfig = { ...config, provider: "mock" as const };
      const adapter = createLlmAdapter(mockConfig);
      expect(adapter).toBeInstanceOf(Orchestrator);
      // LiteLlmClient should not be called
      expect(LiteLlmClient).not.toHaveBeenCalled();
    });

    it("should create a mock adapter with createMockLlmAdapter", () => {
      const adapter = createMockLlmAdapter();
      expect(adapter).toBeInstanceOf(Orchestrator);
      // LiteLlmClient should not be called
      expect(LiteLlmClient).not.toHaveBeenCalled();
    });
  });

  describe("Orchestrator", () => {
    let mockClient: any;
    let orchestrator: Orchestrator;

    beforeEach(() => {
      mockClient = {
        sendMessage: vi.fn().mockResolvedValue({
          id: "response-id",
          chatId: "chat-id",
          content: "This is a response",
          role: "assistant",
          created: new Date(),
          parentId: "message-id"
        }),
        streamMessage: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis()
        })
      };

      orchestrator = new Orchestrator(mockClient);
    });

    describe("processMessage", () => {
      it("should process a message and return a response", async () => {
        const response = await orchestrator.processMessage(message);

        // Verify chat history was retrieved
        expect(mockChatManager.getChat).toHaveBeenCalledWith(message.chatId);

        // Verify message was sent to client
        expect(mockClient.sendMessage).toHaveBeenCalled();

        // Verify message status was updated
        expect(mockChatManager.updateMessageStatus).toHaveBeenCalledWith(
          message.chatId,
          message.id,
          MessageStatus.SENT
        );

        // Verify response
        expect(response).toEqual({
          id: "response-id",
          chatId: "chat-id",
          content: "This is a response",
          role: "assistant",
          created: expect.any(Date),
          parentId: "message-id"
        });
      });

      it("should handle errors and update message status", async () => {
        const error = new Error("Test error");
        mockClient.sendMessage.mockRejectedValueOnce(error);

        await expect(orchestrator.processMessage(message)).rejects.toThrow(
          "Test error"
        );

        // Verify message status was updated to ERROR
        expect(mockChatManager.updateMessageStatus).toHaveBeenCalledWith(
          message.chatId,
          message.id,
          MessageStatus.ERROR
        );
      });
    });

    describe("processMessageStream", () => {
      it("should set up a stream and return an event emitter", async () => {
        const eventEmitter = await orchestrator.processMessageStream(
          message,
          vi.fn()
        );

        // Verify chat history was retrieved
        expect(mockChatManager.getChat).toHaveBeenCalledWith(message.chatId);

        // Verify stream was set up
        expect(mockClient.streamMessage).toHaveBeenCalled();

        // Verify event emitter was returned
        expect(eventEmitter).toBeDefined();
        expect(typeof eventEmitter.on).toBe("function");
      });

      it("should handle stream setup errors", async () => {
        const error = new Error("Stream setup error");
        mockClient.streamMessage.mockImplementationOnce(() => {
          throw error;
        });

        // Create a mock EventEmitter instance
        const mockEmitter = new EventEmitter();
        const emitSpy = vi.spyOn(mockEmitter, "emit");

        // Replace the mocked constructor to return our instance with the spy
        vi.mocked(EventEmitter).mockImplementationOnce(() => mockEmitter);

        // Call processMessageStream which should trigger the error
        await orchestrator.processMessageStream(message);

        // Verify message status was updated to ERROR
        expect(mockChatManager.updateMessageStatus).toHaveBeenCalledWith(
          message.chatId,
          message.id,
          MessageStatus.ERROR
        );

        // Verify error was emitted
        expect(emitSpy).toHaveBeenCalledWith(LlmStreamEvent.ERROR, error);
      });
    });
  });
});
