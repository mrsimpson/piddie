// packages/llm-integration/src/mcp/host.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LLMClient } from "../client.js";

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

  constructor(transport: StdioServerTransport) {
    this.transport = transport;
    this.client = new LLMClient();
  }

  /**
   * Initialize all MCP servers and connect client
   */
  async initialize(servers: ServerConfig[]) {
    // Connect each enabled server to the transport
    for (const { name, server, enabled = true } of servers) {
      if (enabled) {
        await server.connect(this.transport);
        this.servers.set(name, server);
      }
    }

    // Connect the client
    await this.client.connect();
  }

  /**
   * Get a registered server by name
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
   * Stop all servers and cleanup
   */
  async stop(): Promise<void> {
    // Disconnect client
    await this.client.disconnect();

    // Disconnect all servers
    for (const server of this.servers.values()) {
      await server.close();
    }
    this.servers.clear();
  }
}
