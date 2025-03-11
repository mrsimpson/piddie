import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Define Tool interface locally to avoid import issues
interface Tool {
  name: string;
  description?: string | undefined;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown> | undefined;
  };
}

/**
 * MCP host for managing connections to MCP servers
 */
export class McpHost {
  /**
   * The connections
   */
  private connections: Map<
    string,
    {
      name: string;
      server?: McpServer;
      client: Client;
    }
  > = new Map();

  /**
   * Register a local server with in-memory transport
   * @param server The server to register
   * @param name The name of the server
   */
  async registerLocalServer(server: McpServer, name: string): Promise<void> {
    try {
      // Create transport pair
      const transports = InMemoryTransport.createLinkedPair();
      const clientTransport = transports[0];
      const serverTransport = transports[1];

      // Connect server to transport (assuming server has a connect method)
      await server.connect(serverTransport);

      // Create and connect client
      const client = new Client({
        name: `${name}-client`,
        version: "1.0.0"
      });
      await client.connect(clientTransport);

      // Store connection
      this.connections.set(name, { name, server, client });

      console.log(`[McpHost] Registered local server: ${name}`);
    } catch (error) {
      console.error(`[McpHost] Error registering local server ${name}:`, error);
      throw error;
    }
  }

  /**
   * Unregister a server by name
   * @param name The name of the server
   * @returns The server or undefined if not found
   */
  unregisterServer(name: string): boolean {
    const connection = this.connections.get(name);
    if (connection) {
      connection.client.close();
      connection.server?.close();
      console.log(`[McpHost] Unregistered server: ${name}`);
      return this.connections.delete(name);
    }
    return true;
  }

  /**
   * Get a connection by name
   * @param name The name of the connection
   * @returns The connection or undefined if not found
   */
  getConnection(
    name: string
  ): { name: string; server?: McpServer; client: Client } | undefined {
    return this.connections.get(name);
  }

  /**
   * List all tools from all connections
   * @returns A list of all tools
   */
  async listTools(): Promise<Tool[]> {
    const allTools: Tool[] = [];

    // Collect tools from all connections

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [_, connection] of this.connections) {
      try {
        const toolsResult = await connection.client.listTools();
        if (toolsResult && toolsResult.tools) {
          // Convert to our Tool interface
          const tools = toolsResult.tools.map((tool) => ({
            name: tool.name,
            description: tool.description || undefined,
            inputSchema: {
              type: tool.inputSchema.type,
              properties: tool.inputSchema.properties || undefined
            }
          }));
          allTools.push(...tools);
        }
      } catch (error) {
        console.error(
          `[McpHost] Error listing tools for ${connection.name}:`,
          error
        );
      }
    }

    return allTools;
  }

  /**
   * Call a tool by name
   * @param name The name of the tool
   * @param params The parameters for the tool
   * @returns The result of the tool call
   */
  async callTool(
    name: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    // Try each connection until we find one that can handle the tool

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [_, connection] of this.connections) {
      try {
        const result = await connection.client.callTool({
          name,
          arguments: params
        });
        return result;
      } catch (error) {
        // If it's a "tool not found" error, continue to the next connection
        // Otherwise, rethrow
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("not found") ||
          errorMessage.includes("unknown tool")
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Tool ${name} not found in any connection`);
  }
}
