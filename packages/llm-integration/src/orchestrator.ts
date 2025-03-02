import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LlmAdapter } from "./index";
import type {
  LlmMessage,
  LlmResponse,
  LlmProviderConfig,
  LlmStreamChunk,
  LlmClient
} from "./types";
import { LlmStreamEvent } from "./types";

/**
 * Orchestrator for LLM interactions
 * Manages LLM providers, MCP servers, and message processing
 */
export class Orchestrator implements LlmAdapter {
  private llmProviders: Map<string, LlmProviderConfig> = new Map();
  private mcpServers: Map<string, McpServer> = new Map();
  private client: LlmClient;

  /**
   * Creates a new Orchestrator
   * @param client The LLM client to use
   */
  constructor(client: LlmClient) {
    this.client = client;
  }

  /**
   * Registers an LLM provider with the orchestrator
   * @param name The name of the provider
   * @param config The provider configuration
   */
  registerLlmProvider(name: string, config: LlmProviderConfig): void {
    this.llmProviders.set(name, config);
  }

  /**
   * Gets an LLM provider by name
   * @param name The name of the provider
   * @returns The provider configuration or undefined if not found
   */
  getLlmProvider(name: string): LlmProviderConfig | undefined {
    return this.llmProviders.get(name);
  }

  /**
   * Unregisters an LLM provider from the orchestrator
   * @param name The name of the provider
   * @returns True if the provider was unregistered, false if it wasn't registered
   */
  unregisterLlmProvider(name: string): boolean {
    return this.llmProviders.delete(name);
  }

  /**
   * Register an MCP server
   * @param server The MCP server to register
   */
  registerMcpServer(server: any): void {
    const serverName =
      server.server && typeof server.server === "object"
        ? (server.server as any).name || "unknown"
        : "unknown";

    this.mcpServers.set(serverName, server);
  }

  /**
   * Gets an MCP server by name
   * @param name The name of the server
   * @returns The server or undefined if not found
   */
  getMcpServer(name: string): McpServer | undefined {
    return this.mcpServers.get(name);
  }

  /**
   * Unregisters an MCP server from the orchestrator
   * @param name The name of the server
   * @returns True if the server was unregistered, false if it wasn't registered
   */
  unregisterMcpServer(name: string): boolean {
    return this.mcpServers.delete(name);
  }

  /**
   * Processes a message by enhancing it with context and tools before sending to the LLM
   * @param message The message to process
   * @returns The LLM response
   */
  async processMessage(message: LlmMessage): Promise<LlmResponse> {
    // Enhance the message with system prompt if needed
    const enhancedMessage = this.enhanceMessage(message);

    // Process the message with the client
    return this.client.sendMessage(enhancedMessage);
  }

  /**
   * Processes a message by enhancing it with context and tools before streaming the response from the LLM
   * @param message The message to process
   * @param onChunk Callback for each chunk of the response
   * @returns The complete response from the LLM
   */
  async processMessageStream(
    message: LlmMessage,
    onChunk: (chunk: LlmStreamChunk) => void
  ): Promise<LlmResponse> {
    // Enhance the message with system prompt if needed
    const enhancedMessage = this.enhanceMessage(message);

    // Process the message with the client
    const stream = this.client.streamMessage(enhancedMessage);

    // Create a promise that resolves when the stream ends
    return new Promise<LlmResponse>((resolve, reject) => {
      // Set up event handlers
      stream.on(LlmStreamEvent.DATA, (data: unknown) => {
        onChunk(data as LlmStreamChunk);
      });

      stream.on(LlmStreamEvent.END, (data: unknown) => {
        resolve(data as LlmResponse);
      });

      stream.on(LlmStreamEvent.ERROR, (data: unknown) => {
        reject(data as Error);
      });
    });
  }

  /**
   * Enhances a message with system prompt and tool definitions
   * @param message The message to enhance
   * @returns The enhanced message
   */
  private enhanceMessage(message: LlmMessage): LlmMessage {
    // Clone the message to avoid modifying the original
    const enhancedMessage = { ...message };

    // Add system prompt if not already present
    if (!enhancedMessage.systemPrompt) {
      enhancedMessage.systemPrompt = this.generateSystemPrompt();
    }

    return enhancedMessage;
  }

  /**
   * Generates a system prompt that includes available MCP servers and their operations
   * @returns The generated system prompt
   */
  private generateSystemPrompt(): string {
    let prompt = "You are a helpful AI assistant. ";

    // Add MCP server information if available
    if (this.mcpServers.size > 0) {
      prompt += "You have access to the following tools:\n\n";

      // Add each MCP server's schema
      for (const [name, server] of this.mcpServers.entries()) {
        const schema = this.getServerSchema(server);
        prompt += `## ${name}\n`;
        prompt += `${schema.description || "No description available"}\n\n`;

        // Add operations
        if (schema.operations) {
          prompt += "### Operations\n\n";
          for (const [opName, operation] of Object.entries(schema.operations)) {
            prompt += `#### ${opName}\n`;

            // Safely access properties with type checking
            const opDescription =
              typeof operation === "object" &&
              operation !== null &&
              "description" in operation
                ? operation.description
                : "No description available";

            prompt += `${opDescription}\n\n`;

            // Add parameters if they exist and are properly structured
            if (
              typeof operation === "object" &&
              operation !== null &&
              "parameters" in operation
            ) {
              const parameters = operation.parameters;

              if (typeof parameters === "object" && parameters !== null) {
                prompt += "Parameters:\n";

                // Safely access required parameters
                const required =
                  "required" in parameters && Array.isArray(parameters.required)
                    ? parameters.required
                    : [];

                // Safely access properties
                if (
                  "properties" in parameters &&
                  typeof parameters.properties === "object" &&
                  parameters.properties !== null
                ) {
                  for (const [paramName, param] of Object.entries(
                    parameters.properties
                  )) {
                    const isRequired = required.includes(paramName);

                    // Safely access description
                    const paramDescription =
                      typeof param === "object" &&
                      param !== null &&
                      "description" in param
                        ? param.description
                        : "No description";

                    prompt += `- ${paramName}${isRequired ? " (required)" : ""}: ${paramDescription}\n`;
                  }
                }

                prompt += "\n";
              }
            }
          }
        }
      }
    }

    return prompt;
  }

  /**
   * Gets the schema for an MCP server
   * @param server The MCP server
   * @returns The schema object
   */
  private getServerSchema(server: McpServer): any {
    // Try to get the schema from the server
    try {
      // For FileManagementMcpServer that implements getSchema
      if ("getSchema" in server && typeof server.getSchema === "function") {
        return server.getSchema();
      }

      // For standard MCP servers, construct a basic schema
      const serverObj =
        server.server && typeof server.server === "object" ? server.server : {};
      return {
        name: (serverObj as any).name || "unknown",
        description:
          (serverObj as any).description || "No description available",
        operations: {} // We would need to extract operations from the server
      };
    } catch (error) {
      console.error("Error getting schema from server:", error);
      return {
        name: "unknown",
        description: "Failed to get schema",
        operations: {}
      };
    }
  }
}
