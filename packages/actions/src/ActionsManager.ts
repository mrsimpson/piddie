import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpHost, Tool, McpToolExecutionError } from "./mcp/McpHost";

/**
 * Represents a tool call result for external consumers
 */
export interface ToolCallResult {
  status: "success" | "error";
  value: unknown;
  contentType?: string;
  timestamp: Date;
}

/**
 * Singleton manager for all actions and MCP servers
 * Serves as the central entry point for tool discovery and execution
 */
export class ActionsManager {
  private static instance: ActionsManager;
  private mcpHost: McpHost;
  private servers: Map<string, McpServer> = new Map();
  private initialized = false;
  private toolsBuffer: Tool[] | null = null;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    this.mcpHost = new McpHost();
  }

  /**
   * Get the singleton instance of ActionsManager
   * @returns The ActionsManager instance
   */
  public static getInstance(): ActionsManager {
    if (!ActionsManager.instance) {
      ActionsManager.instance = new ActionsManager();
    }
    return ActionsManager.instance;
  }

  /**
   * Initialize the ActionsManager and all MCP servers
   * This should be called during application bootstrap
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    // The servers will be registered by their respective packages
    // We just make sure the McpHost is ready to receive registrations

    this.initialized = true;
    console.log("[ActionsManager] Initialized successfully");
  }

  /**
   * Get the McpHost instance
   * @returns The McpHost instance
   */
  public getMcpHost(): McpHost {
    return this.mcpHost;
  }

  /**
   * Register an MCP server with the ActionsManager
   * @param server The MCP server to register
   * @param name The name to register the server under
   */
  public async registerServer(server: McpServer, name: string): Promise<void> {
    try {
      await this.mcpHost.registerLocalServer(server, name);
      this.servers.set(name, server);
      console.log(`[ActionsManager] Registered ${name} server successfully`);

      // Invalidate the tools buffer when registering a new server
      this.toolsBuffer = null;
    } catch (error) {
      console.error(
        `[ActionsManager] Failed to register ${name} server:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get an MCP server by name
   * @param name The name of the server
   * @returns The server or undefined if not found
   */
  public getServer(name: string): McpServer | undefined {
    return this.servers.get(name);
  }

  /**
   * Unregister an MCP server
   * @param name The name of the server
   * @returns True if the server was unregistered, false if it wasn't registered
   */
  public unregisterServer(name: string): boolean {
    const result = this.mcpHost.unregisterServer(name);
    if (result) {
      this.servers.delete(name);

      // Invalidate the tools buffer when unregistering a server
      this.toolsBuffer = null;
    }
    return result;
  }

  /**
   * Get all available tools from registered MCP servers
   * @returns A list of all available tools
   */
  public async getAvailableTools(): Promise<Tool[]> {
    if (this.toolsBuffer === null) {
      try {
        this.toolsBuffer = await this.mcpHost.listTools();
      } catch (error) {
        console.error("[ActionsManager] Error listing tools:", error);
        this.toolsBuffer = [];
      }
    }
    return this.toolsBuffer || [];
  }

  /**
   * Execute a tool call with standard error handling
   * @param toolName The name of the tool to call
   * @param args The arguments for the tool
   * @returns Result of the tool call conforming to ToolCallResult interface
   */
  public async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolCallResult> {
    try {
      // McpHost.executeToolCall now throws errors instead of returning them
      const result = await this.mcpHost.executeToolCall(toolName, args);

      // Determine content type based on result type
      let contentType = "application/json";
      let value = result;

      // Handle MCP protocol response structure
      if (
        typeof result === "object" &&
        result !== null &&
        "content" in result
      ) {
        const mcpResponse = result as {
          content?: Array<{ type: string; text: string }>;
        };

        if (mcpResponse.content && mcpResponse.content.length > 0) {
          // For simple text responses, combine all text content
          const allTextContent = mcpResponse.content
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\n");

          if (allTextContent.length > 0) {
            value = allTextContent;
            contentType = "text/plain";
          }
        }
      } else if (typeof result === "string") {
        contentType = "text/plain";
      } else if (
        (typeof Buffer !== "undefined" && result instanceof Buffer) ||
        (typeof Uint8Array !== "undefined" && result instanceof Uint8Array)
      ) {
        contentType = "application/octet-stream";
      }

      return {
        status: "success",
        value,
        contentType,
        timestamp: new Date()
      };
    } catch (error) {
      console.error(
        `[ActionsManager] Error executing tool call ${toolName}:`,
        error
      );

      // Create error result with detailed message
      let errorMessage: string;
      if (error instanceof McpToolExecutionError) {
        errorMessage = error.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }

      return {
        status: "error",
        value: { error: errorMessage },
        contentType: "application/json",
        timestamp: new Date()
      };
    }
  }
}
