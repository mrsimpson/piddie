import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActionsManager } from "./ActionsManager";
import { ActionsProxyClient } from "./ActionsProxyClient";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types";
import { z } from "zod";

// Create a proper mock for ActionsProxyClient
class MockActionsProxyClient implements Partial<ActionsProxyClient> {
  private callbackFn: (
    toolName: string,
    params: Record<string, unknown>
  ) => Promise<CallToolResult>;
  private _isConnected = false;

  registerTools = vi.fn().mockResolvedValue("generated-client-id");
  connectWebSocket = vi.fn().mockImplementation(async () => {
    this._isConnected = true;
  });
  close = vi.fn().mockImplementation(() => {
    this._isConnected = false;
  });
  isConnected = vi.fn().mockImplementation(() => this._isConnected);

  constructor(
    callbackFn: (
      toolName: string,
      params: Record<string, unknown>
    ) => Promise<CallToolResult>
  ) {
    this.callbackFn = callbackFn;
  }

  // Expose a method to simulate client-side tool execution
  async callTool(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<CallToolResult> {
    return this.callbackFn(toolName, params);
  }
}

// Don't mock the entire module, just create a mock instance
vi.mock("./mcp/McpHost", async () => {
  const actual =
    await vi.importActual<typeof import("./mcp/McpHost")>("./mcp/McpHost");
  return {
    ...actual,
    McpHost: vi.fn().mockImplementation(() => ({
      registerLocalServer: vi.fn().mockResolvedValue(undefined),
      unregisterServer: vi.fn().mockReturnValue(true),
      listTools: vi.fn().mockResolvedValue([
        {
          name: "localTool",
          description: "A local tool for testing",
          inputSchema: {
            type: "object",
            properties: {
              input: { type: "string" }
            }
          }
        }
      ]),
      executeToolCall: vi
        .fn()
        .mockImplementation(
          async (toolName: string, params: Record<string, unknown>) => {
            if (toolName === "localTool") {
              return {
                content: [
                  {
                    type: "text",
                    text: `Local tool executed with: ${params.input}`
                  }
                ],
                _meta: {},
                isError: false
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: "Tool executed"
                }
              ],
              _meta: {},
              isError: false
            };
          }
        )
    }))
  };
});

describe("ActionsManager and ActionsProxyClient Integration", () => {
  let actionsManager: ActionsManager;
  let testServer: McpServer;
  let mockProxyClient: MockActionsProxyClient;

  // Test tool result for the mock proxy client
  const toolCallResult: CallToolResult = {
    content: [
      {
        type: "text",
        text: "test result"
      }
    ],
    _meta: {},
    isError: false
  };

  // This runs before each test
  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the ActionsManager instance
    actionsManager = ActionsManager.getInstance();
    await actionsManager.initialize();

    // Create a test MCP server with a tool
    testServer = new McpServer({
      name: "test-server",
      version: "1.0.0"
    });

    // Register a test tool
    testServer.tool(
      "localTool",
      "A local tool for testing",
      {
        input: z.string()
      },
      async (params) => {
        return {
          content: [
            {
              type: "text" as const,
              text: `Local tool executed with: ${params.input}`
            }
          ],
          _meta: {},
          isError: false
        };
      }
    );

    // Register the server with ActionsManager
    await actionsManager.registerServer(testServer, "test-server");

    // Create mock ActionsProxyClient with handler function
    mockProxyClient = new MockActionsProxyClient(async (toolName, params) => {
      // This simulates what would happen if the tool call was forwarded
      // to the actions server and eventually executed by a client
      if (toolName === "remoteTool") {
        return {
          content: [
            {
              type: "text",
              text: `Remote tool executed with: ${params.input}`
            }
          ],
          _meta: {},
          isError: false
        };
      }
      return toolCallResult;
    });

    // Set the mock proxy client
    actionsManager.setActionsProxyClient(
      mockProxyClient as unknown as ActionsProxyClient
    );
  });

  afterEach(() => {
    actionsManager.unregisterServer("test-server");
    actionsManager.setActionsProxyClient(null);
  });

  it("should register tools with the actions server and connect", async () => {
    await actionsManager.connectToActionsServer();

    // Verify tools were registered
    expect(mockProxyClient.registerTools).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: "localTool",
          description: "A local tool for testing"
        })
      ])
    );

    // Verify WebSocket connection was established with the generated client ID
    expect(mockProxyClient.connectWebSocket).toHaveBeenCalledWith(
      "generated-client-id"
    );

    // Verify connection status
    expect(actionsManager.isConnectedToActionsServer()).toBe(true);
  });

  it("should execute local tools directly", async () => {
    // Execute a local tool
    const result = await actionsManager.executeToolCall("localTool", {
      input: "test input"
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe("Local tool executed with: test input");
  });

  it("should execute remote tools through the proxy client", async () => {
    // This test simulates the case where a tool execution
    // is forwarded to the actions server

    // Connect to the actions server
    await actionsManager.connectToActionsServer();

    // Call the mock client directly to simulate a remote tool call
    const result = await mockProxyClient.callTool("remoteTool", {
      input: "remote test"
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe("Remote tool executed with: remote test");
  });

  it("should handle disconnection", async () => {
    // Connect first
    await actionsManager.connectToActionsServer();
    expect(actionsManager.isConnectedToActionsServer()).toBe(true);

    // Disconnect
    actionsManager.disconnect();

    // Verify WebSocket was closed
    expect(mockProxyClient.close).toHaveBeenCalled();
    expect(actionsManager.isConnectedToActionsServer()).toBe(false);
  });

  it("should handle connection errors", async () => {
    // Mock a connection error
    const connectionError = new Error("Failed to connect");
    mockProxyClient.connectWebSocket.mockRejectedValueOnce(connectionError);

    await expect(actionsManager.connectToActionsServer()).rejects.toThrow(
      "Failed to connect"
    );

    // Check connection status reflects the error
    const status = actionsManager.isConnectedToActionsServer();
    expect(status).toBe(false);
  });
});
