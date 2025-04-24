import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, ZodObject } from "zod";
import { v4 as uuidv4 } from "uuid";
import { WebSocketServer, WebSocket } from "ws";

interface ClientTool {
    name: string;
    description: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: ZodObject<any>;
}

interface ClientRegistration {
    clientId: string;
    tools: Map<string, ClientTool>;
    ws?: WebSocket;
}

interface ToolRequest {
    type: 'TOOL_REQUEST';
    payload: {
        toolName: string;
        parameters: Record<string, unknown>;
        requestId: string;
    };
}

interface ToolResponse {
    type: 'TOOL_RESPONSE';
    payload: {
        requestId: string;
        result: unknown;
        error?: string;
    };
}

export class ActionsProxy {
    private mcpServer: McpServer;
    private clients: Map<string, ClientRegistration> = new Map();
    private wss: WebSocketServer;
    private pendingRequests: Map<string, (response: ToolResponse) => void> = new Map();
    private connectedClients: Map<string, ClientRegistration> = new Map();

    constructor(port: number = 9100) {
        this.mcpServer = new McpServer({
            name: "actions-server",
            version: "1.0.0"
        });

        console.log('Starting WebSocket server on port:', port);
        this.wss = new WebSocketServer({ port });
        this.setupWebSocketServer();
    }

    private setupWebSocketServer() {
        this.wss.on('connection', (ws: WebSocket, req) => {
            // Extract clientId from URL query params
            const url = new URL(req.url || '', 'ws://localhost');
            const clientId = url.searchParams.get('clientId');

            if (!clientId) {
                ws.close(1008, 'Missing clientId parameter');
                return;
            }

            const client = this.clients.get(clientId);
            if (!client) {
                ws.close(1008, 'Invalid clientId');
                return;
            }

            // Store the WebSocket connection so that we can send requests directly to the relevant socket
            client.ws = ws;
            this.connectedClients.set(clientId, client);

            ws.on('close', () => {
                this.connectedClients.delete(clientId);
            });

            ws.on('message', (message: Buffer) => {
                try {
                    const data = JSON.parse(message.toString()) as ToolResponse;
                    if (data.type === 'TOOL_RESPONSE') {
                        const { requestId } = data.payload;
                        const resolve = this.pendingRequests.get(requestId);
                        if (resolve) {
                            resolve(data);
                            this.pendingRequests.delete(requestId);
                        }
                    }
                } catch (error) {
                    console.error('Error handling WebSocket message:', error);
                }
            });
        });

        // Log any WebSocket server errors
        this.wss.on('error', (error) => {
            console.error('WebSocket server error:', error);
        });
    }

    private async sendRequest(clientId: string, request: ToolRequest): Promise<ToolResponse> {
        const client = this.connectedClients.get(clientId);
        if (!client || !client.ws) {
            throw new Error(`Client ${clientId} not connected`);
        }

        return new Promise((resolve) => {
            this.pendingRequests.set(request.payload.requestId, resolve);
            const ws = this.connectedClients.get(clientId)?.ws;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(request));
            }
        });
    }

    /**
     * Register client tools and return clientId
     */
    async registerTools(tools: ClientTool[]): Promise<string> {
        const clientId = uuidv4();
        const clientTools = new Map<string, ClientTool>();

        // Register each tool with MCP server
        for (const toolDef of tools) {
            const extendedParams = z.object({
                clientId: z.string(),
                clientSecret: z.string(),
                ...toolDef.parameters.shape
            });

            this.mcpServer.tool(
                toolDef.name,
                toolDef.description,
                extendedParams.shape,
                async (params: Record<string, unknown>) => {
                    try {
                        const { clientId, clientSecret, ...toolParams } = params;
                        const client = this.clients.get(clientId as string);

                        if (!client) {
                            throw new Error(`Client ${clientId} not found`);
                        }

                        const requestId = uuidv4();
                        const response = await this.sendRequest(clientId as string, {
                            type: 'TOOL_REQUEST',
                            payload: {
                                toolName: toolDef.name,
                                parameters: toolParams,
                                requestId
                            }
                        });

                        if (response.payload.error) {
                            throw new Error(response.payload.error);
                        }

                        return {
                            content: [{
                                type: "text" as const,
                                text: JSON.stringify(response.payload.result)
                            }],
                            _meta: {},
                            isError: false
                        };
                    } catch (error) {
                        return {
                            content: [{
                                type: "text" as const,
                                text: error instanceof Error ? error.message : String(error)
                            }],
                            _meta: {},
                            isError: true
                        };
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