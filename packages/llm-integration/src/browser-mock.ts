// Mock implementation for browser environment
export class MCPClient {
  constructor() {
    throw new Error("MCPClient is not supported in browser environment");
  }
}

export function createMCPClient() {
  throw new Error("MCPClient is not supported in browser environment");
}
