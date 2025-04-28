import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types";

/**
 * Request message for tool execution
 */
export interface ToolRequestMessage {
  type: "TOOL_REQUEST";
  payload: {
    toolName: string;
    parameters: Record<string, unknown>;
    requestId: string;
  };
}

/**
 * Response message for tool execution
 * Includes result that conforms to MCP CallToolResult type
 */
export interface ToolResponseMessage {
  type: "TOOL_RESPONSE";
  payload: {
    requestId: string;
    result: CallToolResult | null;
    error?: string;
  };
}

// Re-export relevant types from MCP SDK for convenience
export { CallToolResult, Tool };
