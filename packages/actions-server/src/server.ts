import { ActionsProxy } from "./ActionsProxy";
import { IncomingMessage as Request, ServerResponse as Response } from 'http';
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from 'crypto';
import { createServer } from "http";
import { IncomingMessage, ServerResponse } from "http";
import { Tool } from "./types";

const httpPort = parseInt(process.env.HTTP_PORT || "19100");
const wsPort = parseInt(process.env.WS_PORT || "19101");
const mcpPort = parseInt(process.env.MCP_PORT || "9200");

const actionsProxy = new ActionsProxy(wsPort);

/**
 * Validates that the input data is an array of Tool objects
 * @param data The data to validate
 * @param res The HTTP response object to send errors to
 * @returns true if data is valid, false otherwise (response is automatically sent on error)
 */
function validateToolsArray(
  data: unknown,
  res: ServerResponse
): data is Tool[] {
  // Validate that tools is an array
  if (!Array.isArray(data)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Request body must be an array of tools" })
    );
    return false;
  }

  // Validate that each tool has the required properties
  for (const tool of data) {
    if (!tool.name || typeof tool.name !== "string" || !tool.inputSchema) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Each tool must have a name (string) and inputSchema"
        })
      );
      return false;
    }
  }

  return true;
}

/**
 * Reads and parses the request body as JSON
 * @param req The HTTP request
 * @returns The parsed JSON body
 */
async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  const body = await new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

  return JSON.parse(body) as T;
}

// Map to store client-specific MCP sessions
const clientSessions: Map<string, Map<string, StreamableHTTPServerTransport>> = new Map();

