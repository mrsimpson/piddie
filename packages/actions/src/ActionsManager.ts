import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpHost, Tool, McpToolExecutionError } from "./mcp/McpHost";
import { ActionsProxyClient } from "./ActionsProxyClient";
import { ZodObject, z } from "zod";
import type { ClientTool } from "@piddie/actions-server";

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
  private actionsProxyClient: ActionsProxyClient | null = null;
  private connectionStatus: "connected" | "disconnected" | "error" =
    "disconnected";
  private connectionError: string | null = null;

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
   * Set the ActionsProxyClient for remote tool execution
   * @param client The ActionsProxyClient instance
   */
  public setActionsProxyClient(client: ActionsProxyClient | null): void {
    if (this.actionsProxyClient) {
      this.disconnect();
    }

    this.actionsProxyClient = client;
  }

  /**
   * Convert a Tool to a ClientTool
   * @param tool The Tool to convert
   * @returns A ClientTool representation
   */
  private toolToClientTool(tool: Tool): ClientTool {
    // Create a zod schema from the inputSchema
    const properties = tool.inputSchema.properties || {};
    const zodSchema: Record<string, any> = {};

    // Convert each property to a zod schema
    Object.entries(properties).forEach(([key, value]) => {
      const propType = (value as any)?.type;
      if (propType === "string") {
        zodSchema[key] = z.string();
      } else if (propType === "number") {
        zodSchema[key] = z.number();
      } else if (propType === "boolean") {
        zodSchema[key] = z.boolean();
      } else {
        // Default to any
        zodSchema[key] = z.any();
      }
    });

    return {
      name: tool.name,
      description: tool.description || "No description provided",
      parameters: z.object(zodSchema)
    };
  }

  /**
   * Connect to the actions server using the configured client
   * @returns Promise that resolves when connected or rejects on error
   */
  public async connectToActionsServer(): Promise<void> {
    if (!this.actionsProxyClient) {
      throw new Error("ActionsProxyClient not configured");
    }

    try {
      // Get all available tools
      const tools = await this.getAvailableTools();
      const clientTools = tools.map((tool) => this.toolToClientTool(tool));

      // Register tools with server
      const clientId = await this.actionsProxyClient.registerTools(clientTools);

      // Connect WebSocket
      await this.actionsProxyClient.connectWebSocket(clientId);

      this.connectionStatus = "connected";
      this.connectionError = null;

      console.log("[ActionsManager] Connected to actions server successfully");
    } catch (error) {
      this.connectionStatus = "error";
      this.connectionError =
        error instanceof Error ? error.message : String(error);
      console.error(
        "[ActionsManager] Failed to connect to actions server:",
        error
      );
      throw error;
    }
  }

  /**
   * Get the current connection status
   */
  public getConnectionStatus(): { status: string; error: string | null } {
    return {
      status: this.connectionStatus,
      error: this.connectionError
    };
  }

  /**
   * Check if connected to actions server
   */
  public isConnectedToActionsServer(): boolean {
    return this.connectionStatus === "connected";
  }

  /**
   * Disconnect from the actions server
   */
  public disconnect(): void {
    if (this.actionsProxyClient) {
      this.actionsProxyClient.close();
    }

    this.connectionStatus = "disconnected";
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
