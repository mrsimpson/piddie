import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ChatManager } from "@piddie/chat-management";
import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam
} from "openai/resources/chat/completions";
import type { LLMClientConfig } from "./types/client.js";
import { Stream } from "openai/streaming.mjs";

/**
 * Client for making LLM requests with chat history
 */
export class LLMClient {
  private mcpClient: McpClient;
  private transport: StdioClientTransport;
  private openai: OpenAI;

  /**
   * Create a new LLM client
   * @param chatManager - Manager for chat history
   * @param config - Client configuration
   */
  constructor(
    private chatManager: ChatManager,
    private config: LLMClientConfig
  ) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    });

    // this.transport = new StdioClientTransport({
    //   command: "node",
    //   args: [config.mcpServerPath]
    // });

    this.mcpClient = new McpClient(
      {
        name: "llm-client",
        version: "1.0.0"
      },
      {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {}
        }
      }
    );
  }

  /**
   * Connect to the MCP server for tools/prompts
   */
  async connect(): Promise<void> {
    await this.mcpClient.connect(this.transport);
  }

  /**
   * Send a request to the LLM with chat history
   * @param message - Message to send
   * @param chatId - ID of chat to use history from
   * @returns AsyncGenerator of response chunks
   * @throws Error if chat not found or LLM request fails
   */
  async *chat(
    message: string,
    chatId: string
  ): AsyncGenerator<string, void, unknown> {
    // Get chat history
    const chat = await this.chatManager.getChat(chatId);

    // Add user message to history
    await this.chatManager.addMessage(chatId, message, "user");

    // Create completion with streaming
    const response = (await this.openai.chat.completions.create({
      model: this.config.model ?? "gpt-4",
      messages: [
        ...chat.messages.map(
          (msg) =>
            ({
              role: msg.role,
              content: msg.content
            }) as ChatCompletionMessageParam
        ),
        { role: "user", content: message }
      ],
      stream: true,
      ...this.config.defaultParams
    })) as unknown as Stream<ChatCompletionChunk>;

    let accumulatedContent = "";

    // Stream response chunks
    try {
      for await (const chunk of response) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          accumulatedContent += content;
          yield content;
        }
      }
    } catch (error) {
      console.error("Error streaming response:", error);
      throw error;
    }

    // Save complete response to chat history
    if (accumulatedContent) {
      await this.chatManager.addMessage(
        chatId,
        accumulatedContent,
        "assistant"
      );
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    await this.mcpClient.close();
  }
}
