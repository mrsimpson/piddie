import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaseLlmClient, ToolSupportStatus } from "../src/BaseLlmClient";
import type { LlmMessage, LlmProviderConfig, LlmResponse } from "../src/types";
import { EventEmitter } from "@piddie/shared-types";
import { MessageStatus } from "@piddie/chat-management";

// Create a concrete implementation of BaseLlmClient for testing
class TestLlmClient extends BaseLlmClient {
  constructor(
    config: LlmProviderConfig = {
      provider: "test",
      name: "Test Client",
      description: "Test LLM Client",
      apiKey: "test-key",
      model: "test-model"
    }
  ) {
    super(config);
  }

  // Expose protected methods for testing
  public extractToolCallsPublic(content: string): Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }> {
    return this.extractToolCalls(content);
  }

  public tryParseJsonPublic(jsonStr: string): Record<string, unknown> {
    return (this as any).tryParseJson(jsonStr);
  }

  public async addProvidedToolsPublic(message: LlmMessage): Promise<{
    message: LlmMessage;
    hasNativeToolsSupport: boolean;
  }> {
    return this.addProvidedTools(message);
  }

  public generateToolInstructionsPublic(tools: any[]): string {
    return this.generateToolInstructions(tools);
  }

  public postProcessResponsePublic(response: LlmResponse): LlmResponse {
    return this.postProcessResponse(response);
  }

  public get toolSupportStatusPublic(): ToolSupportStatus {
    return this.toolSupportStatus;
  }

  public set toolSupportStatusPublic(status: ToolSupportStatus) {
    this.toolSupportStatus = status;
  }

  // Implement abstract methods
  override async sendMessage(): Promise<LlmResponse> {
    return {
      id: "test-response-id",
      content: "Test response",
      role: "assistant",
      tool_calls: [],
      chatId: "test-chat-id",
      created: new Date()
    };
  }

  override streamMessage(): EventEmitter {
    return new EventEmitter();
  }

  protected override async checkToolSupportDirectly(): Promise<boolean> {
    return false;
  }
}

