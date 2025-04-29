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

    // Store the transport in ActionsProxy for reconnection support
    actionsProxy.storeMcpServerTransport(clientId, transport);

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

/**
 * Reconnects to stdio after adding tools
 * This should be called after adding tools to a client
 * 
 * @param actionsProxy The ActionsProxy instance
 * @param clientId The client ID
 * @returns A promise that resolves when reconnected
 */
export async function reconnectToStdioAfterToolsAdded(
  actionsProxy: ActionsProxy,
  clientId: string
): Promise<void> {
  // First, check if the client is already connected
  const isConnected = actionsProxy.isClientConnected(clientId);

  // If the client isn't even WebSocket-connected, we don't need to do anything
  if (!isConnected) {
    return;
  }

  // Remove any existing transport for this client
  const existingTransport = activeTransports.get(clientId);
  if (existingTransport) {
    try {
      // We don't call close() on the transport as that would terminate the process
      // Just remove it from our tracking map
      activeTransports.delete(clientId);
      console.log(`Removed old transport for client ${clientId} for reconnection`);
    } catch (error) {
      console.error(`Error removing old transport for client ${clientId}:`, error);
    }
  }

  // Always create a new transport and connect
  await connectToStdio(actionsProxy, clientId);
  console.log(`Reconnected client ${clientId} to stdio after adding tools`);
}
