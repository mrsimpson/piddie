import { ActionsProxy } from "./ActionsProxy.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Store transports to prevent garbage collection
const activeTransports = new Map<string, StdioServerTransport>();

/**
 * Connects a client's MCP server to stdio or another transport
 * This is necessary because each client has its own MCP server
 * that needs to be exposed to MCP clients.
 *
 * @param actionsProxy The ActionsProxy instance
 * @param clientId The client ID
 * @returns A promise that resolves when the MCP server is connected
 */
export async function connectToStdio(
  actionsProxy: ActionsProxy,
  clientId: string
): Promise<void> {
  // Get the MCP server for this client
  const mcpServer = actionsProxy.getMcpServerForClient(clientId);
  if (!mcpServer) {
    throw new Error(`MCP server not found for client ${clientId}`);
  }

  // Check if this client already has a transport
  if (activeTransports.has(clientId)) {
    console.log(`Client ${clientId} already has a transport`);
    return;
  }

  try {
    // Create a new transport for this client's MCP server
    // In production, we use StdioServerTransport to expose the MCP server
    // through the standard input/output streams
    const transport = new StdioServerTransport();

    // Store the transport to prevent garbage collection
    activeTransports.set(clientId, transport);

    // Connect the MCP server to the transport
    await mcpServer.connect(transport);

    console.log(`Connected MCP server for client ${clientId} to transport`);
  } catch (error) {
    console.error(`Error connecting MCP server for client ${clientId}:`, error);
    throw error;
  }
}

/**
 * Disconnects a client's MCP server from its transport
 * This should be called when a client is being removed
 *
 * @param clientId The client ID
 */
export function disconnectFromStdio(clientId: string): void {
  const transport = activeTransports.get(clientId);
  if (transport) {
    try {
      // Close the transport if it has a close method
      if (typeof transport.close === "function") {
        transport.close();
      }

      // Remove from active transports
      activeTransports.delete(clientId);

      console.log(
        `Disconnected MCP server for client ${clientId} from transport`
      );
    } catch (error) {
      console.error(`Error disconnecting client ${clientId}:`, error);
    }
  }
}
