import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmStreamChunk,
  LlmProviderConfig
} from "./types";
import { McpHost } from "./mcp";
import type { Transport } from "./mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EventEmitter } from "@piddie/shared-types";
import { InMemoryTransport } from "./mcp/InMemoryTransport";

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
 * Interface for tool call in LLM responses
 */
interface ToolCall {
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

/**
 * Extended LLM response with tool results
 */
interface LlmResponseWithToolResults extends LlmResponse {
  toolResults?: unknown[];
}

/**
 * Orchestrator for LLM interactions
 * Manages LLM providers and MCP servers
 */
export class Orchestrator {
  private llmProviders: Map<string, LlmProviderConfig> = new Map();
  private mcpHost: McpHost;
  private client: LlmClient;

  /**
   * Creates a new Orchestrator
   * @param client The LLM client to use
   */
  constructor(client: LlmClient) {
    this.client = client;
    this.mcpHost = new McpHost();
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
   * Registers a local MCP server with the orchestrator
   * @param server The MCP server to register
   * @param name The name of the server
   */
  registerLocalMcpServer(server: McpServer, name: string): void {
    const transport = new InMemoryTransport();
    this.mcpHost.registerLocalServer(server, name, transport);
  }

  /**
   * Register an external MCP server with custom transport
   * @param name The name of the server
   * @param transport The transport to use
   */
  registerExternalMcpServer(name: string, transport: Transport): void {
    this.mcpHost.registerExternalServer(name, transport);
  }

  /**
   * Register an MCP server (backward compatibility)
   * @param server The MCP server to register
   * @param name The name to register the server under
   */
  registerMcpServer(server: McpServer, name: string): void {
    this.registerLocalMcpServer(server, name);
  }

  /**
   * Get an MCP server by name
   * @param name The name of the server
   * @returns The server or undefined if not found
   */
  getMcpServer(name: string): McpServer | undefined {
    const connection = this.mcpHost.getConnection(name);
    return connection?.server;
  }

  /**
   * Unregister an MCP server
   * @param name The name of the server
   * @returns True if the server was unregistered, false if it wasn't registered
   */
  unregisterMcpServer(name: string): boolean {
    // This is a simplified implementation
    // In a real implementation, you would need to close the connection
    return this.mcpHost.getConnection(name) !== undefined;
  }

  /**
   * Process a message using the LLM client
   * @param message The message to process
   * @returns The response from the LLM
   */
  async processMessage(message: LlmMessage): Promise<LlmResponse> {
    try {
      console.log("[Orchestrator] Processing message");

      // Get available tools
      let tools: Tool[] = [];
      try {
        console.log("[Orchestrator] Listing tools");
        tools = (await this.mcpHost.listTools()) as Tool[];
        console.log(`[Orchestrator] Got ${tools.length} tools`);
      } catch (toolError) {
        console.error("[Orchestrator] Error listing tools:", toolError);
        // Continue without tools rather than failing the entire request
        tools = [];
      }

      // Enhance the message with tools (if any)
      const enhancedMessage = {
        ...message,
        tools:
          tools.length > 0
            ? tools.map((tool: Tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema
                }
              }))
            : undefined
      };

      console.log("[Orchestrator] Sending message to LLM");
      // Process the message
      const response = await this.client.sendMessage(enhancedMessage);
      console.log("[Orchestrator] Received response from LLM");

      // Handle tool calls if present
      if (response.tool_calls && response.tool_calls.length > 0) {
        console.log(
          `[Orchestrator] Processing ${response.tool_calls.length} tool calls`
        );
        // Execute each tool call
        const toolResults = await Promise.all(
          response.tool_calls.map(async (call: ToolCall) => {
            const toolInfo = tools.find(
              (t: Tool) => t.name === call.function.name
            );
            if (!toolInfo) {
              console.warn(
                `[Orchestrator] Tool ${call.function.name} not found`
              );
              throw new Error(`Tool ${call.function.name} not found`);
            }

            console.log(`[Orchestrator] Calling tool: ${call.function.name}`);
            // Call the tool using the new callTool method
            return this.mcpHost.callTool(
              call.function.name,
              typeof call.function.arguments === "string"
                ? JSON.parse(call.function.arguments)
                : call.function.arguments
            );
          })
        );

        console.log("[Orchestrator] Tool calls completed");
        // Include tool results in the response
        (response as LlmResponseWithToolResults).toolResults = toolResults;
      }

      return response;
    } catch (error) {
      console.error("[Orchestrator] Error processing message:", error);
      throw error;
    }
  }

