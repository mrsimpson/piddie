import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiteLlmClient } from "../src/LiteLlmClient";
import { LlmMessage, LlmProviderConfig } from "../src/types";
import { MessageStatus } from "@piddie/chat-management";

// Mock the OpenAI module
vi.mock("openai", () => {
  return {
    default: function () {
      return {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              id: "mock-response-id",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: "text-davinci-003",
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "This is a mock response"
                  },
                  index: 0,
                  finish_reason: "stop"
                }
              ]
            })
          }
        }
      };
    }
  };
});

describe("LiteLlmClient", () => {
  const config: LlmProviderConfig = {
    name: "OpenAI",
    description: "OpenAI API for testing",
    apiKey: "test-api-key",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "text-davinci-003",
    model: "text-davinci-003",
    provider: "openai"
  };

  let client: LiteLlmClient;

  // Setup
  beforeEach(() => {
    vi.clearAllMocks();
    client = new LiteLlmClient(config);
  });

  // Clean up after tests
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should send a message and receive a response", async () => {
    const message: LlmMessage = {
      id: "1",
      chatId: "chat1",
      content: "Hello, world!",
      role: "user",
      status: MessageStatus.SENT,
      created: new Date(),
      provider: "litellm"
    };

    const response = await client.sendMessage(message);

    // Verify response properties
    expect(response).toHaveProperty("id", "mock-response-id");
    expect(response).toHaveProperty("chatId", "chat1");
    expect(response).toHaveProperty("content", "This is a mock response");
    expect(response).toHaveProperty("role", "assistant");
    expect(response).toHaveProperty("created");
    expect(response).toHaveProperty("parentId", message.id);
  });
});
