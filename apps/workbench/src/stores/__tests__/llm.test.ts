import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useLlmStore } from "../llm";
import { useChatStore } from "../chat";
import { MessageStatus } from "@piddie/chat-management";
import settingsManager from "../settings-db";
import { createLlmAdapter, LlmStreamEvent } from "@piddie/llm-integration";
import { EventEmitter } from "@piddie/llm-integration/src/event-emitter";
import type { ModelInfo, LlmProviderConfig } from "../settings-db";

// Mock dependencies
vi.mock("../chat", () => ({
  useChatStore: vi.fn()
}));

vi.mock("../settings-db", () => {
  return {
    default: {
      getSettings: vi.fn(),
      updateLlmConfig: vi.fn(),
      resetLlmConfig: vi.fn(),
      verifyConnection: vi.fn()
    }
  };
});

vi.mock("@piddie/llm-integration", () => {
  const EventEmitter = vi.fn().mockImplementation(() => ({
    on: vi.fn().mockReturnThis(),
    emit: vi.fn()
  }));

  return {
    createLlmAdapter: vi.fn(),
    LlmStreamEvent: {
      DATA: "data",
      END: "end",
      ERROR: "error"
    },
    EventEmitter
  };
});

describe("LLM Store", () => {
  // Mock chat store
  const mockChatManager = {
    getChat: vi.fn(),
    updateMessageStatus: vi.fn(),
    createChat: vi.fn(),
    addMessage: vi.fn(),
    listChats: vi.fn(),
    updateMessageContent: vi.fn(),
    deleteChat: vi.fn()
  };

  const mockChatStore = {
    chatManager: mockChatManager,
    createChat: vi.fn(),
    addMessage: vi.fn(),
    updateMessageContent: vi.fn(),
    updateMessageStatus: vi.fn()
  };

  // Mock LLM adapter
  const mockLlmAdapter = {
    processMessage: vi.fn(),
    processMessageStream: vi.fn()
  };

  // Mock event emitter for streaming
  const mockEventEmitter = new EventEmitter();

  beforeEach(() => {
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());

    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock chat store
    (useChatStore as any).mockReturnValue(mockChatStore);

    // Setup mock settings manager
    (settingsManager.getSettings as any).mockResolvedValue({
      llmConfig: {
        apiKey: "test-api-key",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-3.5-turbo",
        provider: "openai",
        availableModels: [
          { id: "gpt-3.5-turbo", name: "GPT 3.5 Turbo" },
          { id: "gpt-4", name: "GPT 4" }
        ]
      }
    });

    // Setup mock LLM adapter
    (createLlmAdapter as any).mockReturnValue(mockLlmAdapter);

    // Setup mock response for processMessage
    mockLlmAdapter.processMessage.mockResolvedValue({
      id: "response-id",
      chatId: "chat-id",
      content: "This is a response",
      role: "assistant",
      created: new Date(),
      parentId: "message-id"
    });

    // Setup mock response for processMessageStream
    mockLlmAdapter.processMessageStream.mockResolvedValue(mockEventEmitter);

    // Setup mock chat store responses
    mockChatStore.createChat.mockResolvedValue({
      id: "chat-id",
      messages: [],
      created: new Date(),
      lastUpdated: new Date(),
      metadata: undefined
    });

    mockChatStore.addMessage.mockImplementation(
      (chatId, content, role, parentId, username, status) => {
        return Promise.resolve({
          id: role === "user" ? "message-id" : "assistant-message-id",
          chatId,
          content,
          role,
          status: status || MessageStatus.SENT,
          created: new Date(),
          username,
          parentId
        });
      }
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Initialization", () => {
    it("should initialize with default values", () => {
      const store = useLlmStore();

      expect(store.isStreaming).toBe(false);
      expect(store.isProcessing).toBe(false);
      expect(store.streamingMessageId).toBe(null);
      expect(store.error).toBe(null);
      expect(store.isLoading).toBe(true);
      expect(store.isVerifying).toBe(false);
      expect(store.connectionStatus).toBe("none");
      expect(store.availableModels).toEqual([]);

      // Default config values
      expect(store.config).toEqual({
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-3.5-turbo",
        provider: "openai"
      });
    });

    it("should load settings on mount", async () => {
      const store = useLlmStore();

      // Trigger onMounted callback manually
      // This is a workaround since we can't easily test onMounted in Vitest
      await vi.runAllTimersAsync();

      // Verify settings were loaded
      expect(settingsManager.getSettings).toHaveBeenCalled();

      // Wait for the async operation to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Verify store was updated with settings
      expect(store.config.apiKey).toBe("test-api-key");
      expect(store.availableModels).toEqual([
        { id: "gpt-3.5-turbo", name: "GPT 3.5 Turbo" },
        { id: "gpt-4", name: "GPT 4" }
      ]);

      // Verify adapter was created with the loaded config
      expect(createLlmAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "test-api-key",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-3.5-turbo",
          provider: "openai"
        }),
        mockChatManager
      );
    });
  });

  describe("Configuration Management", () => {
    it("should verify connection successfully", async () => {
      const store = useLlmStore();

      // Mock successful verification
      const mockModels: ModelInfo[] = [
        { id: "gpt-3.5-turbo", name: "GPT 3.5 Turbo" },
        { id: "gpt-4", name: "GPT 4" }
      ];
      vi.mocked(settingsManager.verifyConnection).mockResolvedValue(mockModels);

      const result = await store.verifyConnection();

      expect(result).toBe(true);
      expect(store.connectionStatus).toBe("success");
      expect(store.availableModels).toEqual(mockModels);
      expect(store.error).toBe(null);
    });

    it("should handle verification errors", async () => {
      const store = useLlmStore();

      // Mock failed verification
      const error = new Error("API key invalid");
      vi.mocked(settingsManager.verifyConnection).mockRejectedValue(error);

      const result = await store.verifyConnection();

      expect(result).toBe(false);
      expect(store.connectionStatus).toBe("error");
      expect(store.error).toBe(error);
    });

    it("should update configuration", async () => {
      const store = useLlmStore();

      // Mock successful update
      const updatedConfig: LlmProviderConfig = {
        apiKey: "new-api-key",
        baseUrl: "https://new-api-url.com/v1",
        defaultModel: "gpt-4",
        provider: "openai"
      };

      vi.mocked(settingsManager.updateLlmConfig).mockResolvedValue(
        updatedConfig
      );

      const result = await store.updateConfig({
        apiKey: "new-api-key",
        baseUrl: "https://new-api-url.com/v1",
        defaultModel: "gpt-4"
      });

      expect(result).toBe(true);
      expect(settingsManager.updateLlmConfig).toHaveBeenCalledWith({
        apiKey: "new-api-key",
        baseUrl: "https://new-api-url.com/v1",
        defaultModel: "gpt-4"
      });

      // Verify config was updated
      expect(store.config.apiKey).toBe("new-api-key");
      expect(store.config.baseUrl).toBe("https://new-api-url.com/v1");
      expect(store.config.defaultModel).toBe("gpt-4");

      // Verify adapter was recreated
      expect(createLlmAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "new-api-key",
          baseUrl: "https://new-api-url.com/v1",
          defaultModel: "gpt-4"
        }),
        mockChatManager
      );
    });

    it("should reset configuration", async () => {
      const store = useLlmStore();

      // Set some non-default values first
      store.config.apiKey = "custom-key";
      store.config.defaultModel = "custom-model";

      // Mock successful reset
      const defaultConfig: LlmProviderConfig = {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-3.5-turbo",
        provider: "openai"
      };

      vi.mocked(settingsManager.resetLlmConfig).mockResolvedValue(
        defaultConfig
      );

      const result = await store.resetConfig();

      expect(result).toBe(true);
      expect(settingsManager.resetLlmConfig).toHaveBeenCalled();

      // Verify config was reset
      expect(store.config).toEqual(defaultConfig);

      // Verify adapter was recreated
      expect(createLlmAdapter).toHaveBeenCalledWith(
        expect.objectContaining(defaultConfig),
        mockChatManager
      );
    });
  });

  describe("Message Processing", () => {
    it("should send a message without streaming", async () => {
      const store = useLlmStore();

      // Set a valid API key
      store.config.apiKey = "valid-api-key";

      await store.sendMessage("Hello, world!", "chat-id", false);

      // Verify user message was added
      expect(mockChatStore.addMessage).toHaveBeenCalledWith(
        "chat-id",
        "Hello, world!",
        "user",
        undefined,
        undefined,
        undefined
      );

      // Verify assistant message placeholder was added
      expect(mockChatStore.addMessage).toHaveBeenCalledWith(
        "chat-id",
        "",
        "assistant",
        "message-id",
        "gpt-3.5-turbo",
        MessageStatus.SENDING
      );

      // Verify message was processed
      expect(mockLlmAdapter.processMessage).toHaveBeenCalledWith({
        id: "message-id",
        chatId: "chat-id",
        content: "Hello, world!",
        role: "user",
        status: MessageStatus.SENT,
        created: expect.any(Date),
        parentId: undefined
      });

      // Verify assistant message was updated with response
      expect(mockChatStore.updateMessageContent).toHaveBeenCalledWith(
        "assistant-message-id",
        "This is a response"
      );

      // Verify state was reset
      expect(store.isProcessing).toBe(false);
      expect(store.isStreaming).toBe(false);
      expect(store.streamingMessageId).toBe(null);
    });

    it("should send a message with streaming", async () => {
      const store = useLlmStore();

      // Set a valid API key
      store.config.apiKey = "valid-api-key";

      // Setup event emitter behavior
      let dataCallback: any;
      let endCallback: any;
      let errorCallback: any;

      mockEventEmitter.on = vi.fn().mockImplementation((event, callback) => {
        if (event === LlmStreamEvent.DATA) dataCallback = callback;
        if (event === LlmStreamEvent.END) endCallback = callback;
        if (event === LlmStreamEvent.ERROR) errorCallback = callback;
        return mockEventEmitter;
      });

      // Start sending the message
      const sendPromise = store.sendMessage("Hello, world!", "chat-id", true);

      // Verify stream was set up
      expect(mockLlmAdapter.processMessageStream).toHaveBeenCalled();
      expect(mockEventEmitter.on).toHaveBeenCalledWith(
        LlmStreamEvent.DATA,
        expect.any(Function)
      );
      expect(mockEventEmitter.on).toHaveBeenCalledWith(
        LlmStreamEvent.END,
        expect.any(Function)
      );
      expect(mockEventEmitter.on).toHaveBeenCalledWith(
        LlmStreamEvent.ERROR,
        expect.any(Function)
      );

      // Simulate receiving data
      dataCallback({ content: "Streaming response" });

      // Verify content was updated
      expect(mockChatStore.updateMessageContent).toHaveBeenCalledWith(
        "assistant-message-id",
        "Streaming response"
      );

      // Simulate stream end
      endCallback();

      // Wait for the promise to resolve
      await sendPromise;

      // Verify state was reset
      expect(store.isProcessing).toBe(false);
      expect(store.isStreaming).toBe(false);
      expect(store.streamingMessageId).toBe(null);
    });

    it("should handle streaming errors", async () => {
      const store = useLlmStore();

      // Set a valid API key
      store.config.apiKey = "valid-api-key";

      // Setup event emitter behavior
      let errorCallback: any;

      mockEventEmitter.on = vi.fn().mockImplementation((event, callback) => {
        if (event === LlmStreamEvent.ERROR) errorCallback = callback;
        return mockEventEmitter;
      });

      // Start sending the message
      const sendPromise = store.sendMessage("Hello, world!", "chat-id", true);

      // Simulate an error
      const error = new Error("Stream error");
      errorCallback(error);

      // Wait for the promise to resolve
      await sendPromise;

      // Verify error was captured
      expect(store.error).toBe(error);

      // Verify state was reset
      expect(store.isProcessing).toBe(false);
      expect(store.isStreaming).toBe(false);
      expect(store.streamingMessageId).toBe(null);
    });

    it("should create a new chat if chatId is not provided", async () => {
      const store = useLlmStore();

      // Set a valid API key
      store.config.apiKey = "valid-api-key";

      await store.sendMessage("Hello, world!");

      // Verify chat was created
      expect(mockChatStore.createChat).toHaveBeenCalled();

      // Verify message was added to the new chat
      expect(mockChatStore.addMessage).toHaveBeenCalledWith(
        "chat-id", // ID from the mock chat
        "Hello, world!",
        "user",
        undefined,
        undefined,
        undefined
      );
    });

    it("should throw an error if API key is not set", async () => {
      const store = useLlmStore();

      // Ensure API key is empty
      store.config.apiKey = "";

      await expect(store.sendMessage("Hello, world!")).rejects.toThrow(
        "API key is not set. Please configure your LLM settings."
      );

      // Verify no messages were sent
      expect(mockLlmAdapter.processMessage).not.toHaveBeenCalled();
      expect(mockLlmAdapter.processMessageStream).not.toHaveBeenCalled();
    });

    it("should not require API key for mock provider", async () => {
      const store = useLlmStore();

      // Set empty API key but mock provider
      store.config.apiKey = "";
      store.config.provider = "mock";

      await store.sendMessage("Hello, world!");

      // Verify message was processed despite empty API key
      expect(mockLlmAdapter.processMessageStream).toHaveBeenCalled();
    });
  });

  describe("Streaming Control", () => {
    it("should cancel streaming", async () => {
      const store = useLlmStore();

      // Set streaming state
      store.isStreaming = true;
      store.isProcessing = true;
      store.streamingMessageId = "message-id";

      // Cancel streaming
      store.cancelStreaming();

      // Verify state was reset
      expect(store.isStreaming).toBe(false);
      expect(store.isProcessing).toBe(false);
      expect(store.streamingMessageId).toBe(null);
    });

    it("should do nothing if not streaming", async () => {
      const store = useLlmStore();

      // Ensure not streaming
      store.isStreaming = false;
      store.isProcessing = false;
      store.streamingMessageId = null;

      // Try to cancel streaming
      store.cancelStreaming();

      // Verify state remains unchanged
      expect(store.isStreaming).toBe(false);
      expect(store.isProcessing).toBe(false);
      expect(store.streamingMessageId).toBe(null);
    });
  });
});
