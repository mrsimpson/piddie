import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActionsManager } from "./ActionsManager";
import { ActionsProxyClient, ToolCallResult } from "./ActionsProxyClient";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpHost } from "./mcp/McpHost";
import { z } from "zod";

// Create a real mock instance instead of using vi.mock
class MockActionsProxyClient implements Partial<ActionsProxyClient> {
  registerTools = vi.fn().mockResolvedValue("generated-client-id");
  connectWebSocket = vi.fn().mockResolvedValue(undefined);
  close = vi.fn();

  constructor() {
    // This constructor is needed to match the real ActionsProxyClient
  }
}

// Mock McpHost
vi.mock("./mcp/McpHost", async () => {
  const actual =
    await vi.importActual<typeof import("./mcp/McpHost")>("./mcp/McpHost");
  const mockTools = [
    {
      name: "testTool",
      description: "A test tool",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string" }
        }
      }
    }
  ];

  const mockListTools = vi.fn().mockResolvedValue(mockTools);

  return {
    ...actual,
    McpHost: vi.fn().mockImplementation(() => ({
      registerLocalServer: vi.fn().mockResolvedValue(undefined),
      unregisterServer: vi.fn().mockReturnValue(true),
      listTools: mockListTools,
      executeToolCall: vi.fn().mockResolvedValue({ result: "success" })
    }))
  };
});

describe("ActionsManager", () => {
  let actionsManager: ActionsManager;
  let mockActionsProxyClient: MockActionsProxyClient;

  beforeEach(() => {
    vi.clearAllMocks();
    actionsManager = ActionsManager.getInstance();
    mockActionsProxyClient = new MockActionsProxyClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Remote server integration", () => {
    beforeEach(() => {
      actionsManager.setActionsProxyClient(
        mockActionsProxyClient as unknown as ActionsProxyClient
      );
    });

    it("should set actions proxy client", () => {
      expect(actionsManager["actionsProxyClient"]).toBe(mockActionsProxyClient);
    });

    it("should connect to actions server", async () => {
      await actionsManager.connectToActionsServer();

      // Verify registerTools was called with available tools
      expect(mockActionsProxyClient.registerTools).toHaveBeenCalledWith(
        expect.any(Array)
      );

      // Verify WebSocket connection was established with the generated client ID
      expect(mockActionsProxyClient.connectWebSocket).toHaveBeenCalledWith(
        "generated-client-id"
      );
      expect(actionsManager.isConnectedToActionsServer()).toBe(true);
    });

    it("should handle connection errors", async () => {
      const error = new Error("Connection failed");
      mockActionsProxyClient.connectWebSocket.mockRejectedValueOnce(error);

      await expect(actionsManager.connectToActionsServer()).rejects.toThrow(
        "Connection failed"
      );
      expect(actionsManager.isConnectedToActionsServer()).toBe(false);

      const status = actionsManager.getConnectionStatus();
      expect(status.status).toBe("error");
      expect(status.error).toBe("Connection failed");
    });

    it("should disconnect from actions server", () => {
      actionsManager.disconnect();

      expect(mockActionsProxyClient.close).toHaveBeenCalled();
      expect(actionsManager.isConnectedToActionsServer()).toBe(false);
    });

    it("should throw when connecting without a configured client", async () => {
      actionsManager.setActionsProxyClient(null);

      await expect(actionsManager.connectToActionsServer()).rejects.toThrow(
        "ActionsProxyClient not configured"
      );
    });

    it("should convert tools correctly", () => {
      const tool = {
        name: "testTool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            stringProp: { type: "string" },
            numberProp: { type: "number" },
            booleanProp: { type: "boolean" },
            customProp: { type: "custom" }
          }
        }
      };

      const clientTool = actionsManager["toolToClientTool"](tool);

      expect(clientTool.name).toBe("testTool");
      expect(clientTool.description).toBe("A test tool");
      expect(clientTool.parameters).toBeInstanceOf(z.ZodObject);
    });
  });
});
