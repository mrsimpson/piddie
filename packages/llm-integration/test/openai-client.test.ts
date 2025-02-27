import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAiClient } from "../src/openai-client";
import { LlmMessage, LlmProviderConfig } from "../src/types";
import { MessageStatus } from "@piddie/chat-management";

describe("OpenAiClient", () => {
  const config: LlmProviderConfig = {
    apiKey: "test-api-key",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "text-davinci-003"
  };

  const client = new OpenAiClient(config);

  // Mock response data
  const mockResponseData = {
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
  };

  // Setup fetch mock
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponseData)
    });
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
      created: new Date()
    };

    const response = await client.sendMessage(message);

    // Verify fetch was called with correct parameters
    expect(fetch).toHaveBeenCalledWith(
      `${config.baseUrl}/chat/completions`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        })
      })
    );

    // Verify response properties
    expect(response).toHaveProperty("id", mockResponseData.id);
    expect(response).toHaveProperty("chatId", "chat1");
    expect(response).toHaveProperty("content", "This is a mock response");
    expect(response).toHaveProperty("role", "assistant");
    expect(response).toHaveProperty("created");
    expect(response).toHaveProperty("parentId", message.id);
  });
});
