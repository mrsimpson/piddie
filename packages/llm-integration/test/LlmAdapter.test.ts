import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { LlmStreamEvent } from "../src/types";
import { MessageStatus } from "@piddie/chat-management";
import type { LlmMessage, LlmStreamChunk } from "../src/types";
import { Orchestrator } from "../src/Orchestrator";
import { ActionsManager } from "@piddie/actions";

// Create helper functions for generating consistent mocks
const createMockActionsManager = () => {
  return {
    getAvailableTools: vi.fn().mockResolvedValue([]),
    registerServer: vi.fn().mockResolvedValue(undefined),
    getServer: vi.fn().mockReturnValue(undefined),
    unregisterServer: vi.fn().mockReturnValue(true),
    executeToolCall: vi.fn().mockResolvedValue({ result: "Tool result" }),
    mcpHost: "http://localhost:3000",
    servers: new Map(),
    initialized: true,
    toolsBuffer: null
  };
};

const createMockChatManager = () => {
  return {
    getChat: vi.fn().mockResolvedValue({ messages: [] }),
    updateMessageStatus: vi.fn().mockResolvedValue(true),
    deleteChat: vi.fn().mockResolvedValue(true),
    updateMessageContent: vi.fn().mockResolvedValue(true),
    updateMessageToolCalls: vi.fn().mockResolvedValue(true),
    createChat: vi.fn().mockResolvedValue({ id: "chat-id" }),
    addMessage: vi.fn().mockResolvedValue(true),
    listChats: vi.fn().mockResolvedValue([]),
    listProjectChats: vi.fn().mockResolvedValue([]),
    updateMessage: vi.fn().mockResolvedValue(true)
  };
};

/**
 * Creates a mock LLM client with configurable responses
 *
 * Note: The Orchestrator uses processMessageStream internally when processMessage
 * is called, so this mock ensures consistent responses between both methods.
 */
const createMockClient = (
  options: {
    supportTools?: boolean;
    responseId?: string;
    responseContent?: string;
    streamContent?: string | string[];
    errorMessage?: string;
    model?: string;
    chunkDelay?: number;
    endDelay?: number;
  } = {}
) => {
  const defaultOptions = {
    supportTools: false,
    responseId: "response-id",
    responseContent: "This is a response",
    // For streaming, can be a string or an array of string chunks
    streamContent: "This is a response",
    errorMessage: undefined,
    model: "test-model",
    // Delay between emitting chunks (ms)
    chunkDelay: 10,
    // Delay before emitting end event after all chunks (ms)
    endDelay: 20
  };

  const config = { ...defaultOptions, ...options };

  // Ensure response content and stream content are consistent if only one is specified
  if (options.responseContent && !options.streamContent) {
    config.streamContent = options.responseContent;
  } else if (options.streamContent && !options.responseContent) {
    config.responseContent = Array.isArray(options.streamContent)
      ? options.streamContent.join("")
      : options.streamContent;
  }

  return {
    checkToolSupport: vi.fn().mockResolvedValue(config.supportTools),

    // Regular message sending (not used by Orchestrator.processMessage directly)
    sendMessage: vi.fn().mockImplementation(() => {
      if (config.errorMessage) {
        return Promise.reject(new Error(config.errorMessage));
      }

      return Promise.resolve({
        id: config.responseId,
        content: config.responseContent,
        model: config.model
      });
    }),

    // Stream implementation (used by Orchestrator.processMessage internally)
    streamMessage: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter();

      // For error case, emit error and return early
      if (config.errorMessage) {
        setTimeout(() => {
          emitter.emit(LlmStreamEvent.ERROR, new Error(config.errorMessage));
        }, config.chunkDelay);
        return emitter;
      }

      // Schedule content chunks emission
      setTimeout(() => {
        // Emit content chunks
        const chunks = Array.isArray(config.streamContent)
          ? config.streamContent
          : [config.streamContent];

        // Track accumulated content for the END event
        let accumulatedContent = "";

        // Emit each chunk with delay
        chunks.forEach((content, index) => {
          setTimeout(
            () => {
              accumulatedContent += content;

              // Create a chunk object that matches the LlmStreamChunk interface
              const chunk = {
                id: `chunk-${index + 1}`,
                content: content,
                model: config.model,
                isFinal: false
              };

              // Emit data event with the chunk
              emitter.emit(LlmStreamEvent.DATA, chunk);
            },
            config.chunkDelay * (index + 1)
          );
        });

        // Emit the END event after all chunks
        setTimeout(
          () => {
            // Create the final response object
            const finalResponse = {
              id: config.responseId,
              content: accumulatedContent,
              model: config.model
            };

            // Emit end event with the complete response
            emitter.emit(LlmStreamEvent.END, finalResponse);
          },
          config.chunkDelay * (chunks.length + 1) + config.endDelay
        );
      }, 10);

      return emitter;
    })
  };
};

// Mock modules
vi.mock("@piddie/chat-management", () => {
  return {
    MessageStatus: {
      SENDING: "sending",
      SENT: "sent",
      ERROR: "error"
    }
  };
});

vi.mock("@piddie/shared-types", () => {
  return {
    EventEmitter: vi.fn().mockImplementation(() => {
      return new EventEmitter();
    })
  };
});

