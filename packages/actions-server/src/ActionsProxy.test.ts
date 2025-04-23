import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ActionsProxy } from "./ActionsProxy.js";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { WebSocket } from "ws";

interface ToolResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
    _meta: Record<string, unknown>;
    isError: boolean;
}

interface ToolRequest {
    type: 'TOOL_REQUEST';
    payload: {
        toolName: string;
        parameters: Record<string, unknown>;
        requestId: string;
    };
}

describe("ActionsProxy", () => {
    let server: ActionsProxy;
    let client: McpClient;
    let clientId: string;
    let wsPort: number;

    beforeEach(async () => {
        // Use a random port between 30000-40000
        wsPort = Math.floor(Math.random() * 10000) + 30000;
        server = new ActionsProxy(wsPort);

        // Register tools before connecting
        clientId = await server.registerTools([
            {
                name: "testTool",
                description: "A test tool",
                parameters: z.object({
                    input: z.string()
                })
            }
        ]);

        // Create client and connect
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        client = new McpClient({
            name: "test-client",
            version: "1.0.0",
            transport: clientTransport
        });

        // Connect after registering tools
        await Promise.all([
            client.connect(clientTransport),
            server.getMcpServer().server.connect(serverTransport)
        ]);
    });

    afterEach(async () => {
        server.close();
    });

    it("should register tools and allow MCP client to call them", async () => {
        // Connect WebSocket with clientId
        const ws = new WebSocket(`ws://localhost:${wsPort}?clientId=${clientId}`);
        await new Promise<void>((resolve) => ws.on("open", resolve));

        // Set up message listener for TOOL_REQUEST
        const requestPromise = new Promise<ToolRequest>((resolve) => {
            ws.on('message', (data: Buffer) => {
                const message = JSON.parse(data.toString());
                if (message.type === 'TOOL_REQUEST') {
                    resolve(message);
                }
            });
        });

        // Wait for client to be connected
        await new Promise<void>((resolve) => {
            const checkConnection = () => {
                if (server.isClientConnected(clientId)) {
                    resolve();
                } else {
                    setTimeout(checkConnection, 100);
                }
            };
            checkConnection();
        });

        // Call the tool
        const toolCallPromise = client.callTool({
            name: "testTool",
            arguments: {
                clientId,
                clientSecret: "test-secret",
                input: "test input"
            }
        });

        // Wait for TOOL_REQUEST
        const request = await requestPromise;

        // Send TOOL_RESPONSE
        ws.send(JSON.stringify({
            type: "TOOL_RESPONSE",
            payload: {
                requestId: request.payload.requestId,
                result: { success: true, input: request.payload.parameters.input }
            }
        }));

        // Wait for tool call result
        const result = await toolCallPromise as ToolResult;

        // Verify the response
        expect(result.isError).toBe(false);
        expect(result.content[0].text).toBe(JSON.stringify({ success: true, input: "test input" }));

        ws.close();
    });

    it("should handle tool execution errors", async () => {
        // Define a test tool
        const testTool = {
            name: "test-tool",
            description: "A test tool",
            parameters: z.object({
                input: z.string()
            })
        };

        // Register the tool
        await server.registerTools([testTool]);

        // Connect client and server using in-memory transport
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await Promise.all([
            client.connect(clientTransport),
            server.getMcpServer().server.connect(serverTransport)
        ]);

        // Call the tool with invalid client ID
        const result = await client.callTool({
            name: "test-tool",
            arguments: {
                clientId: "invalid-id",
                clientSecret: "test-secret",
                input: "test input"
            }
        }) as ToolResult;

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe("Client invalid-id not found");
    });

    it("should route messages only to the correct client", async () => {
        // Register two different clients with different tools
        const client1Id = await server.registerTools([
            {
                name: "client1Tool",
                description: "Tool for client 1",
                parameters: z.object({
                    input: z.string()
                })
            }
        ]);

        const client2Id = await server.registerTools([
            {
                name: "client2Tool",
                description: "Tool for client 2",
                parameters: z.object({
                    input: z.string()
                })
            }
        ]);

        // Create two WebSocket connections
        const ws1 = new WebSocket(`ws://localhost:${wsPort}?clientId=${client1Id}`);
        const ws2 = new WebSocket(`ws://localhost:${wsPort}?clientId=${client2Id}`);

        // Wait for both connections to open
        await Promise.all([
            new Promise<void>((resolve) => ws1.on("open", resolve)),
            new Promise<void>((resolve) => ws2.on("open", resolve))
        ]);

        // Set up message listeners for both clients
        const client1Messages: ToolRequest[] = [];
        const client2Messages: ToolRequest[] = [];

        ws1.on('message', (data: Buffer) => {
            const message = JSON.parse(data.toString());
            if (message.type === 'TOOL_REQUEST') {
                client1Messages.push(message);
            }
        });

        ws2.on('message', (data: Buffer) => {
            const message = JSON.parse(data.toString());
            if (message.type === 'TOOL_REQUEST') {
                client2Messages.push(message);
            }
        });

        // Wait for both clients to be connected
        await Promise.all([
            new Promise<void>((resolve) => {
                const checkConnection = () => {
                    if (server.isClientConnected(client1Id)) {
                        resolve();
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                checkConnection();
            }),
            new Promise<void>((resolve) => {
                const checkConnection = () => {
                    if (server.isClientConnected(client2Id)) {
                        resolve();
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                checkConnection();
            })
        ]);

        // Create MCP client and connect
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const mcpClient = new McpClient({
            name: "test-client",
            version: "1.0.0",
            transport: clientTransport
        });

        await Promise.all([
            mcpClient.connect(clientTransport),
            server.getMcpServer().server.connect(serverTransport)
        ]);

        // Call tools for both clients
        mcpClient.callTool({
            name: "client1Tool",
            arguments: {
                clientId: client1Id,
                clientSecret: "test-secret",
                input: "test input 1"
            }
        });

        mcpClient.callTool({
            name: "client2Tool",
            arguments: {
                clientId: client2Id,
                clientSecret: "test-secret",
                input: "test input 2"
            }
        });

        // Wait for messages to be received
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify that each client only received their own messages
        expect(client1Messages.length).toBe(1);
        expect(client2Messages.length).toBe(1);
        expect(client1Messages[0].payload.toolName).toBe("client1Tool");
        expect(client2Messages[0].payload.toolName).toBe("client2Tool");

        // Clean up
        ws1.close();
        ws2.close();
    });
}); 