const httpServer = createServer(async (req: Request, res: Response) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, X-MCP-Session-ID");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, X-MCP-Session-ID");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle MCP client connections to a specific client's MCP server
  if (req.url?.startsWith("/mcp/") && (req.method === "GET" || req.method === "POST" || req.method === "DELETE")) {
    console.log(`Received MCP request: ${req.method} ${req.url}`);

    try {
      // Extract clientId from URL path - format is /mcp/:clientId
      const clientId = req.url.split("/")[2];

      if (!clientId) {
        console.error("Missing clientId in MCP request path");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Missing clientId in path",
          jsonrpc: "2.0",
          id: null
        }));
        return;
      }

      // Check if the client exists in ActionsProxy
      const mcpServer = actionsProxy.getMcpServerForClient(clientId);
      if (!mcpServer) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: `Client ${clientId} not found`
          },
          id: null
        }));
        return;
      }

      // Handle the MCP request based on the HTTP method
      if (req.method === "POST") {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        // Get or create the sessions map for this client
        if (!clientSessions.has(clientId)) {
          clientSessions.set(clientId, new Map());
        }
        const clientSessionsMap = clientSessions.get(clientId)!;

        if (sessionId && clientSessionsMap.has(sessionId)) {
          // Reuse existing transport
          transport = clientSessionsMap.get(sessionId)!;
        } else {
          // Create a new transport
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              // Store the transport by session ID
              clientSessionsMap.set(newSessionId, transport);
              console.log(`Created new session ${newSessionId} for client ${clientId}`);

              // Store in ActionsProxy for reconnection support
              actionsProxy.storeMcpServerTransport(clientId, transport);
            },
          });

          // Clean up transport when closed
          transport.onclose = () => {
            if (transport.sessionId) {
              clientSessionsMap.delete(transport.sessionId);
            }
          };

          // Connect to the client's MCP server
          await mcpServer.connect(transport);
        }

        // Handle the request
        await transport.handleRequest(req, res);
      } else if (req.method === "GET" || req.method === "DELETE") {
        // Handle GET (SSE) and DELETE (session termination) requests
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (!sessionId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Missing mcp-session-id header"
            },
            id: null
          }));
          return;
        }

        const clientSessionsMap = clientSessions.get(clientId);
        if (!clientSessionsMap || !clientSessionsMap.has(sessionId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Invalid session ID"
            },
            id: null
          }));
          return;
        }

        const transport = clientSessionsMap.get(sessionId)!;
        await transport.handleRequest(req, res);
      }
    } catch (error) {
      console.error(`Error handling MCP request: ${error}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: String(error),
          jsonrpc: "2.0",
          id: null
        }));
      }
    }
    return;
  }

  if (req.method === "POST" && req.url === "/register-tools") {
    try {
      const tools = await readJsonBody(req);

      if (!validateToolsArray(tools, res)) {
        return;
      }

      const clientId = await actionsProxy.registerTools(tools);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ clientId }));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(error) }));
    }
  } else if (req.method === "POST" && req.url?.startsWith("/add-tools")) {
    try {
      // Extract clientId from query parameters
      const url = new URL(req.url, `http://${req.headers.host}`);
      const clientId = url.searchParams.get("clientId");

      if (!clientId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing clientId query parameter" }));
        return;
      }

      const tools = await readJsonBody(req);

      if (!validateToolsArray(tools, res)) {
        return;
      }

      await actionsProxy.addTools(clientId, tools);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(error) }));
    }
  } else if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Server is running" }));
  } else if (req.method === "GET" && req.url === "/clients") {
    // List all client IDs
    const clientIds = actionsProxy.getClientIds();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ clients: clientIds }));
  } else if (req.method === "GET" && req.url === "/status") {
    // Return detailed status information
    const clientIds = actionsProxy.getClientIds();
    const connectedClients = clientIds.filter(id => actionsProxy.isClientConnected(id));
    const sessionCounts = Array.from(clientSessions.entries()).map(([clientId, sessions]) => ({
      clientId,
      sessionCount: sessions.size
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "running",
      registeredClients: clientIds.length,
      connectedClients: connectedClients.length,
      sessions: sessionCounts
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Start HTTP server
httpServer.listen(httpPort, () => {
  console.log(`Actions REST API running on port ${httpPort}`);
  console.log(`WebSocket server running on port ${wsPort}`);
  console.log(`MCP endpoints available at /mcp/:clientId`);
  console.log(
    `Debug mode: ${process.env.NODE_ENV === "development" ? "enabled" : "disabled"}`
  );

  // Set up session cleanup to run every hour
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Run session cleanup periodically
  setInterval(() => {
    console.log("Running session cleanup");

    // Clean up ActionsProxy sessions
    actionsProxy.cleanupOldSessions(SESSION_MAX_AGE_MS);

    // Clean up MCP sessions
    const now = Date.now();
    for (const [clientId, sessions] of clientSessions.entries()) {
      for (const [sessionId, transport] of sessions.entries()) {
        // Check if the session has a lastAccess property and if it's too old
        const lastAccess = (transport as any).lastAccess || now;
        if (now - lastAccess > SESSION_MAX_AGE_MS) {
          try {
            if (typeof transport.close === 'function') {
              transport.close();
            }
            sessions.delete(sessionId);
            console.log(`Cleaned up old MCP session ${sessionId} for client ${clientId}`);
          } catch (error) {
            console.error(`Error closing transport for session ${sessionId}:`, error);
          }
        }
      }

      // Remove client entry if it has no sessions
      if (sessions.size === 0) {
        clientSessions.delete(clientId);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Add some startup logging to understand the registered tools better
  setTimeout(() => {
    const clientIds = actionsProxy.getClientIds();
    console.log(`Registered client IDs on startup: ${clientIds.join(', ') || 'none'}`);
    for (const clientId of clientIds) {
      const mcpServer = actionsProxy.getMcpServerForClient(clientId);
      if (mcpServer) {
        console.log(`Client ${clientId} has MCP server available: true`);
      } else {
        console.log(`Client ${clientId} has MCP server available: false`);
      }
    }
  }, 1000);
});
