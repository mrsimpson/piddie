import { EventEmitter } from "@piddie/shared-types";
import type {
  LlmClient,
  LlmMessage,
  LlmProviderConfig,
  LlmResponse
} from "./types";

/**
 * Enum for tool support status
 */
export enum ToolSupportStatus {
  UNCHECKED = "unchecked",
  NATIVE = "tools API",
  VIA_PROMPT = "via Prompt"
}

/**
 * Base class for LLM clients
 * Provides common functionality for different LLM providers
 */
export abstract class BaseLlmClient implements LlmClient {
  protected config: LlmProviderConfig;
  protected toolSupportStatus: ToolSupportStatus = ToolSupportStatus.UNCHECKED;
  private isCheckingToolSupport: boolean = false;

  /**
   * Creates a new BaseLlmClient
   * @param config The LLM provider configuration
   */
  constructor(config: LlmProviderConfig) {
    this.config = config;
  }

  /**
   * Sends a message to the LLM and receives a response
   * @param message The message to send
   * @returns A promise that resolves to the LLM response
   */
  abstract sendMessage(message: LlmMessage): Promise<LlmResponse>;

  /**
   * Streams a message to the LLM and receives chunks of the response
   * @param message The message to send
   * @returns An event emitter that emits chunks of the response
   */
  abstract streamMessage(message: LlmMessage): EventEmitter;

  /**
   * Checks if the LLM supports function calling/tools
   * This method sends a test message with a simple tool to determine if the LLM
   * can handle function calling natively
   * @returns A promise that resolves to true if tools are supported, false otherwise
   */
  async checkToolSupport(): Promise<boolean> {
    // If we've already checked, return the cached result
    if (this.toolSupportStatus !== ToolSupportStatus.UNCHECKED) {
      return this.toolSupportStatus === ToolSupportStatus.NATIVE;
    }

    // If we're already checking, assume no support to break the recursion
    if (this.isCheckingToolSupport) {
      return false;
    }

    try {
      // Set the flag to prevent recursion
      this.isCheckingToolSupport = true;

      // This method should be overridden by subclasses to implement
      // provider-specific tool support checking
      const hasToolSupport = await this.checkToolSupportDirectly();

      // Update the tool support status
      this.toolSupportStatus = hasToolSupport
        ? ToolSupportStatus.NATIVE
        : ToolSupportStatus.VIA_PROMPT;

      return hasToolSupport;
    } catch (error) {
      console.error("Error checking tool support:", error);
      this.toolSupportStatus = ToolSupportStatus.VIA_PROMPT;
      return false;
    } finally {
      // Reset the flag
      this.isCheckingToolSupport = false;
    }
  }

  /**
   * Checks if the LLM supports function calling/tools by making a direct API call
   * This method should be overridden by subclasses to implement provider-specific
   * tool support checking
   * @returns A promise that resolves to true if tools are supported, false otherwise
   */
  protected async checkToolSupportDirectly(): Promise<boolean> {
    // Default implementation assumes no tool support
    // Subclasses should override this method to implement provider-specific checks
    return false;
  }

  /**
   * Enhances a message with tools information based on the current tool support status
   * If tools are not supported, adds tool instructions to the system prompt
   * @param message The message to enhance
   * @returns The enhanced message
   */
  protected async addProvidedTools(
    message: LlmMessage
  ): Promise<{ message: LlmMessage; hasNativeToolsSupport: boolean }> {
    // If no tools or we're checking tool support, return the message as is
    if (
      !message.tools ||
      message.tools.length === 0 ||
      this.isCheckingToolSupport
    ) {
      return { message, hasNativeToolsSupport: false };
    }

    // Check tool support if not already checked
    if (this.toolSupportStatus === ToolSupportStatus.UNCHECKED) {
      await this.checkToolSupport();
    }

    // If tools are natively supported, return the message as is
    if (this.toolSupportStatus === ToolSupportStatus.NATIVE) {
      return { message, hasNativeToolsSupport: true };
    }

    // Tools are not supported, add instructions to the system prompt
    const enhancedMessage = { ...message };

    // Create tool instructions for the system prompt
    const toolInstructions = this.generateToolInstructions(message.tools);

    // Add tool instructions to the system prompt
    if (enhancedMessage.messages && enhancedMessage.messages.length > 0) {
      // Find the system message
      const systemMessageIndex = enhancedMessage.messages.findIndex(
        (m) => m.role === "system"
      );

      if (systemMessageIndex >= 0) {
        // Update existing system message
        const systemMessage = enhancedMessage.messages[systemMessageIndex];
        if (systemMessage) {
          enhancedMessage.messages[systemMessageIndex] = {
            role: systemMessage.role,
            content: `${systemMessage.content}\n\n${toolInstructions}`
          };
        }
      } else {
        // Add new system message
        enhancedMessage.messages.unshift({
          role: "system",
          content: toolInstructions
        });
      }
    } else if (enhancedMessage.systemPrompt) {
      // Update system prompt
      enhancedMessage.systemPrompt = `${enhancedMessage.systemPrompt}\n\n${toolInstructions}`;
    } else {
      // Add system prompt
      enhancedMessage.systemPrompt = toolInstructions;
    }

    return { message: enhancedMessage, hasNativeToolsSupport: false };
  }

