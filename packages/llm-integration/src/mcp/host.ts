import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ChatManager } from "@piddie/chat-management";
import { LLMClient } from "../client.js";
import type { LLMClientConfig } from "../types/client.js";

export interface ServerConfig {
  name: string;
  server: McpServer;
  enabled?: boolean;
}

/**
 * Host that coordinates MCP servers and LLM communication
 */
export class LLMIntegrationHost {
  private transport: StdioServerTransport;
  private servers: Map<string, McpServer> = new Map();
  private client: LLMClient;

  /**
   * Create a new LLM integration host
   * @param transport - Transport layer for MCP communication
   * @param chatManager - Manager for chat history
   * @param llmConfig - Configuration for LLM client
   */
  constructor(
    transport: StdioServerTransport,
    chatManager: ChatManager,
    llmConfig: LLMClientConfig
  ) {
    this.transport = transport;
    this.client = new LLMClient(chatManager, llmConfig);
  }

  /**
   * Initialize all MCP servers and connect client
   * @param servers - List of MCP servers to initialize
   */
  async initialize(servers: ServerConfig[]): Promise<void> {
    // Connect each enabled server to the transport
    for (const { name, server, enabled = true } of servers) {
      if (enabled) {
        await server.connect(this.transport);
        this.servers.set(name, server);
      }
    }

    // Connect the client to access tools/prompts
    await this.client.connect();
  }

  /**
   * Get a registered server by name
   * @param name - Name of the server to get
   */
  getServer(name: string): McpServer | undefined {
    return this.servers.get(name);
  }

  /**
   * Get the LLM client
   */
  getLLMClient(): LLMClient {
    return this.client;
  }

  /**
   * Disconnect all servers and client
   */
  async disconnect(): Promise<void> {
    // Disconnect all servers
    for (const server of this.servers.values()) {
      await server.close();
    }

    // Disconnect client
    await this.client.disconnect();
  }
}
