import { ActionsProxy } from "./ActionsProxy";
import { IncomingMessage as Request, ServerResponse as Response } from 'http';

const httpPort = parseInt(process.env.HTTP_PORT || "9100");
const wsPort = parseInt(process.env.WS_PORT || "9101");

const actionsProxy = new ActionsProxy(wsPort);

// Create HTTP server
import { createServer } from "http";
import { IncomingMessage, ServerResponse } from "http";
import { Tool } from "./types";

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

const httpServer = createServer(async (req: Request, res: Response) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle MCP client connections to a specific client's MCP server
  if (req.url?.startsWith("/mcp/") && (req.method === "GET" || req.method === "POST")) {
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

      // Log request body if it's a POST request to help debug tools/list issues
      if (req.method === "POST") {
        // Clone the request to read its body without consuming it
        const bodyPromise = new Promise<string>((resolve) => {
          let data = "";
          req.on("data", (chunk) => (data += chunk));
          req.on("end", () => resolve(data));
        });

        const body = await bodyPromise;
        try {
          const parsedBody = JSON.parse(body);
          if (parsedBody.method === "tools/list") {
            console.log("Received tools/list request for client", clientId);
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      // Forward the request directly to the handler - don't try to read the body
      await actionsProxy.handleHttpRequest(clientId, req, res);
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
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Start HTTP server
httpServer.listen(httpPort, () => {
  console.log(`Actions REST API running on port ${httpPort}`);
  console.log(`WebSocket server running on port ${wsPort}`);
  console.log(
    `Debug mode: ${process.env.NODE_ENV === "development" ? "enabled" : "disabled"}`
  );

  // Set up session cleanup to run every hour
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Run session cleanup periodically
  setInterval(() => {
    console.log("Running session cleanup");
    actionsProxy.cleanupOldSessions(SESSION_MAX_AGE_MS);
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
