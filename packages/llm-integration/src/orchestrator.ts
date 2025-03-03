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
import type { ChatManager } from "@piddie/chat-management";
import { MessageStatus } from "@piddie/chat-management";
import { EventEmitter } from "@piddie/shared-types";

/**
 * Orchestrator for LLM interactions
 * Manages LLM providers, MCP servers, and message processing
 */
export class Orchestrator implements LlmAdapter {
  private llmProviders: Map<string, LlmProviderConfig> = new Map();
  private mcpServers: Map<string, McpServer> = new Map();
  private client: LlmClient;
  private chatManager: ChatManager;

  /**
   * Creates a new Orchestrator
   * @param client The LLM client to use
   * @param chatManager Optional chat manager to use, defaults to the global instance
   */
  constructor(client: LlmClient, chatManager: ChatManager) {
    this.client = client;
    this.chatManager = chatManager;
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
  registerMcpServer(server: McpServer, name: string): void {
    this.mcpServers.set(name, server);
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
    try {
      // Get chat history for context
      await this.chatManager.getChat(message.chatId);

      // Update message status to SENDING
      await this.chatManager.updateMessageStatus(
        message.chatId,
        message.id,
        MessageStatus.SENT
      );

      // Enhance the message with system prompt if needed
      const enhancedMessage = this.enhanceMessage(message);

      // Process the message with the client
      return this.client.sendMessage(enhancedMessage);
    } catch (error) {
      // Update message status to ERROR and wait for it to complete
      await this.chatManager.updateMessageStatus(
        message.chatId,
        message.id,
        MessageStatus.ERROR
      );

      // Re-throw the error after status update is complete
      throw error;
    }
  }

  /**
   * Processes a message by enhancing it with context and tools before streaming the response from the LLM
   * @param message The message to process
   * @param onChunk Optional callback for each chunk of the response
   * @returns The event emitter for the stream
   */
  async processMessageStream(
    message: LlmMessage,
    onChunk?: (chunk: LlmStreamChunk) => void
  ): Promise<EventEmitter> {
    // Create an event emitter for the stream
    const stream = new EventEmitter();

    try {
      // Get chat history for context
      await this.chatManager.getChat(message.chatId);

      // Enhance the message with system prompt if needed
      const enhancedMessage = this.enhanceMessage(message);

      // Process the message with the client
      const clientStream = this.client.streamMessage(enhancedMessage);

      // Forward events from the client stream to our stream
      clientStream.on(LlmStreamEvent.DATA, (data: unknown) => {
        if (onChunk) {
          onChunk(data as LlmStreamChunk);
        }
        stream.emit(LlmStreamEvent.DATA, data);
      });

      clientStream.on(LlmStreamEvent.END, (data: unknown) => {
        stream.emit(LlmStreamEvent.END, data);
      });

      clientStream.on(LlmStreamEvent.ERROR, (error: unknown) => {
        this.chatManager.updateMessageStatus(
          message.chatId,
          message.id,
          MessageStatus.ERROR
        );
        stream.emit(LlmStreamEvent.ERROR, error);
      });
    } catch (error) {
      // Update message status to ERROR
      await this.chatManager.updateMessageStatus(
        message.chatId,
        message.id,
        MessageStatus.ERROR
      );
      stream.emit(LlmStreamEvent.ERROR, error);
    }

    return stream;
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
      // for (const [name, server] of this.mcpServers.entries()) {
      //   const schema = this.getServerSchema(server);
      //   prompt += `## ${name}\n`;
      //   prompt += `${schema.description || "No description available"}\n\n`;

      //   // Add operations
      //   if (schema.operations) {
      //     prompt += "### Operations\n\n";
      //     for (const [opName, operation] of Object.entries(schema.operations)) {
      //       prompt += `#### ${opName}\n`;

      //       // Safely access properties with type checking
      //       const opDescription =
      //         typeof operation === "object" &&
      //         operation !== null &&
      //         "description" in operation
      //           ? operation.description
      //           : "No description available";

      //       prompt += `${opDescription}\n\n`;

      //       // Add parameters if they exist and are properly structured
      //       if (
      //         typeof operation === "object" &&
      //         operation !== null &&
      //         "parameters" in operation
      //       ) {
      //         const parameters = operation.parameters;

      //         if (typeof parameters === "object" && parameters !== null) {
      //           prompt += "Parameters:\n";

      //           // Safely access required parameters
      //           const required =
      //             "required" in parameters && Array.isArray(parameters.required)
      //               ? parameters.required
      //               : [];

      //           // Safely access properties
      //           if (
      //             "properties" in parameters &&
      //             typeof parameters.properties === "object" &&
      //             parameters.properties !== null
      //           ) {
      //             for (const [paramName, param] of Object.entries(
      //               parameters.properties
      //             )) {
      //               const isRequired = required.includes(paramName);

      //               // Safely access description
      //               const paramDescription =
      //                 typeof param === "object" &&
      //                 param !== null &&
      //                 "description" in param
      //                   ? param.description
      //                   : "No description";

      //               prompt += `- ${paramName}${isRequired ? " (required)" : ""}: ${paramDescription}\n`;
      //             }
      //           }

      //           prompt += "\n";
      //         }
      //       }
      //     }
      //   }
      // }
    }

    return prompt;
  }

  // /**
  //  * Gets the schema for an MCP server
  //  * @param server The MCP server
  //  * @returns The schema object
  //  */
  // private getServerSchema(server: McpServer): unknown {
  //   // Try to get the schema from the server
  //   try {
  //     // For FileManagementMcpServer that implements getSchema
  //     if ("getSchema" in server && typeof server.getSchema === "function") {
  //       return server.getSchema();
  //     }
  //     return undefined;

  //     //   // For standard MCP servers, construct a basic schema
  //     //   const serverObj =
  //     //     server.server && typeof server.server === "object" ? server.server : {};
  //     //   return {
  //     //     name: (serverObj as any).name || "unknown",
  //     //     description:
  //     //       (serverObj as any).description || "No description available",
  //     //     operations: {} // We would need to extract operations from the server
  //     //   };
  //   } catch (error) {
  //     console.error("Error getting schema from server:", error);
  //     return {
  //       name: "unknown",
  //       description: "Failed to get schema",
  //       operations: {}
  //     };
  //   }
  // }
}
