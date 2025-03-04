import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Define Tool interface locally to avoid import issues
interface Tool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
  };
}

/**
 * Interface for a transport mechanism
 */
export interface Transport {
  /**
   * Send a message through the transport
   * @param message The message to send
   */
  send(message: Message): void;

  /**
   * Register a handler for incoming messages
   * @param handler The handler function
   */
  onMessage(handler: (message: Message) => void): void;
}

/**
 * Interface for a message
 */
export interface Message {
  /**
   * The message ID
   */
  id: string;

  /**
   * The JSON-RPC method
   */
  method?: string;

  /**
   * The JSON-RPC params
   */
  params?: Record<string, unknown>;

  /**
   * The JSON-RPC result
   */
  result?: unknown;

  /**
   * The JSON-RPC error
   */
  error?: unknown;

  /**
   * Whether this is a request or response
   */
  isRequest: boolean;

  /**
   * The JSON-RPC version
   */
  jsonrpc: string;

  /**
   * Index signature for additional properties
   */
  [key: string]: unknown;
}

/**
 * Interface for a client factory
 */
export interface ClientFactory {
  /**
   * Create a client for the given server
   * @param server The server to create a client for
   * @param transport The transport to use
   * @returns The client
   */
  createClient(server: McpServer, transport: Transport): void;
}

/**
 * Interface for an MCP connection
 */
export interface McpConnection {
  /**
   * The name of the connection
   */
  name: string;

  /**
   * The server for the connection (optional for external servers)
   */
  server?: McpServer;

  /**
   * The transport for the connection
   */
  transport: Transport;
}

/**
 * Type for a server that may be external or internal
 */