describe("BaseLlmClient", () => {
  let client: TestLlmClient;
  let config: LlmProviderConfig;
  let testMessage: LlmMessage;

  beforeEach(() => {
    config = {
      provider: "test",
      name: "Test Client",
      description: "Test LLM Client",
      apiKey: "test-key",
      model: "test-model"
    };
    client = new TestLlmClient(config);
    testMessage = {
      id: "test-message-id",
      chatId: "test-chat-id",
      content: "Test message",
      role: "user",
      status: MessageStatus.SENT,
      created: new Date(),
      provider: "test",
      tools: [
        {
          type: "function",
          function: {
            name: "testFunction",
            description: "A test function",
            parameters: {
              type: "object",
              properties: {
                param1: {
                  type: "string",
                  description: "A test parameter"
                }
              },
              required: ["param1"]
            }
          }
        }
      ]
    };
  });

  describe("Tool Instructions Generation", () => {
    it("should generate proper tool instructions with mcp-tool-call format", () => {
      const instructions = client.generateToolInstructionsPublic(
        testMessage.tools || []
      );

      // Check for key elements in the instructions
      expect(instructions).toContain("mcp-tool-call");
      expect(instructions).toContain("testFunction");
      expect(instructions).toContain("A test function");
      expect(instructions).toContain("param1");
    });

    it("should handle tools without descriptions", () => {
      const toolsWithoutDesc = [
        {
          type: "function",
          function: {
            name: "simple_function",
            parameters: {
              type: "object",
              properties: {}
            }
          }
        }
      ];

      const instructions =
        client.generateToolInstructionsPublic(toolsWithoutDesc);
      expect(instructions).toContain("simple_function");
      expect(instructions).toContain("mcp-tool-call");
      expect(instructions).toContain("No description provided");
    });
  });

  describe("Tool Call Extraction", () => {
    it("should extract tool calls from content with mcp-tool-call format", () => {
      const content = `Here's a response.

\`\`\`mcp-tool-call
{
  "tool_calls": [
    {
      "function": {
        "name": "testFunction",
        "arguments": {
          "param1": "test value"
        }
      }
    }
  ]
}
\`\`\``;

      const toolCalls = client.extractToolCallsPublic(content);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.function.name).toBe("testFunction");
      expect(toolCalls[0]?.function.arguments).toEqual({
        param1: "test value"
      });
    });

    it("should extract tool calls with string arguments", () => {
      const content = `Here's a response.

\`\`\`mcp-tool-call
{
  "tool_calls": [
    {
      "function": {
        "name": "testFunction",
        "arguments": "{\\"param1\\": \\"test value\\"}"
      }
    }
  ]
}
\`\`\``;

      const toolCalls = client.extractToolCallsPublic(content);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.function.name).toBe("testFunction");
      expect(toolCalls[0]?.function.arguments).toEqual({
        param1: "test value"
      });
    });

    it("should handle malformed JSON gracefully", () => {
      const content = `Here's a response.

\`\`\`mcp-tool-call
{
  "tool_calls": [
    {
      "function": {
        "name": "testFunction",
        "arguments": { "param1": "value" 
      }
    }
  ]
}
\`\`\``;

      const toolCalls = client.extractToolCallsPublic(content);
      expect(toolCalls).toHaveLength(0);
    });

    it("should handle multiple tool calls", () => {
      const content = `Here's a response.

\`\`\`mcp-tool-call
{
  "tool_calls": [
    {
      "function": {
        "name": "function1",
        "arguments": { "param1": "value1" }
      }
    },
    {
      "function": {
        "name": "function2",
        "arguments": { "param2": "value2" }
      }
    }
  ]
}
\`\`\``;

      const toolCalls = client.extractToolCallsPublic(content);
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]?.function.name).toBe("function1");
      expect(toolCalls[1]?.function.name).toBe("function2");
    });

    it("should handle content without tool calls", () => {
      const content = "Here's a response without any tool calls.";
      const toolCalls = client.extractToolCallsPublic(content);
      expect(toolCalls).toHaveLength(0);
    });

    it("should handle multiple tool calls in a single tool_calls array", () => {
      const content = `Here's a response with multiple tool calls in a single block.

\`\`\`mcp-tool-call
{
  "tool_calls": [
    {
      "function": {
        "name": "write_file",
        "arguments": {
          "path": "./file1.txt",
          "content": "1"
        }
      }
    },
    {
      "function": {
        "name": "write_file",
        "arguments": {
          "path": "./file2.txt",
          "content": "2"
        }
      }
    }
  ]
}
\`\`\``;

      const toolCalls = client.extractToolCallsPublic(content);
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]?.function.name).toBe("write_file");
      expect(toolCalls[0]?.function.arguments).toEqual({
        path: "./file1.txt",
        content: "1"
      });
      expect(toolCalls[1]?.function.name).toBe("write_file");
      expect(toolCalls[1]?.function.arguments).toEqual({
        path: "./file2.txt",
        content: "2"
      });
    });

    it("should handle multiple mcp-tool-call blocks in one response", () => {
      const content = `Here's a response with multiple tool call blocks.

\`\`\`mcp-tool-call
{
  "function": {
    "name": "tool1",
    "arguments": { "param1": "value1" }
  }
}
\`\`\`

And here's another one:

\`\`\`mcp-tool-call
{
  "function": {
    "name": "tool2",
    "arguments": { "param2": "value2" }
  }
}
\`\`\``;

      const toolCalls = client.extractToolCallsPublic(content);
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]?.function.name).toBe("tool1");
      expect(toolCalls[1]?.function.name).toBe("tool2");
    });
  });

  describe("JSON Parsing Helper", () => {
    it("should parse valid JSON", () => {
      const jsonStr = '{"key": "value", "number": 42}';
      const result = client.tryParseJsonPublic(jsonStr);
      expect(result).toEqual({ key: "value", number: 42 });
    });

    it("should handle invalid JSON", () => {
      const jsonStr = '{"key": "value", invalid}';
      const result = client.tryParseJsonPublic(jsonStr);
      expect(result).toHaveProperty("_original", jsonStr);
    });

    it("should handle empty strings", () => {
      const result = client.tryParseJsonPublic("");
      expect(result).toHaveProperty("_original", "");
    });
  });

  describe("Post-Processing Logic", () => {
    it("should not modify responses when tool support is native", () => {
      client.toolSupportStatusPublic = ToolSupportStatus.NATIVE;

      const response: LlmResponse = {
        id: "test-id",
        chatId: "test-chat-id",
        content: "Test response",
        role: "assistant",
        created: new Date()
      };

      const processed = client.postProcessResponsePublic(response);
      expect(processed).toBe(response);
    });

    it("should not modify responses that already have tool calls", () => {
      client.toolSupportStatusPublic = ToolSupportStatus.VIA_PROMPT;

      const response: LlmResponse = {
        id: "test-id",
        chatId: "test-chat-id",
        content: "Test response",
        role: "assistant",
        created: new Date(),
        tool_calls: [
          {
            function: {
              name: "testFunction",
              arguments: { param1: "value" }
            }
          }
        ]
      };

      const processed = client.postProcessResponsePublic(response);
      expect(processed).toBe(response);
    });

    it("should extract tool calls from content when needed", () => {
      client.toolSupportStatusPublic = ToolSupportStatus.VIA_PROMPT;

      const response: LlmResponse = {
        id: "test-id",
        chatId: "test-chat-id",
        content: `Test response

\`\`\`mcp-tool-call
{
  "tool_calls": [
    {
      "function": {
        "name": "testFunction",
        "arguments": { "param1": "value" }
      }
    }
  ]
}
\`\`\``,
        role: "assistant",
        created: new Date()
      };

      const processed = client.postProcessResponsePublic(response);
      expect(processed.tool_calls).toHaveLength(1);
      expect(processed.tool_calls?.[0]!.function.name).toBe("testFunction");
    });

    it("should return original response when no tool calls are found", () => {
      client.toolSupportStatusPublic = ToolSupportStatus.VIA_PROMPT;

      const response: LlmResponse = {
        id: "test-id",
        chatId: "test-chat-id",
        content: "Test response without tool calls",
        role: "assistant",
        created: new Date()
      };

      const processed = client.postProcessResponsePublic(response);
      expect(processed).toBe(response);
      expect(processed.tool_calls).toBeUndefined();
    });
  });

  describe("Tool Support Management", () => {
    it("should return message as-is when no tools are provided", async () => {
      const messageWithoutTools: LlmMessage = {
        id: "test-id",
        chatId: "test-chat",
        content: "Test message",
        role: "user",
        status: MessageStatus.SENT,
        created: new Date(),
        provider: "test"
      };

      const result = await client.addProvidedToolsPublic(messageWithoutTools);
      expect(result.message).toBe(messageWithoutTools);
      expect(result.hasNativeToolsSupport).toBe(false);
    });

    it("should return message with hasNativeToolsSupport=true when tools are natively supported", async () => {
      client.toolSupportStatusPublic = ToolSupportStatus.NATIVE;

      const result = await client.addProvidedToolsPublic(testMessage);
      expect(result.message).toBe(testMessage);
      expect(result.hasNativeToolsSupport).toBe(true);
    });

    it("should enhance message with tool instructions when tools are not natively supported", async () => {
      client.toolSupportStatusPublic = ToolSupportStatus.VIA_PROMPT;

      const result = await client.addProvidedToolsPublic(testMessage);
      expect(result.message).not.toBe(testMessage);
      expect(result.hasNativeToolsSupport).toBe(false);
      expect(result.message.systemPrompt).toContain("mcp-tool-call");
    });

    it("should check tool support if status is unchecked", async () => {
      // Mock checkToolSupport to set status to VIA_PROMPT
      const checkSpy = vi
        .spyOn(client, "checkToolSupport")
        .mockImplementation(async () => {
          client.toolSupportStatusPublic = ToolSupportStatus.VIA_PROMPT;
          return false;
        });

      const result = await client.addProvidedToolsPublic(testMessage);
      expect(checkSpy).toHaveBeenCalledTimes(1);
      expect(result.hasNativeToolsSupport).toBe(false);
    });
  });

  describe("Tool Support Detection", () => {
    it("should cache tool support status after checking", async () => {
      const client = new TestLlmClient(config);

      // Mock the checkToolSupportDirectly method to return false
      const checkSpy = vi
        .spyOn(
          client as unknown as {
            checkToolSupportDirectly: () => Promise<boolean>;
          },
          "checkToolSupportDirectly"
        )
        .mockResolvedValue(false);

      // First call should check directly
      const result1 = await client.checkToolSupport();

      // The status should be updated by the checkToolSupport method
      expect(result1).toBe(false);
      expect(client.toolSupportStatusPublic).toBe(ToolSupportStatus.VIA_PROMPT);

      // Reset the mock to verify it's not called again
      checkSpy.mockClear();

      // Second call should use cached result
      const result2 = await client.checkToolSupport();

      expect(checkSpy).not.toHaveBeenCalled();
      expect(result2).toBe(false);
    });

    it("should set status to NATIVE when tools are supported", async () => {
      const client = new TestLlmClient(config);

      // Mock the checkToolSupportDirectly method to return true
      vi.spyOn(
        client as unknown as {
          checkToolSupportDirectly: () => Promise<boolean>;
        },
        "checkToolSupportDirectly"
      ).mockResolvedValue(true);

      const result = await client.checkToolSupport();

      expect(result).toBe(true);
      expect(client.toolSupportStatusPublic).toBe(ToolSupportStatus.NATIVE);
    });

    it("should set status to VIA_PROMPT when tools are not supported", async () => {
      const client = new TestLlmClient(config);

      // Mock the checkToolSupportDirectly method to return false
      vi.spyOn(
        client as unknown as {
          checkToolSupportDirectly: () => Promise<boolean>;
        },
        "checkToolSupportDirectly"
      ).mockResolvedValue(false);

      const result = await client.checkToolSupport();

      expect(result).toBe(false);
      expect(client.toolSupportStatusPublic).toBe(ToolSupportStatus.VIA_PROMPT);
    });
  });
});
