import { ZodObject } from "zod";

export interface ClientTool {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: ZodObject<any>;
}
export interface ToolRequestMessage {
  type: "TOOL_REQUEST";
  payload: {
    toolName: string;
    parameters: Record<string, unknown>;
    requestId: string;
  };
}
export interface ToolResponseMessage {
  type: "TOOL_RESPONSE";
  payload: {
    requestId: string;
    result: unknown;
    error?: string;
  };
}
