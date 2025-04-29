import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import { McpHost, McpToolExecutionError } from "./mcp/McpHost";
import { ActionsProxyClient } from "./ActionsProxyClient";

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
      this.actionsProxyClient.close();
    }
    this.actionsProxyClient = client;
  }

  /**
   * Connect to the actions server using the configured client
   * @returns Promise that resolves when connected or rejects on error
   */
  public async connectToActionsServer(): Promise<void> {
    if (!this.actionsProxyClient) {
      throw new Error("ActionsProxyClient not configured");
    }

    if (!this.isConnectedToActionsServer()) {
      try {
        // Get initial tools - this might be an empty array at first
        const initialTools = await this.getAvailableTools();

        const clientId =
          await this.actionsProxyClient.registerTools(initialTools);

        // Connect WebSocket
        await this.actionsProxyClient.connectWebSocket(clientId);

        console.log(
          "[ActionsManager] Connected to actions server successfully"
        );
      } catch (error) {
        console.error(
          "[ActionsManager] Failed to connect to actions server:",
          error
        );
        throw error;
      }
    } else {
      const availableTools = await this.getAvailableTools();
      if (availableTools.length > 0) {
        await this.actionsProxyClient?.addTools(availableTools);
      }
    }
  }

  /**
   * Check if connected to actions server
   */
  public isConnectedToActionsServer(): boolean {
    return this.actionsProxyClient?.isConnected() ?? false;
  }

  /**
   * Disconnect from the actions server
   */
  public disconnect(): void {
    this.actionsProxyClient?.close();
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
   * @param name The name of the server
   */
  public async registerServer(server: McpServer, name: string): Promise<void> {
    try {
      await this.mcpHost.registerLocalServer(server, name);
      this.servers.set(name, server);
      console.log(`[ActionsManager] Registered ${name} server successfully`);

      // Invalidate the tools buffer when registering a new server
      this.toolsBuffer = null;

      // If we're connected to the actions server, update the tools there too
      if (this.isConnectedToActionsServer()) {
        try {
          // Invalidate the tools buffer to force a refresh
          this.toolsBuffer = null;

          // Get the latest tools after adding the new server
          const allTools = await this.getAvailableTools();

          // Add them to the actions server
          await this.actionsProxyClient?.addTools(allTools);

          console.log(`[ActionsManager] Updated tools in actions server`);
        } catch (error) {
          console.error(
            `[ActionsManager] Failed to add tools from ${name} to actions server:`,
            error
          );
          // Don't throw here - we still want to keep the server registered locally
        }
      }
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
   * @returns Result of the tool call conforming to CallToolResult interface
   */
  public async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    try {
      // Call the tool via McpHost
      const result = await this.mcpHost.executeToolCall(toolName, args);
      return result;
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

      // Return an error result in CallToolResult format
      return {
        content: [
          {
            type: "text",
            text: errorMessage
          }
        ],
        _meta: {},
        isError: true
      };
    }
  }
}
