import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ActionsProxy } from "./ActionsProxy.js";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Tool } from "./types.js";
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
  type: "TOOL_REQUEST";
  payload: {
    method: "tools/call";
    requestId: string;
    params: {
      name: string;
      arguments: Record<string, unknown>;
      _meta: Record<string, unknown>;
    };
  };
}

describe("ActionsProxy", () => {
  let server: ActionsProxy;
  let clients: McpClient[] = [];
  let clientIds: string[] = [];
  let wsPort: number;
  let openWebSockets: WebSocket[] = [];
  let clientTransports: InMemoryTransport[] = [];
  let serverTransports: InMemoryTransport[] = [];

  beforeEach(async () => {
    // Use a random port between 30000-40000
    wsPort = Math.floor(Math.random() * 10000) + 30000;
    server = new ActionsProxy(wsPort);

    // Reset connection arrays
    clients = [];
    clientIds = [];
    openWebSockets = [];
    clientTransports = [];
    serverTransports = [];
  });

  afterEach(async () => {
    // First, close all WebSockets
    for (const ws of openWebSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }

    try {
      // Wait a bit to let the WebSocket close
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Close the server
      server.close();

      // Wait a bit for server to close
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      console.error("Error during test cleanup:", error);
    }
  });

  async function registerClientWithTools(
    tools: Tool[]
  ): Promise<{ clientId: string; mcpClient: McpClient }> {
    // Register tools to get a client ID
    const clientId = await server.registerTools(tools);
    clientIds.push(clientId);

    // Get the MCP server for this client
    const mcpServer = server.getMcpServerForClient(clientId);
    if (!mcpServer) {
      throw new Error(`MCP server not found for client ${clientId}`);
    }

    // Create client and connect
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    clientTransports.push(clientTransport);
    serverTransports.push(serverTransport);

    const mcpClient = new McpClient({
      name: "test-client",
      version: "1.0.0",
      transport: clientTransport
    });

    try {
      // Connect after registering tools
      await Promise.all([
        mcpClient.connect(clientTransport),
        mcpServer.server.connect(serverTransport)
      ]);

      clients.push(mcpClient);

      return { clientId, mcpClient };
    } catch (error) {
      console.error("Error connecting client:", error);
      throw error;
    }
  }

  it("should register tools and allow MCP client to call them", async () => {
    // Register client with tools
    const { clientId, mcpClient } = await registerClientWithTools([
      {
        name: "testTool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string" }
          }
        }
      } as Tool
    ]);

    // Connect WebSocket with clientId
    const ws = new WebSocket(`ws://localhost:${wsPort}?clientId=${clientId}`);
    openWebSockets.push(ws);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Set up message listener for TOOL_REQUEST
    const requestPromise = new Promise<ToolRequest>((resolve) => {
      ws.on("message", (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === "TOOL_REQUEST") {
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
    const toolCallPromise = mcpClient.callTool({
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
    ws.send(
      JSON.stringify({
        type: "TOOL_RESPONSE",
        payload: {
          requestId: request.payload.requestId,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  input: request.payload.params.arguments.input
                })
              }
            ],
            _meta: {},
            isError: false
          }
        }
      })
    );

    // Wait for tool call result
    const result = (await toolCallPromise) as ToolResult;

    // Verify the response
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe(
      JSON.stringify({ success: true, input: "test input" })
    );
  });

  it("should handle tool execution errors", async () => {
    // Register client with tools
    const { clientId, mcpClient } = await registerClientWithTools([
      {
        name: "test-tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string" }
          }
        }
      } as Tool
    ]);

    // Call the tool with invalid client ID
    const result = (await mcpClient.callTool({
      name: "test-tool",
      arguments: {
        clientId: "invalid-id",
        clientSecret: "test-secret",
        input: "test input"
      }
    })) as ToolResult;

    expect(result.isError).toBe(true);
    // We expect a Client ID mismatch error now since the tool is registered with a specific client ID
    expect(result.content[0].text).toContain("Client ID mismatch");
  });

  it("should route messages only to the correct client", async () => {
    // Register two different clients with different tools
    const { clientId: client1Id, mcpClient: mcpClient1 } =
      await registerClientWithTools([
        {
          name: "client1Tool",
          description: "Tool for client 1",
          inputSchema: {
            type: "object",
            properties: {
              input: { type: "string" }
            }
          }
        } as Tool
      ]);

    const { clientId: client2Id, mcpClient: mcpClient2 } =
      await registerClientWithTools([
        {
          name: "client2Tool",
          description: "Tool for client 2",
          inputSchema: {
            type: "object",
            properties: {
              input: { type: "string" }
            }
          }
        } as Tool
      ]);

    // Create two WebSocket connections
    const ws1 = new WebSocket(`ws://localhost:${wsPort}?clientId=${client1Id}`);
    const ws2 = new WebSocket(`ws://localhost:${wsPort}?clientId=${client2Id}`);
    openWebSockets.push(ws1, ws2);

    // Wait for both connections to open
    await Promise.all([
      new Promise<void>((resolve) => ws1.on("open", resolve)),
      new Promise<void>((resolve) => ws2.on("open", resolve))
    ]);

    // Set up message listeners for both clients
    const client1Messages: ToolRequest[] = [];
    const client2Messages: ToolRequest[] = [];

    ws1.on("message", (data: Buffer) => {
      const message = JSON.parse(data.toString());
      if (message.type === "TOOL_REQUEST") {
        client1Messages.push(message);
      }
    });

    ws2.on("message", (data: Buffer) => {
      const message = JSON.parse(data.toString());
      if (message.type === "TOOL_REQUEST") {
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

    // Setup response handlers
    ws1.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "TOOL_REQUEST") {
          ws1.send(
            JSON.stringify({
              type: "TOOL_RESPONSE",
              payload: {
                requestId: message.payload.requestId,
                result: {
                  content: [{ type: "text", text: "client1 response" }],
                  _meta: {},
                  isError: false
                }
              }
            })
          );
        }
      } catch (e) {
        console.error("Error in ws1 handler:", e);
      }
    });

    ws2.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "TOOL_REQUEST") {
          ws2.send(
            JSON.stringify({
              type: "TOOL_RESPONSE",
              payload: {
                requestId: message.payload.requestId,
                result: {
                  content: [{ type: "text", text: "client2 response" }],
                  _meta: {},
                  isError: false
                }
              }
            })
          );
        }
      } catch (e) {
        console.error("Error in ws2 handler:", e);
      }
    });

    // Call tools for both clients using their respective MCP clients
    mcpClient1
      .callTool({
        name: "client1Tool",
        arguments: {
          clientId: client1Id,
          clientSecret: "test-secret",
          input: "test input 1"
        }
      })
      .catch((e) => console.error("Error calling client1Tool:", e));

    mcpClient2
      .callTool({
        name: "client2Tool",
        arguments: {
          clientId: client2Id,
          clientSecret: "test-secret",
          input: "test input 2"
        }
      })
      .catch((e) => console.error("Error calling client2Tool:", e));

    // Wait for messages to be received
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify that each client only received their own messages
    expect(client1Messages.length).toBe(1);
    expect(client2Messages.length).toBe(1);
    expect(client1Messages[0].payload.params.name).toBe("client1Tool");
    expect(client2Messages[0].payload.params.name).toBe("client2Tool");
  });

  it("should ensure separate MCP servers are maintained for each client", async () => {
    // Register two clients
    const { clientId: client1Id, mcpClient: mcpClient1 } =
      await registerClientWithTools([
        {
          name: "sharedToolName", // Same tool name in both clients
          description: "Tool for client 1",
          inputSchema: {
            type: "object",
            properties: {
              input: { type: "string" }
            }
          }
        } as Tool
      ]);

    const { clientId: client2Id, mcpClient: mcpClient2 } =
      await registerClientWithTools([
        {
          name: "sharedToolName", // Same tool name in both clients
          description: "Tool for client 2",
          inputSchema: {
            type: "object",
            properties: {
              input: { type: "string" }
            }
          }
        } as Tool
      ]);

    // Connect WebSockets
    const ws1 = new WebSocket(`ws://localhost:${wsPort}?clientId=${client1Id}`);
    const ws2 = new WebSocket(`ws://localhost:${wsPort}?clientId=${client2Id}`);
    openWebSockets.push(ws1, ws2);

    await Promise.all([
      new Promise<void>((resolve) => ws1.on("open", resolve)),
      new Promise<void>((resolve) => ws2.on("open", resolve))
    ]);

    // Track which WS receives which message
    const messages: Record<string, any[]> = {
      [client1Id]: [],
      [client2Id]: []
    };

    ws1.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        messages[client1Id].push(message);

        // Auto-respond to tool requests
        if (message.type === "TOOL_REQUEST") {
          ws1.send(
            JSON.stringify({
              type: "TOOL_RESPONSE",
              payload: {
                requestId: message.payload.requestId,
                result: {
                  content: [{ type: "text", text: "client1 response" }],
                  _meta: {},
                  isError: false
                }
              }
            })
          );
        }
      } catch (e) {
        console.error("Error handling ws1 message:", e);
      }
    });

    ws2.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        messages[client2Id].push(message);

        // Auto-respond to tool requests
        if (message.type === "TOOL_REQUEST") {
          ws2.send(
            JSON.stringify({
              type: "TOOL_RESPONSE",
              payload: {
                requestId: message.payload.requestId,
                result: {
                  content: [{ type: "text", text: "client2 response" }],
                  _meta: {},
                  isError: false
                }
              }
            })
          );
        }
      } catch (e) {
        console.error("Error handling ws2 message:", e);
      }
    });

    // Call the sharedToolName for both clients
    const promise1 = mcpClient1
      .callTool({
        name: "sharedToolName",
        arguments: {
          clientId: client1Id,
          clientSecret: "test-secret",
          input: "client1 input"
        }
      })
      .catch((e) => console.error("Error calling client1 tool:", e));

    const promise2 = mcpClient2
      .callTool({
        name: "sharedToolName",
        arguments: {
          clientId: client2Id,
          clientSecret: "test-secret",
          input: "client2 input"
        }
      })
      .catch((e) => console.error("Error calling client2 tool:", e));

    // Wait for both promises to complete or timeout
    await Promise.race([
      Promise.all([promise1, promise2]),
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);

    // Check if messages were routed to the correct clients
    expect(messages[client1Id].length).toBeGreaterThan(0);
    expect(messages[client2Id].length).toBeGreaterThan(0);

    // In client1's message, the toolname should be "sharedToolName" but the input should be client1-specific
    const client1Request = messages[client1Id][0] as ToolRequest;
    expect(client1Request.payload.params.name).toBe("sharedToolName");
    expect(client1Request.payload.params.arguments.input).toBe("client1 input");

    // In client2's message, the toolname should be "sharedToolName" but the input should be client2-specific
    const client2Request = messages[client2Id][0] as ToolRequest;
    expect(client2Request.payload.params.name).toBe("sharedToolName");
    expect(client2Request.payload.params.arguments.input).toBe("client2 input");
  });
});