type MaybeExternalOrInternalServer = {
  listTools?: () => Promise<Tool[]>;
  handleRequest?: (
    request: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
};

/**
 * In-memory client factory
 */
export class InMemoryClientFactory implements ClientFactory {
  /**
   * Create a client for the given server
   * @param server The server to create a client for
   * @param transport The transport to use
   */
  createClient(server: McpServer, transport: Transport): void {
    // Connect the server to the transport
    transport.onMessage((message) => {
      if (!message.isRequest) {
        return;
      }

      // Handle the request
      if (message["method"] === "mcp.list_tools") {
        // Get the tools from the server
        this.handleListTools(server, transport, message);
      } else if (message["method"] === "mcp.call_tool") {
        // Call the tool on the server
        this.handleCallTool(server, transport, message);
      }
    });
  }

  /**
   * Handle a list_tools request
   * For in-memory-servers, we need to provide the metadata of the tools ourselves
   * @param server The server
   * @param transport The transport
   * @param message The message
   */
  private handleListTools(
    server: McpServer,
    transport: Transport,
    message: Message
  ): void {
    console.log("[InMemoryClientFactory] Handling list_tools request");

    try {
      const maybeServer = server as unknown as MaybeExternalOrInternalServer;

      // First try the standard MCP SDK approach
      if (
        typeof maybeServer.listTools === "function" &&
        !!maybeServer.listTools
      ) {
        console.log("[InMemoryClientFactory] Using server.listTools method");

        // Call the server's listTools method
        Promise.resolve(maybeServer.listTools())
          .then((tools: Tool[]) => {
            console.log(
              `[InMemoryClientFactory] Got ${tools.length} tools from server.listTools`
            );
            // Send the response
            transport.send({
              id: message["id"],
              result: tools,
              isRequest: false,
              jsonrpc: "2.0"
            });
          })
          .catch((error: unknown) => {
            console.error(
              "[InMemoryClientFactory] Error from server.listTools:",
              error
            );
            // Send the error
            transport.send({
              id: message["id"],
              error: {
                code: -32000,
                message: `Error listing tools: ${error instanceof Error ? error.message : String(error)}`
              },
              isRequest: false,
              jsonrpc: "2.0"
            });
          });
        return;
      }

      // Fallback to handleRequest method
      if (
        typeof maybeServer.handleRequest === "function" &&
        !!maybeServer.handleRequest
      ) {
        console.log(
          "[InMemoryClientFactory] Using server.handleRequest method"
        );
        // Create a request for the server
        const request = {
          operation: "list_tools",
          params: {}
        };

        // Call the server's handleRequest method
        Promise.resolve(maybeServer.handleRequest(request))
          .then((result: Record<string, unknown>) => {
            const tools = result["result"] || [];
            console.log(
              `[InMemoryClientFactory] Got tools from handleRequest: ${Array.isArray(tools) ? tools.length : "not an array"}`
            );
            // Send the response
            transport.send({
              id: message["id"],
              result: tools,
              isRequest: false,
              jsonrpc: "2.0"
            });
          })
          .catch((error: unknown) => {
            console.error(
              "[InMemoryClientFactory] Error from handleRequest:",
              error
            );
            // Send the error
            transport.send({
              id: message["id"],
              error: {
                code: -32000,
                message: `Error listing tools: ${error instanceof Error ? error.message : String(error)}`
              },
              isRequest: false,
              jsonrpc: "2.0"
            });
          });
        return;
      }

      // If we get here, the server doesn't support either method
      console.warn(
        "[InMemoryClientFactory] Server does not support listTools or handleRequest methods"
      );
      // Send an empty array instead of an error to avoid breaking the flow
      transport.send({
        id: message["id"],
        result: [],
        isRequest: false,
        jsonrpc: "2.0"
      });
    } catch (error) {
      console.error(
        "[InMemoryClientFactory] Unexpected error in handleListTools:",
        error
      );
      // Send an empty array instead of an error
      transport.send({
        id: message["id"],
        result: [],
        isRequest: false,
        jsonrpc: "2.0"
      });
    }
  }

  /**
   * Handle a call_tool request
   * @param server The server
   * @param transport The transport
   * @param message The message
   */
  private handleCallTool(
    server: McpServer,
    transport: Transport,
    message: Message
  ): void {
    // Get the params
    const params = message["params"] || {};

    // Create a request for the server
    const request = {
      operation: params["name"] as string,
      params: params["arguments"] || {}
    };

    const maybeServer = server as unknown as MaybeExternalOrInternalServer;

    // Check if the server has a handleRequest method
    if (
      typeof maybeServer.handleRequest === "function" &&
      !!maybeServer.handleRequest
    ) {
      // Call the server's handleRequest method
      maybeServer
        .handleRequest(request)
        .then((result: Record<string, unknown>) => {
          // Send the response
          transport.send({
            id: message["id"],
            result: result["result"] || {},
            isRequest: false,
            jsonrpc: "2.0"
          });
        })
        .catch((error: Error) => {
          // Send the error
          transport.send({
            id: message["id"],
            error: {
              code: -32000,
              message: `Error calling tool: ${error instanceof Error ? error.message : String(error)}`
            },
            isRequest: false,
            jsonrpc: "2.0"
          });
        });
    } else {
      // Send an error if handleRequest is not available
      transport.send({
        id: message["id"],
        error: {
          code: -32000,
          message: "Server does not support handleRequest method"
        },
        isRequest: false,
        jsonrpc: "2.0"
      });
    }
  }
}

/**
 * MCP host for managing connections to MCP servers
 */
export class McpHost {
  /**
   * The connections
   */
  private connections: Map<string, McpConnection> = new Map();

  /**
   * The client factory
   */
  private clientFactory: ClientFactory;

  /**
   * Creates a new MCP host
   * @param clientFactory The client factory to use
   */
  constructor(clientFactory?: ClientFactory) {
    this.clientFactory = clientFactory || new InMemoryClientFactory();
  }

  /**
   * Register a local server with in-memory transport
   * @param server The server to register
   * @param name The name of the server
   * @param transport The transport to use
   */
  registerLocalServer(
    server: McpServer,
    name: string,
    transport: Transport
  ): void {
    // Create a connection
    const connection: McpConnection = {
      name,
      server,
      transport
    };

    // Add the connection
    this.connections.set(name, connection);

    // Create a client for the server
    this.clientFactory.createClient(server, transport);
  }

  /**
   * Register an external server with custom transport
   * @param name The name of the server
   * @param transport The transport to use
   */
  registerExternalServer(name: string, transport: Transport): void {
    // Create a connection
    const connection: McpConnection = {
      name,
      transport
    };

    // Add the connection
    this.connections.set(name, connection);
  }

  /**
   * Get a connection by name
   * @param name The name of the connection
   * @returns The connection or undefined if not found
   */
  getConnection(name: string): McpConnection | undefined {
    return this.connections.get(name);
  }

  /**
   * List all tools from all servers
   * @returns A promise that resolves to an array of tools
   */
  async listTools(): Promise<Tool[]> {
    console.log(
      `[McpHost] Listing tools from ${this.connections.size} connections`
    );

    // If no connections, return empty array immediately
    if (this.connections.size === 0) {
      console.log(
        "[McpHost] No connections available, returning empty tools array"
      );
      return [];
    }

    // Get all tools from all servers
    const toolPromises = Array.from(this.connections.entries()).map(
      async ([connectionName, connection]) => {
        try {
          console.log(
            `[McpHost] Requesting tools from connection: ${connectionName}`
          );

          // Create a message
          const message: Message = {
            id: this.generateId(),
            method: "mcp.list_tools",
            params: {},
            isRequest: true,
            jsonrpc: "2.0"
          };

          // Send the message and wait for the response with a timeout
          return await Promise.race([
            new Promise<Tool[]>((resolve, reject) => {
              // Create a response handler
              const responseHandler = (response: Message) => {
                console.log(
                  `[McpHost] Received response for connection ${connectionName}:`,
                  response.isRequest ? "request" : "response",
                  "id match:",
                  response["id"] === message["id"]
                );

                // Check if this is a response to our message
                if (response["id"] === message["id"] && !response.isRequest) {
                  // Remove the handler
                  connection.transport.onMessage = () => {};

                  // Resolve or reject
                  if (response["error"]) {
                    console.error(
                      `[McpHost] Error from ${connectionName}:`,
                      response["error"]
                    );
                    reject(response["error"]);
                  } else {
                    const tools = (response["result"] as Tool[]) || [];
                    console.log(
                      `[McpHost] Got ${tools.length} tools from ${connectionName}`
                    );
                    resolve(tools);
                  }
                }
              };

              // Register the response handler
              connection.transport.onMessage(responseHandler);

              // Send the message
              console.log(
                `[McpHost] Sending list_tools request to ${connectionName}`
              );
              connection.transport.send(message);
            }),
            // Add a timeout to prevent hanging
            new Promise<Tool[]>((_, reject) => {
              setTimeout(() => {
                console.error(
                  `[McpHost] Timeout waiting for tools from ${connectionName}`
                );
                reject(
                  new Error(`Timeout waiting for tools from ${connectionName}`)
                );
              }, 5000); // 5 second timeout
            })
          ]);
        } catch (error) {
          console.error(
            `[McpHost] Error listing tools for ${connectionName}:`,
            error
          );
          // Return empty array for this connection to avoid breaking the whole process
          return [];
        }
      }
    );

    try {
      // Wait for all tools with a fallback
      const toolArrays = await Promise.all(toolPromises);

      // Flatten the arrays
      const allTools = toolArrays.flat();
      console.log(`[McpHost] Total tools collected: ${allTools.length}`);
      return allTools;
    } catch (error) {
      console.error("[McpHost] Error collecting tools:", error);
      // Return whatever tools we have instead of failing completely
      return [];
    }
  }

  /**
   * Call a tool
   * @param name The name of the tool
   * @param args The arguments for the tool
   * @returns A promise that resolves to the result of the tool
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // Find a server that has this tool
    for (const connection of this.connections.values()) {
      try {
        // Create a message
        const message: Message = {
          id: this.generateId(),
          method: "mcp.call_tool",
          params: {
            name,
            arguments: args
          },
          isRequest: true,
          jsonrpc: "2.0"
        };

        // Send the message and wait for the response
        const result = await new Promise<unknown>((resolve, reject) => {
          // Create a response handler
          const responseHandler = (response: Message) => {
            // Check if this is a response to our message
            if (response["id"] === message["id"] && !response.isRequest) {
              // Remove the handler
              connection.transport.onMessage = () => {};

              // Resolve or reject
              if (response["error"]) {
                reject(response["error"]);
              } else {
                resolve(response["result"]);
              }
            }
          };

          // Register the response handler
          connection.transport.onMessage(responseHandler);

          // Send the message
          connection.transport.send(message);
        });

        // Return the result
        return result;
      } catch (error) {
        console.error(
          `Error calling tool ${name} on ${connection.name}:`,
          error
        );
        // Continue to the next server
      }
    }

    // No server could handle the tool
    throw new Error(`No server found that can handle tool ${name}`);
  }

  /**
   * Generate a unique ID for messages
   * @returns A unique ID
   */
  private generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
