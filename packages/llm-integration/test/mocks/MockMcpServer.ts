/**
 * Mock MCP server for testing
 * This is a simplified version that directly mocks the McpServer interface
 * without relying on the actual transport mechanism
 */
export class MockMcpServer {
  private tools: Map<string, (args: Record<string, unknown>) => unknown> =
    new Map();
  private callHistory: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  private name: string;
  private connected = false;

  /**
   * Creates a new MockMcpServer
   * @param name The name of the server
   */
  constructor(name: string) {
    this.name = name;
  }

  /**
   * Mock implementation of connect method
   * This doesn't actually use the transport but just marks the server as connected
   */
  async connect(transport: any): Promise<void> {
    this.connected = true;
    // Immediately resolve any pending requests to avoid timeouts
    if (typeof transport.start === "function") {
      await transport.start();
    }
    return Promise.resolve();
  }

  /**
   * Mock implementation of close method
   */
  async close(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  /**
   * Registers a tool with the server
   * @param name The name of the tool
   * @param handler The function to handle tool calls
   */
  registerTool(
    name: string,
    handler: (args: Record<string, unknown>) => unknown
  ): void {
    this.tools.set(name, handler);
  }

  /**
   * Simulates calling a tool
   * @param name The name of the tool
   * @param args The arguments for the tool
   * @returns The result of the tool call
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // Check for duplicate calls - only add to history if this exact call hasn't been made
    const isDuplicate = this.callHistory.some(
      (call) =>
        call.name === name && JSON.stringify(call.args) === JSON.stringify(args)
    );

    if (!isDuplicate) {
      this.callHistory.push({ name, args });
    }

    const handler = this.tools.get(name);
    if (!handler) {
      throw new Error(`Tool ${name} not found`);
    }

    return handler(args);
  }

  /**
   * Gets the list of registered tools
   * @returns The list of tools
   */
  async listTools(): Promise<
    Array<{
      name: string;
      description: string;
      inputSchema: {
        type: string;
        properties: Record<string, unknown>;
      };
    }>
  > {
    return Array.from(this.tools.keys()).map((name) => ({
      name,
      description: `Mock tool: ${name}`,
      inputSchema: {
        type: "object",
        properties: {}
      }
    }));
  }

  /**
   * Gets the call history for a tool
   * @param name The name of the tool
   * @returns The call history for the tool
   */
  getToolCallHistory(
    name?: string
  ): Array<{ name: string; args: Record<string, unknown> }> {
    if (name) {
      return this.callHistory.filter((call) => call.name === name);
    }
    return this.callHistory;
  }

  /**
   * Clears the call history
   */
  clearCallHistory(): void {
    this.callHistory = [];
  }

  /**
   * Gets the name of the server
   * @returns The name of the server
   */
  getName(): string {
    return this.name;
  }

  /**
   * Checks if the server is connected
   * @returns True if the server is connected, false otherwise
   */
  isConnected(): boolean {
    return this.connected;
  }
}
