import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types";
import { IncomingMessage as Request, ServerResponse as Response } from 'http';
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { WebSocketServer, WebSocket } from "ws";
import { Tool, ToolResponseMessage } from "./types";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

interface ClientRegistration {
  clientId: string;
  mcpServer: McpServer;
  tools: Map<string, Tool>;
  ws?: WebSocket;
  httpSessions: Map<string, {
    transport: StreamableHTTPServerTransport;
    lastAccess: number;
  }>;
}

/**
 * The ActionsProxy is responsible for registering workbench specific tools running within the browser ("clients")
 * It manages WebSocket connections to clients, routes tool execution requests, and exposes registered tools to MCP clients.
 */
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
  private mcpServerTransports: Map<string, StreamableHTTPServerTransport> = new Map();

  constructor(port: number = 19101) {
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

  /**
   * Send a request to a client via WebSocket
   * @param clientId The client ID
   * @param request The request to send
   * @returns A promise that resolves with the response
   */
  async sendRequest(
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
      tools: clientTools,
      httpSessions: new Map()
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
    if (!transport) {
      return;
    }

    console.log(`Reconnecting MCP server for client ${clientId}`);
    try {
      const mcpServer = this.getMcpServerForClient(clientId);
      if (!mcpServer) {
        throw new Error(`MCP server not found for client ${clientId}`);
      }

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

    const workbenchSpecificMcpServer = client.mcpServer;

    // Register each tool with client-specific MCP server
    for (const toolDef of tools) {
      // Skip if this tool is already in the map (for re-registrations)
      const isAlreadyRegistered = toolsMap.has(toolDef.name);
      if (isAlreadyRegistered) {
        console.log(`Skipping re-registration of tool ${toolDef.name} for client ${clientId}`);
        continue;
      }

      const schemaObj = toolDef.inputSchema as { [key: string]: z.ZodTypeAny };

      // Always include clientId and clientSecret in the tool schema
      schemaObj.clientId = z.string().describe("The client ID for this workbench");
      schemaObj.clientSecret = z.string().describe("The client-side secret for authentication");

      // Convert schemaObj to ZodRawShape
      const zodSchemaObj: z.ZodRawShape = {};
      for (const key in schemaObj) {
        if (Object.prototype.hasOwnProperty.call(schemaObj, key)) {
          zodSchemaObj[key] = schemaObj[key];
        }
      }

      try {
        // Register the tool with the McpServer - using type assertion to work around MCP type issues
        workbenchSpecificMcpServer.tool(
          toolDef.name,
          toolDef.description || `Tool: ${toolDef.name}`,
          zodSchemaObj,
          {},
          async (params) => {
            try {
              // Forward tool request to client via WebSocket
              const requestId = uuidv4();

              // Extract the relevant parameters
              const { clientId: paramClientId, clientSecret, ...toolParams } = params;

              // Create a request with a requestId for tracking
              const response = await this.sendRequest(clientId, {
                method: "tools/call",
                requestId,
                params: {
                  name: toolDef.name,
                  arguments: toolParams,
                  _meta: {}
                }
              });

              if (response.payload.error) {
                // If there was an error, return error response
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: response.payload.error
                    }
                  ],
                  _meta: {},
                  isError: true
                };
              }

              return response.payload.result ?? { content: [], _meta: {}, isError: false };
            } catch (error) {
              // Handle errors
              console.error(`Error forwarding tool request for ${toolDef.name}:`, error);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: error instanceof Error ? error.message : String(error)
                  }
                ],
                _meta: {},
                isError: true
              };
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
   * Get all tools for a specific client
   * @param clientId The client ID
   * @returns Array of tools for the client, or undefined if client not found
   */
  getToolsForClient(clientId: string): Tool[] | undefined {
    const client = this.clients.get(clientId);
    if (!client) {
      return undefined;
    }
    return Array.from(client.tools.values());
  }

  /**
   * Get all clients with their tools
   * @returns Map of client IDs to their tools
   */
  getAllClientsWithTools(): Map<string, Tool[]> {
    const result = new Map<string, Tool[]>();

    for (const [clientId, client] of this.clients.entries()) {
      result.set(clientId, Array.from(client.tools.values()));
    }

    return result;
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

  /**
   * Check if a client is connected via WebSocket
   * @param clientId The client ID to check
   * @returns True if the client is connected, false otherwise
   */
  public isClientConnected(clientId: string): boolean {
    return this.connectedClients.has(clientId);
  }

  /**
   * Store a transport used for an MCP server to enable reconnection support
   * @param clientId The client ID
   * @param transport The transport instance
   */
  public storeMcpServerTransport(clientId: string, transport: StreamableHTTPServerTransport): void {
    this.mcpServerTransports.set(clientId, transport);
  }

  /**
   * Handle HTTP request for an MCP client
   * @param clientId The client ID
   * @param req Express request object
   * @param res Express response object 
   */
  public async handleHttpRequest(clientId: string, req: Request, res: Response): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      console.error(`Client ${clientId} not found`);
      if (!res.headersSent) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32602,
            message: `Client ${clientId} not found`
          },
          id: null
        }));
      }
      return;
    }

    // Initialize the HTTP sessions map if it doesn't exist
    if (!client.httpSessions) {
      client.httpSessions = new Map();
    }

    try {
      // Special case for handling tools/list requests directly
      // This works around the timeout issue with StreamableHTTPServerTransport
      if (req.method === "POST") {
        // Read the request body
        const body = await new Promise<string>((resolve) => {
          let data = "";
          req.on("data", (chunk: Buffer) => (data += chunk.toString()));
          req.on("end", () => resolve(data));
        });

        try {
          const jsonRequest = JSON.parse(body);
          // Check if this is a tools/list request
          if (jsonRequest.method === "tools/list") {
            console.log(`Directly handling tools/list for client ${clientId}`);

            // Get the tools for this client
            const toolsList = Array.from(client.tools.values()).map(tool => ({
              name: tool.name,
              description: tool.description || "",
              inputSchema: tool.inputSchema
            }));

            // Send the response directly
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              result: {
                tools: toolsList
              },
              id: jsonRequest.id
            }));
            return;
          }
        } catch {
          // If we can't parse the body or it's not a tools/list request,
          // continue with normal processing
        }
      }

      // Extract session ID from request headers or create a new one
      let sessionId: string;
      if (typeof req.headers['x-mcp-session-id'] === 'string') {
        sessionId = req.headers['x-mcp-session-id'];
      } else if (Array.isArray(req.headers['x-mcp-session-id'])) {
        sessionId = req.headers['x-mcp-session-id'][0];
      } else {
        sessionId = uuidv4();
      }

      // Check if we have a session with this ID
      let session = client.httpSessions.get(sessionId);

      // Create a new session if needed
      if (!session) {
        console.log(`Creating new HTTP session ${sessionId} for client ${clientId}`);

        // Create a new transport with the session ID
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId
        });

        // Connect the MCP server to the new transport
        await client.mcpServer.connect(newTransport);

        // Store the new session
        client.httpSessions.set(sessionId, {
          transport: newTransport,
          lastAccess: Date.now()
        });

        session = client.httpSessions.get(sessionId)!;
      }

      // Add session ID header to response
      res.setHeader('X-MCP-Session-ID', sessionId);

      // Handle the request with this session's transport
      // Pass the original request directly without trying to read/buffer it
      await session.transport.handleRequest(req, res);

      // Update last access time
      session.lastAccess = Date.now();
    } catch (error) {
      console.error(`Unexpected error handling HTTP request for client ${clientId}:`, error);

      // Only send error response if headers haven't been sent already
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: `Unexpected error`
          },
          id: null
        }));
      }
    }
  }

  /**
   * Cleanup old HTTP sessions for all clients
   * Should be called periodically to prevent memory leaks
   * @param maxAgeMs Maximum age of sessions in milliseconds before they're cleaned up
   */
  public cleanupOldSessions(maxAgeMs: number = 3600000): void {
    const now = Date.now();

    this.clients.forEach((client, clientId) => {
      if (client.httpSessions) {
        const sessionsToRemove: string[] = [];

        // Find old sessions
        client.httpSessions.forEach((session, sessionId) => {
          if (now - session.lastAccess > maxAgeMs) {
            sessionsToRemove.push(sessionId);
          }
        });

        // Remove old sessions
        for (const sessionId of sessionsToRemove) {
          const session = client.httpSessions.get(sessionId);
          if (session) {
            try {
              // Close the transport if possible
              if (typeof session.transport.close === 'function') {
                session.transport.close();
              }
            } catch (error) {
              console.error(`Error closing transport for session ${sessionId}:`, error);
            }

            client.httpSessions.delete(sessionId);
            console.log(`Cleaned up old session ${sessionId} for client ${clientId}`);
          }
        }
      }
    });
  }
}
