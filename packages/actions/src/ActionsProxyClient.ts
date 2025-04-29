import type {
  ToolRequestMessage,
  ToolResponseMessage
} from "@piddie/actions-server";
import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import { v4 as uuid } from "uuid";

export class ActionsProxyClient {
  private ws: WebSocket | null = null;
  private httpUrl: string;
  private wsUrl: string;
  private clientSecret: string;
  private clientId: string | null = null;
  private onToolCall: (
    toolName: string,
    params: Record<string, unknown>
  ) => Promise<CallToolResult>;

  constructor(
    httpUrl: string,
    wsUrl: string,
    onToolCall: (
      toolName: string,
      params: Record<string, unknown>
    ) => Promise<CallToolResult>
  ) {
    this.httpUrl = httpUrl;
    this.wsUrl = wsUrl;
    this.onToolCall = onToolCall;
    this.clientSecret = this.generateClientSecret();
  }

  private generateClientSecret(): string {
    return uuid();
  }

  async registerTools(tools: Tool[]): Promise<string> {
    const response = await fetch(`${this.httpUrl}/register-tools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(tools)
    });

    if (!response.ok) {
      throw new Error(`Failed to register tools: ${response.statusText}`);
    }

    const { clientId } = await response.json();
    this.clientId = clientId;
    return clientId;
  }

  /**
   * Add tools to an existing client registration
   * @param clientId The client ID to add tools to
   * @param tools The tools to add
   */
  async addTools(tools: Tool[]): Promise<void> {
    const response = await fetch(
      `${this.httpUrl}/add-tools?clientId=${this.clientId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(tools)
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to add tools: ${response.statusText}`);
    }
  }

  async connectWebSocket(clientId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}?clientId=${clientId}`);

      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };

      ws.onerror = (event: Event) => {
        reject(new Error("WebSocket connection failed"));
      };

      ws.onclose = () => {
        this.ws = null;
      };

      ws.onmessage = (event: MessageEvent) => {
        this.handleToolCall(event.data);
      };
    });
  }

  private async handleToolCall(data: string): Promise<void> {
    try {
      const message = JSON.parse(data) as ToolRequestMessage;
      if (message.type === "TOOL_REQUEST") {
        // Validate client secret
        if (message.payload.parameters.clientSecret !== this.clientSecret) {
          throw new Error("Invalid client secret");
        }

        // Strip out clientSecret before calling onToolCall
        const { clientSecret, ...params } = message.payload.parameters;

        const result = await this.onToolCall(message.payload.toolName, params);

        const response: ToolResponseMessage = {
          type: "TOOL_RESPONSE",
          payload: {
            requestId: message.payload.requestId,
            result
          }
        };

        this.ws?.send(JSON.stringify(response));
      }
    } catch (error) {
      if (!this.ws) return;

      const errorResponse: ToolResponseMessage = {
        type: "TOOL_RESPONSE",
        payload: {
          requestId: (JSON.parse(data) as ToolRequestMessage).payload.requestId,
          result: null,
          error: error instanceof Error ? error.message : String(error)
        }
      };

      this.ws.send(JSON.stringify(errorResponse));
    }
  }

  close(): void {
    this.ws?.close();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