vi.mock("@piddie/actions", () => {
  return {
    ActionsManager: vi.fn().mockImplementation(() => createMockActionsManager())
  };
});

describe("LLM Adapter", () => {
  // Default configuration
  const defaultConfig = {
    name: "Test Provider",
    description: "Test Provider Description",
    provider: "litellm",
    apiKey: "test-key",
    model: "test-model"
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("processMessage", () => {
    it("should process a message and return a response", async () => {
      // Setup mocks with specific expected responses
      const mockChatManager = createMockChatManager();
      const mockActionsManager = vi.mocked(ActionsManager)();

      // Create a mock client with a consistent response content
      const expectedContent = "This is a successful response";
      const expectedId = "response-123";
      const client = createMockClient({
        responseContent: expectedContent,
        responseId: expectedId
      });

      // Create adapter with mocks
      const adapter = new Orchestrator(
        client,
        mockChatManager,
        mockActionsManager
      );
      adapter.registerLlmProvider(defaultConfig);

      // Create test message
      const message: LlmMessage = {
        id: "message-id",
        chatId: "chat-id",
        content: "Hello, world!",
        role: "user",
        status: MessageStatus.SENDING,
        created: new Date(),
        provider: "litellm"
      };

      // Process message
      const response = await adapter.processMessage(message);
      console.log("Response from processMessage:", response);

      // Verify the response matches what we expect
      expect(response).toMatchObject({
        content: expectedContent,
        id: expect.stringMatching(/^response-\d+$/),
        tool_calls: [],
        tool_results: {}
      });

      // Verify message update was called
      expect(mockChatManager.updateMessageStatus).toHaveBeenCalledWith(
        "chat-id",
        "message-id",
        MessageStatus.SENT
      );
    });

    it("should handle errors during message processing", async () => {
      // Setup mocks with error
      const mockChatManager = createMockChatManager();
      const mockActionsManager = vi.mocked(ActionsManager)();
      const errorClient = createMockClient({
        errorMessage: "Test error"
      });

      // Create adapter with mocks
      const adapter = new Orchestrator(
        errorClient,
        mockChatManager,
        mockActionsManager
      );
      adapter.registerLlmProvider(defaultConfig);

      // Create test message
      const message: LlmMessage = {
        id: "message-id",
        chatId: "chat-id",
        content: "Hello, world!",
        role: "user",
        status: MessageStatus.SENDING,
        created: new Date(),
        provider: "litellm"
      };

      // Process message
      let error: any;
      try {
        await adapter.processMessage(message);
      } catch (e) {
        error = e;
      }

      // Verify error was thrown
      expect(error).toBeDefined();
      expect(error.message).toBe("Test error");
    });
  });

  describe("processMessageStream", () => {
    it("should stream a message and emit events", async () => {
      // Setup client with multi-chunk response
      const client = createMockClient({
        streamContent: ["Part 1 ", "Part 2 ", "Part 3"]
      });

      // Create test message
      const message: LlmMessage = {
        id: "message-id",
        chatId: "chat-id",
        content: "Hello, world!",
        role: "user",
        status: MessageStatus.SENDING,
        created: new Date(),
        messages: [],
        provider: "litellm"
      };

      // Track emitted chunks
      const chunks: LlmStreamChunk[] = [];

      // Stream the message
      const emitter = client.streamMessage(message);

      // Set up event listeners
      emitter.on(LlmStreamEvent.DATA, (chunk: LlmStreamChunk) => {
        chunks.push(chunk);
      });

      // Wait for stream to complete
      await new Promise((resolve) => {
        emitter.on(LlmStreamEvent.END, resolve);
      });

      // Verify results
      expect(chunks.length).toBe(3);
      expect(chunks.map((c) => c.content).join("")).toBe(
        "Part 1 Part 2 Part 3"
      );
    });

    it("should handle errors during streaming", async () => {
      // Setup mocks
      const mockChatManager = createMockChatManager();
      const mockActionsManager = vi.mocked(ActionsManager)();

      // Create client with error
      const errorClient = createMockClient({
        streamContent: ["Partial content"],
        errorMessage: "Stream error"
      });

      // Create adapter with mocks
      const adapter = new Orchestrator(
        errorClient,
        mockChatManager,
        mockActionsManager
      );
      adapter.registerLlmProvider(defaultConfig);

      // Create test message
      const message: LlmMessage = {
        id: "message-id",
        chatId: "chat-id",
        content: "Hello, world!",
        role: "user",
        status: MessageStatus.SENDING,
        created: new Date(),
        provider: "litellm"
      };

      // Track results
      const chunks: LlmStreamChunk[] = [];
      let caughtError: any;

      // Process callback
      const onChunk = (chunk: LlmStreamChunk) => {
        chunks.push(chunk);
      };

      // Process message stream
      const resultEmitter = await adapter.processMessageStream(
        message,
        onChunk
      );

      // Set up error listener
      resultEmitter.on(LlmStreamEvent.ERROR, (error: any) => {
        caughtError = error;
      });

      // Wait for events to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify error was caught
      expect(caughtError).toBeDefined();
      expect(caughtError.message).toBe("Stream error");
    });
  });
});
