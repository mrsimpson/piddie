import { describe, it, expect } from "vitest";
import { OpenAiClient } from "../src/openai-client";
import { LlmMessage, LlmProviderConfig } from "../src/types";

describe("OpenAiClient", () => {
  const config: LlmProviderConfig = {
    apiKey: "test-api-key",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "text-davinci-003"
  };

  const client = new OpenAiClient(config);

  it("should send a message and receive a response", async () => {
    const message: LlmMessage = {
      id: "1",
      chatId: "chat1",
      content: "Hello, world!",
      role: "user",
      status: "sent",
      created: new Date()
    };

    const response = await client.sendMessage(message);

    expect(response).toHaveProperty("id");
    expect(response).toHaveProperty("chatId", "chat1");
    expect(response).toHaveProperty("content");
    expect(response).toHaveProperty("role", "assistant");
    expect(response).toHaveProperty("created");
  });
});
