import { ActionsProxy } from "./ActionsProxy";

const httpPort = parseInt(process.env.HTTP_PORT || "9100");
const wsPort = parseInt(process.env.WS_PORT || "9101");

const actionsProxy = new ActionsProxy(wsPort);

// Create HTTP server
import { createServer } from "http";
import { IncomingMessage, ServerResponse } from "http";
import { Tool } from "./types";
import { connectToStdio, reconnectToStdioAfterToolsAdded } from "./clientManager";

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

const httpServer = createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/register-tools") {
    try {
      const tools = await readJsonBody(req);

      if (!validateToolsArray(tools, res)) {
        return;
      }

      const clientId = await actionsProxy.registerTools(tools);

      // Connect the client's MCP server to stdio
      await connectToStdio(actionsProxy, clientId);

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

      // First add the tools to the ActionsProxy
      await actionsProxy.addTools(clientId, tools);

      // Then force reconnect to stdio - this creates a fresh transport
      await reconnectToStdioAfterToolsAdded(actionsProxy, clientId);

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
});