  /**
   * Process a message using the LLM client with streaming
   * @param message The message to process
   * @param onChunk Optional callback for each chunk
   * @returns An event emitter for the stream
   */
  async processMessageStream(
    message: LlmMessage,
    onChunk?: (chunk: LlmStreamChunk) => void
  ): Promise<EventEmitter> {
    try {
      console.log("[Orchestrator] Processing message stream");

      // Get available tools
      let tools: Tool[] = [];
      try {
        console.log("[Orchestrator] Listing tools for stream");
        tools = (await this.mcpHost.listTools()) as Tool[];
        console.log(`[Orchestrator] Got ${tools.length} tools for stream`);
      } catch (toolError) {
        console.error(
          "[Orchestrator] Error listing tools for stream:",
          toolError
        );
        // Continue without tools rather than failing the entire request
        tools = [];
      }

      // Enhance the message with tools (if any)
      const enhancedMessage = {
        ...message,
        tools:
          tools.length > 0
            ? tools.map((tool: Tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema
                }
              }))
            : undefined
      };

      console.log("[Orchestrator] Starting stream from LLM");
      // Process the message with streaming
      const emitter = await this.client.streamMessage(enhancedMessage);

      // Create a new emitter to handle tool calls
      const newEmitter = new EventEmitter();

      // Collect tool calls
      let toolCalls: ToolCall[] = [];

      // Handle chunks
      emitter.on("data", (data: unknown) => {
        const chunk = data as LlmStreamChunk;

        // Pass the chunk to the callback
        if (onChunk) {
          onChunk(chunk);
        }

        // Emit the chunk
        newEmitter.emit("data", chunk);

        // Collect tool calls if present
        if (chunk.tool_calls) {
          toolCalls = [...toolCalls, ...chunk.tool_calls];
        }
      });

      // Handle the end of the stream
      emitter.on("end", async () => {
        try {
          // Execute tool calls if present
          if (toolCalls.length > 0) {
            console.log(
              `[Orchestrator] Processing ${toolCalls.length} tool calls from stream`
            );
            // Execute each tool call
            const toolResults = await Promise.all(
              toolCalls.map(async (call: ToolCall) => {
                const toolInfo = tools.find(
                  (t: Tool) => t.name === call.function.name
                );
                if (!toolInfo) {
                  console.warn(
                    `[Orchestrator] Tool ${call.function.name} not found in stream`
                  );
                  throw new Error(`Tool ${call.function.name} not found`);
                }

                console.log(
                  `[Orchestrator] Calling tool from stream: ${call.function.name}`
                );
                // Call the tool using the new callTool method
                return this.mcpHost.callTool(
                  call.function.name,
                  typeof call.function.arguments === "string"
                    ? JSON.parse(call.function.arguments)
                    : call.function.arguments
                );
              })
            );

            console.log("[Orchestrator] Stream tool calls completed");
            // Emit the tool results
            newEmitter.emit("tool_results", toolResults);
          }

          // Emit the end event
          newEmitter.emit("end");
        } catch (error: unknown) {
          console.error(
            "[Orchestrator] Error processing tool calls from stream:",
            error
          );
          // Emit the error
          newEmitter.emit("error", error);
        }
      });

      // Handle errors
      emitter.on("error", (error: unknown) => {
        console.error("[Orchestrator] Stream error:", error);
        newEmitter.emit("error", error);
      });

      return newEmitter;
    } catch (error) {
      console.error("[Orchestrator] Error processing message stream:", error);
      throw error;
    }
  }

  /**
   * Enhance a message with system prompt and tools
   * @param message The message to enhance
   * @returns The enhanced message
   */
  enhanceMessage(message: LlmMessage): LlmMessage {
    // Add system prompt if not present
    const enhancedMessage = { ...message };

    if (!enhancedMessage.systemPrompt) {
      enhancedMessage.systemPrompt = this.generateSystemPrompt();
    }

    return enhancedMessage;
  }

  /**
   * Generate a system prompt
   * @returns The system prompt
   */
  generateSystemPrompt(): string {
    return "You are a helpful assistant.";
  }
}
