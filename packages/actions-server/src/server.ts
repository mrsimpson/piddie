import { ActionsProxy } from "./ActionsProxy.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const actionsProxy = new ActionsProxy();
const mcpServer = actionsProxy.getMcpServer();

// Connect MCP server to stdio transport
const transport = new StdioServerTransport();
await mcpServer.connect(transport);

// Create HTTP server
import { createServer } from "http";

const server = createServer(async (req, res) => {
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
    } else {
        res.writeHead(404);
        res.end();
    }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Actions server running on port ${port}`);
}); 