import { EventEmitter } from "@piddie/shared-types";
import type { LlmClient, LlmMessage, LlmProviderConfig, LlmResponse } from "./types";

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
            this.toolSupportStatus = hasToolSupport ? ToolSupportStatus.NATIVE : ToolSupportStatus.VIA_PROMPT;

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
    protected async addProvidedTools(message: LlmMessage): Promise<LlmMessage> {
        // If no tools or we're checking tool support, return the message as is
        if (!message.tools || message.tools.length === 0 || this.isCheckingToolSupport) {
            return message;
        }

        // Check tool support if not already checked
        if (this.toolSupportStatus === ToolSupportStatus.UNCHECKED) {
            await this.checkToolSupport();
        }

        // If tools are natively supported, return the message as is
        if (this.toolSupportStatus === ToolSupportStatus.NATIVE) {
            return message;
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

        return enhancedMessage;
    }

    /**
     * Generates instructions for using tools based on the tools array
     * @param tools The tools to generate instructions for
     * @returns The tool instructions as a string
     */
    protected generateToolInstructions(tools: any[]): string {
        // Create a detailed description of each tool
        const toolDescriptions = tools.map(tool => {
            const params = tool.function.parameters && tool.function.parameters.properties
                ? Object.entries(tool.function.parameters.properties)
                    .map(([name, prop]: [string, any]) =>
                        `  - ${name}: ${prop.type}${prop.description ? ` (${prop.description})` : ''}`)
                    .join('\n')
                : '';

            return `Tool: ${tool.function.name}
Description: ${tool.function.description || 'No description provided'}
Parameters:
${params || '  - No parameters required'}`;
        }).join('\n\n');

        // Create instructions for how to use the tools
        return `You have access to the following tools:

${toolDescriptions}

To use a tool, you MUST use the following format:

\`\`\`json
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

The tool_calls array can contain multiple tool calls if needed.
Always respond with valid JSON when using tools.
If you don't need to use a tool, respond normally without the JSON format.`;
    }

    /**
     * Gets the selected model from the configuration
     * @returns The selected model
     */
    protected getSelectedModel(): string {
        return this.config.selectedModel ||
            this.config.model ||
            this.config.defaultModel ||
            "gpt-3.5-turbo";
    }

    /**
     * Determines if tools should be included in the API request
     * @param message The enhanced message with potential tools
     * @returns True if tools should be included in the request, false otherwise
     */
    protected shouldIncludeToolsInRequest(message: LlmMessage): boolean {
        return this.toolSupportStatus === ToolSupportStatus.NATIVE &&
            !!message.tools &&
            message.tools.length > 0;
    }
} 