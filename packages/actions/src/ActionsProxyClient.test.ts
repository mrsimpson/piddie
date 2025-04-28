import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ActionsProxyClient } from "./ActionsProxyClient";
import type { ToolRequestMessage } from "@piddie/actions-server";
import { Tool } from "@modelcontextprotocol/sdk/types";

describe("ActionsProxyClient", () => {
  let client: ActionsProxyClient;
  const mockOnToolCall = vi.fn();

  beforeEach(() => {
    client = new ActionsProxyClient(
      "http://localhost:55555",
      "ws://localhost:55556",
      mockOnToolCall
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should register tools", async () => {
    const tools: Tool[] = [
      {
        name: "test",
        description: "test",
        inputSchema: {
          type: "object",
          properties: {
            param: { type: "string" }
          }
        }
      }
    ];
    const expectedClientId = "generated-client-id";

    const mockResponse = new Response(JSON.stringify({ clientId: expectedClientId }), {
      status: 200,
      statusText: "OK"
    });

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const clientId = await client.registerTools(tools);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:55555/register-tools",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tools })
      })
    );

    // Verify the clientId was returned properly
    expect(clientId).toBe(expectedClientId);
  });

  it("should handle tool calls", async () => {
    const mockResult = {
      status: "success" as const,
      value: "result",
      timestamp: new Date()
    };

    mockOnToolCall.mockResolvedValue(mockResult);

    const mockWs = {
      send: vi.fn(),
      close: vi.fn(),
      onopen: null as any,
      onerror: null as any,
      onclose: null as any,
      onmessage: null as any
    };

    // Mock WebSocket constructor
    global.WebSocket = vi.fn().mockImplementation(() => mockWs);

    const clientId = "test-client";
    const connectPromise = client.connectWebSocket(clientId);

    // Simulate WebSocket open
    mockWs.onopen();
    await connectPromise;

    const toolCall: ToolRequestMessage = {
      type: "TOOL_REQUEST",
      payload: {
        toolName: "test",
        parameters: { param: "value", clientSecret: client["clientSecret"] },
        requestId: "123"
      }
    };

    // Simulate receiving a tool call
    await mockWs.onmessage({ data: JSON.stringify(toolCall) });

    expect(mockOnToolCall).toHaveBeenCalledWith("test", { param: "value" });
    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"TOOL_RESPONSE"')
    );

    // Test close
    client.close();
    expect(mockWs.close).toHaveBeenCalled();
  });

  it("should handle tool call errors", async () => {
    const error = new Error("Test error");
    mockOnToolCall.mockRejectedValue(error);

    const mockWs = {
      send: vi.fn(),
      close: vi.fn(),
      onopen: null as any,
      onerror: null as any,
      onclose: null as any,
      onmessage: null as any
    };

    global.WebSocket = vi.fn().mockImplementation(() => mockWs);

    const clientId = "test-client";
    const connectPromise = client.connectWebSocket(clientId);
    mockWs.onopen();
    await connectPromise;

    const toolCall: ToolRequestMessage = {
      type: "TOOL_REQUEST",
      payload: {
        toolName: "test",
        parameters: { param: "value", clientSecret: client["clientSecret"] },
        requestId: "123"
      }
    };

    await mockWs.onmessage({ data: JSON.stringify(toolCall) });

    expect(mockOnToolCall).toHaveBeenCalledWith("test", { param: "value" });
    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"error":"Test error"')
    );

    // Test close
    client.close();
    expect(mockWs.close).toHaveBeenCalled();
  });
});
