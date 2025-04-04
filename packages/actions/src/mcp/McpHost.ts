import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Define Tool interface locally to avoid import issues
export interface Tool {
  name: string;
  description?: string | undefined;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown> | undefined;
  };
}

/**
 * Custom error class for MCP tool execution errors
 */
export class McpToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolExecutionError";
  }
}

/**
 * MCP host for managing connections to MCP servers
 * This is the central registry for all MCP servers in the application
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
   * @returns A promise that resolves when the server is registered
   */
  async registerLocalServer(server: McpServer, name: string): Promise<void> {
    try {
      // If a server with this name already exists, unregister it first
      if (this.connections.has(name)) {
        this.unregisterServer(name);
      }

      // Create transport pair
      const transports = InMemoryTransport.createLinkedPair();
      const clientTransport = transports[0];
      const serverTransport = transports[1];

      // Connect server to transport
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
   * @returns True if the server was unregistered, false if not found
   */
  unregisterServer(name: string): boolean {
    const connection = this.connections.get(name);
    if (connection) {
      try {
        connection.client.close();
        connection.server?.close();
        console.log(`[McpHost] Unregistered server: ${name}`);
        return this.connections.delete(name);
      } catch (error) {
        console.error(`[McpHost] Error unregistering server ${name}:`, error);
        // Still try to remove from connections even if close failed
        return this.connections.delete(name);
      }
    }
    return false;
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
    for (const [_, connection] of this.connections) {
      try {
        const toolsResult = await connection.client.listTools();
        if (toolsResult && toolsResult.tools) {
          // Convert to our Tool interface
          const tools = toolsResult.tools.map((tool: Tool) => ({
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
  ): Promise<CallToolResult> {
    // Try each connection until we find one that can handle the tool
    for (const [_, connection] of this.connections) {
      try {
        const toolParams = {
          name,
          arguments: params
        };

        const result = await connection.client.callTool(toolParams);
        return result as CallToolResult;
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

  /**
   * Execute a tool call with standard error handling
   * By providing a wrapper for the MCP server tool, consumers don't need to care about the actual server
   * and can treat all tools as if they were provided through a single point of contact
   * @param toolName The name of the tool to call
   * @param args The arguments for the tool
   * @returns Result of the tool call
   * @throws {McpToolExecutionError} When tool execution fails
   */
  async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    try {
      const response = await this.callTool(toolName, args);

      // Check if the response indicates an error according to MCP protocol
      if (response.isError) {
        // Extract error message from content if available
        let errorMessage = "Tool execution failed";
        if (response.content && response.content.length > 0) {
          errorMessage = response.content.map((item) => item.text).join("\n");
        }

        throw new McpToolExecutionError(errorMessage);
      }

      return response;
    } catch (error) {
      // Log the error but rethrow
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[McpHost] Error executing tool call ${toolName}:`, error);

      // If it's already a McpToolExecutionError, just rethrow it
      if (error instanceof McpToolExecutionError) {
        throw error;
      }

      // Otherwise, wrap it in our custom error
      throw new McpToolExecutionError(errorMessage);
    }
  }
}
