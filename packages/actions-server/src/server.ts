import { ActionsProxy } from "./ActionsProxy.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const httpPort = parseInt(process.env.HTTP_PORT || "9100");
const wsPort = parseInt(process.env.WS_PORT || "9101");

const actionsProxy = new ActionsProxy(wsPort);
const mcpServer = actionsProxy.getMcpServer();

// Connect MCP server to stdio transport
const transport = new StdioServerTransport();
await mcpServer.connect(transport);

// Create HTTP server
import { createServer } from "http";

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
            const body = await new Promise<string>((resolve) => {
                let data = "";
                req.on("data", (chunk) => (data += chunk));
                req.on("end", () => resolve(data));
            });

            const tools = JSON.parse(body);
            const clientId = await actionsProxy.registerTools(tools);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ clientId }));
        } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(error) }));
        }
    } else if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Actions server is running" }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

// Start HTTP server
httpServer.listen(httpPort, () => {
    console.log(`Actions REST API running on port ${httpPort}`);
});
