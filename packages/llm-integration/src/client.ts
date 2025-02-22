import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  LLMRequestConfig,
  LLMResponse,
  McpToolResponse
} from "./types/client.js";

/**
 * Client for making LLM requests with MCP context
 */
export class LLMClient {
  private mcpClient: McpClient;
  private transport: StdioClientTransport;

  /**
   * Create a new LLM client
   */
  constructor() {
    this.transport = new StdioClientTransport({
      command: "node",
      args: ["server.js"] // This needs to point to our MCP server script
    });

    this.mcpClient = new McpClient(
      {
        name: "llm-client",
        version: "1.0.0"
      },
      {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {
            chat: {
              description: "Send a message to the LLM",
              arguments: {
                message: { type: "string" },
                model: { type: "string", optional: true }
              }
            }
          }
        }
      }
    );
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    await this.mcpClient.connect(this.transport);
  }

  /**
   * Send a request to the LLM, context is handled by MCP servers
   */
  async chat(config: LLMRequestConfig): Promise<LLMResponse> {
    const result = (await this.mcpClient.callTool({
      name: "chat",
      arguments: {
        message: config.message,
        ...(config.model ? { model: config.model } : {})
      }
    })) as McpToolResponse;

    if (!result.content?.[0]?.text) {
      throw new Error("Invalid response from LLM tool");
    }

    return {
      content: result.content[0].text
      // metadata: result.metadata
    };
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    await this.mcpClient.close();
  }
}
