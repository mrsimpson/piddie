import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { WebSocketServer, WebSocket } from "ws";
import { Tool, ToolResponseMessage, CallToolResult } from "./types";

interface ClientRegistration {
    clientId: string;
    tools: Map<string, Tool>;
    ws?: WebSocket;
}

export class ActionsProxy {
    private mcpServer: McpServer;
    private clients: Map<string, ClientRegistration> = new Map();
    private wss: WebSocketServer;
    private pendingRequests: Map<
        string,
        (response: ToolResponseMessage) => void
    > = new Map();
    private connectedClients: Map<string, ClientRegistration> = new Map();

    constructor(port: number = 9101) {
        this.mcpServer = new McpServer({
            name: "actions-server",
            version: "1.0.0"
        });

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
                ws.send(JSON.stringify({
                    type: "TOOL_REQUEST",
                    payload: request
                }));
            }
        });
    }

    /**
     * Register client tools and return clientId
     */
    async registerTools(tools: Tool[]): Promise<string> {
        const clientId = uuidv4();
        const clientTools = new Map<string, Tool>();

        // Register each tool with MCP server
        for (const toolDef of tools) {
            // Convert from our Tool to Zod schema for MCP server
            // Create a zod schema based on the tool's inputSchema
            const schemaObj: Record<string, z.ZodTypeAny> = {};

            if (toolDef.inputSchema.properties) {
                // Convert properties to zod schema
                Object.entries(toolDef.inputSchema.properties).forEach(([key, prop]) => {
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
                });
            }

            // Add authentication parameters required for this proxy
            const extendedSchema = {
                ...schemaObj,
                clientId: z.string(),
                clientSecret: z.string()
            };

            this.mcpServer.tool(
                toolDef.name,
                toolDef.description || toolDef.name,
                extendedSchema,
                async (params: Record<string, unknown>) => {
                    try {
                        const { clientId, clientSecret, ...toolParams } = params;

                        // Use type guard to ensure clientId is a string
                        if (typeof clientId !== 'string') {
                            throw new Error('Client ID must be a string');
                        }

                        const client = this.clients.get(clientId);

                        if (!client) {
                            throw new Error(`Client ${clientId} not found`);
                        }

                        const requestId = uuidv4();
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

            clientTools.set(toolDef.name, toolDef);
        }

        this.clients.set(clientId, {
            clientId,
            tools: clientTools
        });

        return clientId;
    }

    /**
     * Get the MCP server instance
     */
    getMcpServer(): McpServer {
        return this.mcpServer;
    }

    /**
     * Close the WebSocket server
     */
    close() {
        this.wss.close();
    }

    public isClientConnected(clientId: string): boolean {
        return this.connectedClients.has(clientId);
    }
}