  /**
   * Generates instructions for using tools via prompt
   * @param tools The tools to include in the instructions
   * @returns A string with instructions for using tools
   */
  protected generateToolInstructions(
    tools: Array<{
      type: string;
      function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
      };
    }>
  ): string {
    // Generate descriptions for each tool
    const toolDescriptions = tools
      .map((tool) => {
        const name = tool.function.name;
        const description =
          tool.function.description || "No description provided";
        const params = tool.function.parameters
          ? JSON.stringify(tool.function.parameters, null, 2)
          : "";

        return `Tool: ${name}
Description: ${description}
Parameters:
${params || "  - No parameters required"}`;
      })
      .join("\n\n");

    // Create instructions for how to use the tools
    return `You have access to the following tools:

${toolDescriptions}

To use a tool, you MUST use the following specific format:

\`\`\`mcp-tool-call
{
  "tool_calls": [
    {
      "function": {
        "name": "tool_name",
        "arguments": {
          "param1": "value1",
          "param2": "value2"
        }
      }
    }
  ]
}
\`\`\`

Important instructions:
1. Always use the exact \`mcp-tool-call\` format shown above
2. The tool_calls array can contain multiple tool calls if needed
3. Make sure the JSON is valid and properly formatted
4. Place the tool call block at the end of your response
5. You can include explanations before the tool call block
6. Do NOT modify the structure of the JSON object

If you don't need to use a tool, respond normally without the code block.`;
  }

  /**
   * Gets the selected model from the configuration
   * @returns The selected model
   */
  protected getSelectedModel(): string {
    return (
      this.config.selectedModel ||
      this.config.model ||
      this.config.defaultModel ||
      "gpt-3.5-turbo"
    );
  }

  /**
   * Determines if tools should be included in the API request
   * @param message The enhanced message with potential tools
   * @returns True if tools should be included in the request, false otherwise
   */
  protected shouldIncludeToolsInRequest(message: LlmMessage): boolean {
    return (
      this.toolSupportStatus === ToolSupportStatus.NATIVE &&
      !!message.tools &&
      message.tools.length > 0
    );
  }

  /**
   * Post-processes a response to extract tool calls when native tool support isn't available
   * This method is called after receiving a response from the LLM
   * @param response The response to post-process
   * @returns The post-processed response with extracted tool calls
   */
  protected postProcessResponse(response: LlmResponse): LlmResponse {
    // If we have native tool support or there are already tool calls, return the response as is
    if (
      this.toolSupportStatus === ToolSupportStatus.NATIVE ||
      (response.tool_calls && response.tool_calls.length > 0)
    ) {
      return response;
    }

    // Extract tool calls from the response content
    const extractedToolCalls = this.extractToolCalls(response.content);

    // If we found tool calls, add them to the response
    if (extractedToolCalls.length > 0) {
      return {
        ...response,
        tool_calls: extractedToolCalls
      };
    }

    return response;
  }

  /**
   * Extracts tool calls from a specific mcp-tool-call fenced code block
   * This method is more precise than extractToolCallsFromText and looks for the exact format
   * @param content The text response from the LLM
   * @returns An array of extracted tool calls, or an empty array if none were found
   */
  protected extractToolCalls(content: string): Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }> {
    let toolCalls: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }> = [];

    if (!content) return toolCalls;

    try {
      // tool calls are denoted by fenced code blocks
      const mcpBlockRegex = /```mcp-tool-call\s*([\s\S]*?)```/g;
      const matches = [...content.matchAll(mcpBlockRegex)];

      for (const match of matches) {
        const jsonStr = match[1]?.trim();
        if (!jsonStr) continue;

        try {
          const parsed = JSON.parse(jsonStr);

          // Check if this is a tool_calls object
          if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            // Process all tool calls in the array and add them to our collection
            // Instead of returning immediately, we collect all tool calls
            const parsedToolCalls = parsed.tool_calls
              .map(
                (tc: {
                  function?: {
                    name: string;
                    arguments: string | Record<string, unknown>;
                  };
                }) => {
                  // Ensure the tool call has the expected structure
                  if (
                    tc.function &&
                    tc.function.name &&
                    tc.function.arguments
                  ) {
                    return {
                      function: {
                        name: tc.function.name,
                        // If arguments is a string, try to parse it as JSON
                        arguments:
                          typeof tc.function.arguments === "string"
                            ? this.tryParseJson(tc.function.arguments)
                            : tc.function.arguments
                      }
                    };
                  }
                  return null;
                }
              )
              .filter((tc: unknown) => tc !== null);

            // Add the parsed tool calls to our collection
            toolCalls = toolCalls.concat(parsedToolCalls);
            continue; // Process the next match
          }

          // If not a tool_calls array, try to parse it as a direct tool call object
          toolCalls = toolCalls.concat(parsed);
        } catch (error) {
          console.warn("Error parsing mcp-tool-call JSON:", error);
          // If parsing fails, continue to the next match
          continue;
        }
      }
    } catch (error) {
      console.warn("Error extracting tool calls from mcp block:", error);
    }

    return toolCalls;
  }

  /**
   * Helper method to safely parse JSON strings
   * @param jsonStr The JSON string to parse
   * @returns The parsed JSON object or the original string if parsing fails
   */
  private tryParseJson(jsonStr: string): Record<string, unknown> {
    try {
      return JSON.parse(jsonStr);
    } catch {
      // If parsing fails, return an object with the original string
      return { _original: jsonStr };
    }
  }
}
