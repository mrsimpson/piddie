import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { WebSocketServer, WebSocket } from "ws";
import { Tool, ToolResponseMessage, CallToolResult } from "./types";

interface ClientRegistration {
  clientId: string;
  mcpServer: McpServer;
  tools: Map<string, Tool>;
  ws?: WebSocket;
}

export class ActionsProxy {
  // Map of client ID to client registration
  private clients: Map<string, ClientRegistration> = new Map();
  // WebSocket server
  private wss: WebSocketServer;
  // Map of request ID to promise resolve function
  private pendingRequests: Map<
    string,
    (response: ToolResponseMessage) => void
  > = new Map();
  // Map of connected client IDs to client registrations
  private connectedClients: Map<string, ClientRegistration> = new Map();
  // Map of server transports for each MCP server
  private mcpServerTransports: Map<string, any> = new Map();

  constructor(port: number = 9101) {
    console.log("Starting WebSocket server on port:", port);
    this.wss = new WebSocketServer({ port });
    this.setupWebSocketServer();
  }

  private setupWebSocketServer() {
    this.wss.on("connection", (ws: WebSocket, req) => {
      // Extract clientId from URL query params
      const url = new URL(req.url || "", "ws://localhost");
      const clientId = url.searchParams.get("clientId");

      if (!clientId) {
        ws.close(1008, "Missing clientId parameter");
        return;
      }

      const client = this.clients.get(clientId);
      if (!client) {
        ws.close(1008, "Invalid clientId");
        return;
      }

      // Store the WebSocket connection so that we can send requests directly to the relevant socket
      client.ws = ws;
      this.connectedClients.set(clientId, client);

      ws.on("close", () => {
        console.log(`Client ${clientId} disconnected`);
        this.connectedClients.delete(clientId);
      });

      ws.on("message", (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString()) as ToolResponseMessage;
          if (data.type === "TOOL_RESPONSE") {
            const { requestId } = data.payload;
            const resolve = this.pendingRequests.get(requestId);
            if (resolve) {
              resolve(data);
              this.pendingRequests.delete(requestId);
            }
          }
        } catch (error) {
          console.error("Error handling WebSocket message:", error);
        }
      });
    });

    // Log any WebSocket server errors
    this.wss.on("error", (error) => {
      console.error("WebSocket server error:", error);
    });
  }

  private async sendRequest(
    clientId: string,
    request: CallToolRequest & { requestId: string }
  ): Promise<ToolResponseMessage> {
    const client = this.connectedClients.get(clientId);
    if (!client || !client.ws) {
      throw new Error(`Client ${clientId} not connected`);
    }

    return new Promise((resolve) => {
      this.pendingRequests.set(request.requestId, resolve);
      const ws = this.connectedClients.get(clientId)?.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "TOOL_REQUEST",
            payload: request
          })
        );
      }
    });
  }

  /**
   * Register client tools and return clientId
   */
  async registerTools(tools: Tool[]): Promise<string> {
    const clientId = uuidv4();

    // Create a new MCP server for this client
    const mcpServer = new McpServer({
      name: `client-${clientId}`,
      version: "1.0.0"
    });

    const clientTools = new Map<string, Tool>();

    // Store client registration
    const clientRegistration: ClientRegistration = {
      clientId,
      mcpServer,
      tools: clientTools
    };

    this.clients.set(clientId, clientRegistration);

    if (!tools || tools.length === 0) {
      return clientId;
    }

    // Register tools with client-specific MCP server
    await this.registerClientTools(clientId, tools, clientTools);

    return clientId;
  }

  /**
   * Add tools to an existing client registration
   * @param clientId The client ID to add tools to
   * @param tools The tools to add
   */
  async addTools(clientId: string, tools: Tool[]): Promise<void> {
    // Check if client exists
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }

    if (!tools || tools.length === 0) {
      return;
    }

    // Check if we need to temporarily disconnect from a transport
    const needsReconnect = this.mcpServerTransports.has(clientId);
    if (needsReconnect) {
      await this.disconnectMcpServerTransport(clientId);
    }

    try {
      // If we've created a new MCP server, we need to re-register all existing tools first
      // This ensures the new server has all the tools that were previously registered
      if (needsReconnect) {
        const existingTools = Array.from(client.tools.values());
        if (existingTools.length > 0) {
          console.log(`Re-registering ${existingTools.length} existing tools for client ${clientId}`);
          await this.registerClientTools(clientId, existingTools, client.tools);
        }
      }

      // Now register the new tools
      console.log(`Registering ${tools.length} new tools for client ${clientId}`);
      await this.registerClientTools(clientId, tools, client.tools);
    } finally {
      // Reconnect to transport if needed
      if (needsReconnect) {
        await this.reconnectMcpServerTransport(clientId);
      }
    }
  }

  /**
   * Disconnects an MCP server from its transport temporarily
   * @param clientId The client ID
   */
  private async disconnectMcpServerTransport(clientId: string): Promise<void> {
    const transport = this.mcpServerTransports.get(clientId);
    if (!transport) {
      return;
    }

    console.log(`Temporarily disconnecting MCP server for client ${clientId}`);
    try {
      // Store state that we'll need for reconnection
      transport._disconnectedForToolAddition = true;

      // Get the MCP server
      const mcpServer = this.getMcpServerForClient(clientId);
      if (!mcpServer) {
        throw new Error(`MCP server not found for client ${clientId}`);
      }

      // Only close the server, don't try to close the transport
      // StdioServerTransport can't be restarted once closed
      if (typeof mcpServer.close === "function") {
        await mcpServer.close();
      }

      console.log(`Successfully disconnected MCP server for client ${clientId}`);

      // Create a new MCP server instance to replace the old one
      const newMcpServer = new McpServer({
        name: `client-${clientId}`,
        version: "1.0.0"
      });

      // Replace the old server with the new one
      const client = this.clients.get(clientId);
      if (client) {
        client.mcpServer = newMcpServer;
      }
    } catch (error) {
      console.error(`Error disconnecting transport for client ${clientId}:`, error);
    }
  }

  /**
   * Reconnects an MCP server to its transport after adding tools
   * @param clientId The client ID 
   */
  private async reconnectMcpServerTransport(clientId: string): Promise<void> {
    const transport = this.mcpServerTransports.get(clientId);
    if (!transport || !transport._disconnectedForToolAddition) {
      return;
    }

    console.log(`Reconnecting MCP server for client ${clientId}`);
    try {
      const mcpServer = this.getMcpServerForClient(clientId);
      if (!mcpServer) {
        throw new Error(`MCP server not found for client ${clientId}`);
      }

      // We don't need to reconnect here - we'll let the clientManager handle it
      // by creating a fresh StdioServerTransport
      delete transport._disconnectedForToolAddition;

      // Remove the old transport reference since it can't be reused
      this.mcpServerTransports.delete(clientId);

      console.log(`Successfully prepared MCP server for reconnection for client ${clientId}`);
    } catch (error) {
      console.error(`Error reconnecting transport for client ${clientId}:`, error);
      throw error;
    }
  }

  /**
   * Register tools with the client-specific MCP server
   * @param clientId The client ID
   * @param tools The tools to register
   * @param toolsMap The map to store the tools in
   */
  private async registerClientTools(
    clientId: string,
    tools: Tool[],
    toolsMap: Map<string, Tool>
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }

    const mcpServer = client.mcpServer;

    // Register each tool with client-specific MCP server
    for (const toolDef of tools) {
      // Skip if this tool is already in the map (for re-registrations)
      const isAlreadyRegistered = toolsMap.has(toolDef.name);
      if (isAlreadyRegistered) {
        console.log(`Skipping re-registration of tool ${toolDef.name} for client ${clientId}`);
        continue;
      }

      // Convert from our Tool to Zod schema for MCP server
      // Create a zod schema based on the tool's inputSchema
      const schemaObj: Record<string, z.ZodTypeAny> = {};

      if (toolDef.inputSchema.properties) {
        // Convert properties to zod schema
        Object.entries(toolDef.inputSchema.properties).forEach(
          ([key, prop]) => {
            const propType = (prop as any)?.type;
            if (propType === "string") {
              schemaObj[key] = z.string();
            } else if (propType === "number") {
              schemaObj[key] = z.number();
            } else if (propType === "boolean") {
              schemaObj[key] = z.boolean();
            } else if (propType === "object") {
              schemaObj[key] = z.object({}).passthrough();
            } else if (propType === "array") {
              schemaObj[key] = z.array(z.any());
            } else {
              schemaObj[key] = z.any();
            }
          }
        );
      }

      // Add authentication parameters required for this proxy
      const extendedSchema = {
        ...schemaObj,
        clientId: z.string(),
        clientSecret: z.string()
      };

      if (isAlreadyRegistered) {
        console.log(`Re-registering existing tool ${toolDef.name} for client ${clientId}`);
      } else {
        console.log(`Registering new tool ${toolDef.name} for client ${clientId}`);
      }

      try {
        mcpServer.tool(
          toolDef.name,
          toolDef.description || toolDef.name,
          extendedSchema,
          async (params: Record<string, unknown>) => {
            try {
              const {
                clientId: paramClientId,
                clientSecret,
                ...toolParams
              } = params;

              // Use type guard to ensure clientId is a string
              if (typeof paramClientId !== "string") {
                throw new Error("Client ID must be a string");
              }

              // Verify that the client ID in params matches this server's client ID
              if (paramClientId !== clientId) {
                throw new Error(
                  `Client ID mismatch: expected ${clientId}, got ${paramClientId}`
                );
              }

              const client = this.clients.get(paramClientId);

              if (!client) {
                throw new Error(`Client ${paramClientId} not found`);
              }

              const requestId = uuidv4();
              const response = await this.sendRequest(paramClientId, {
                method: "tools/call",
                requestId,
                params: {
                  name: toolDef.name,
                  arguments: toolParams,
                  _meta: {}
                }
              });

              if (response.payload.error) {
                throw new Error(response.payload.error);
              }

              // Handle the result which should be a CallToolResult
              const result = response.payload.result;

              return result as CallToolResult;
            } catch (error) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: error instanceof Error ? error.message : String(error)
                  }
                ],
                _meta: {},
                isError: true
              } as CallToolResult;
            }
          }
        );
      } catch (error) {
        console.error(`Error registering tool ${toolDef.name} for client ${clientId}:`, error);
      }

      // Only store in the map if it's a new tool
      if (!isAlreadyRegistered) {
        toolsMap.set(toolDef.name, toolDef);
      }
    }
  }

  /**
   * Get the MCP server for a specific client
   * @param clientId The client ID
   * @returns The client's MCP server
   */
  getMcpServerForClient(clientId: string): McpServer | undefined {
    return this.clients.get(clientId)?.mcpServer;
  }

  /**
   * Get all client IDs
   * @returns Array of client IDs
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Close the WebSocket server and clean up all connections
   */
  close() {
    // First, close the WebSocket server
    this.wss.close();

    // Then clean up any remaining resources for MCP servers
    // Use try-catch to handle any errors gracefully
    this.clients.forEach((client) => {
      try {
        client.mcpServer.close();
      } catch (error) {
        console.error(
          `Error closing MCP server for client ${client.clientId}:`,
          error
        );
      }
    });
  }

  public isClientConnected(clientId: string): boolean {
    return this.connectedClients.has(clientId);
  }

  /**
   * Store a transport used for an MCP server to enable reconnection support
   * @param clientId The client ID
   * @param transport The transport instance
   */
  public storeMcpServerTransport(clientId: string, transport: any): void {
    this.mcpServerTransports.set(clientId, transport);
  }
}
