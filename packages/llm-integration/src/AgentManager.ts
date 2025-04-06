import type { ChatManager, Message, ToolCall } from "@piddie/chat-management";
import { MessageStatus } from "@piddie/chat-management";
import type { LlmProviderConfig } from "./types";

/**
 * Configuration for agentic behavior
 */
export interface AgentConfig {
    /** Whether agentic behavior is enabled */
    enabled: boolean;
    /** Maximum number of agentic roundtrips before terminating */
    maxRoundtrips: number;
    /** Whether to continue automatically after tool execution */
    autoContinue: boolean;
    /** Custom system prompt to use for agentic communication */
    customSystemPrompt?: string;
}

/**
 * Tracks the state of an agent in a chat
 */
interface AgentContext {
    /** Number of completed roundtrips */
    roundtrips: number;
    /** Agent configuration */
    config: AgentConfig;
    /** Last executed tool calls with results */
    lastToolCalls: ToolCall[];
    /** Whether the agent is currently active */
    isActive: boolean;
}

/**
 * Manages agentic behavior for LLM interactions with tools
 */
export class AgentManager {
    /** Default agent configuration */
    private readonly defaultConfig: AgentConfig = {
        enabled: false,
        maxRoundtrips: 10,
        autoContinue: true
    };

    /** Agent contexts for each chat */
    private contexts: Map<string, AgentContext> = new Map();

    /**
     * Creates a new AgentManager
     * @param chatManager Chat manager for message handling
     * @param getLlmProvider Function to get an LLM provider by name
     * @param getCompletionFn Function to get a completion for a message
     * @param defaultProviderName Default LLM provider name to use
     */
    constructor(
        private readonly chatManager: ChatManager,
        private readonly getLlmProvider: (name: string) => LlmProviderConfig | undefined,
        private readonly getCompletionFn: (
            userMessage: Message,
            assistantPlaceholder: Message,
            providerConfig: LlmProviderConfig
        ) => Promise<Message>,
        private readonly defaultProviderName: string = ""
    ) { }

    /**
     * Configures the agent for a specific chat
     * @param chatId The ID of the chat to configure
     * @param config Configuration options to apply
     */
    configureAgent(chatId: string, config: Partial<AgentConfig>): void {
        const existingContext = this.contexts.get(chatId) || {
            roundtrips: 0,
            config: { ...this.defaultConfig },
            lastToolCalls: [],
            isActive: false
        };

        // Update config with new values, keeping existing ones for undefined properties
        existingContext.config = {
            ...existingContext.config,
            ...config
        };

        this.contexts.set(chatId, existingContext);
        console.log(`[AgentManager] Agent configured for chat ${chatId}:`, existingContext.config);
    }

    /**
     * Resets the agent context for a chat
     * @param chatId The ID of the chat to reset
     */
    resetAgent(chatId: string): void {
        const existingConfig = this.contexts.get(chatId)?.config;

        this.contexts.set(chatId, {
            roundtrips: 0,
            config: existingConfig || { ...this.defaultConfig },
            lastToolCalls: [],
            isActive: false
        });

        console.log(`[AgentManager] Agent reset for chat ${chatId}`);
    }

    /**
     * Gets the agent context for a chat
     * @param chatId The chat ID
     * @returns The agent context, or undefined if not configured
     */
    getAgentContext(chatId: string): AgentContext | undefined {
        return this.contexts.get(chatId);
    }

    /**
     * Checks if the agent is enabled for a chat
     * @param chatId The chat ID to check
     * @returns True if the agent is enabled, false otherwise
     */
    isAgentEnabled(chatId: string): boolean {
        return !!this.contexts.get(chatId)?.config.enabled;
    }

    /**
     * Formats tool calls for inclusion in a system message
     * @param toolCalls The tool calls to format
     * @returns Formatted string representation of tool calls and results
     */
    formatToolCallsForSystemMessage(toolCalls: ToolCall[]): string {
        return toolCalls.map(toolCall => {
            // Format function name and arguments
            const toolName = toolCall.function.name;
            let args = "";

            if (typeof toolCall.function.arguments === "string") {
                try {
                    args = JSON.stringify(JSON.parse(toolCall.function.arguments), null, 2);
                } catch {
                    args = toolCall.function.arguments;
                }
            } else {
                args = JSON.stringify(toolCall.function.arguments || {}, null, 2);
            }

            // Format result
            let resultFormatted = "No result available";
            if (toolCall.result) {
                const status = toolCall.result.status;
                const value = typeof toolCall.result.value === "object"
                    ? JSON.stringify(toolCall.result.value, null, 2)
                    : String(toolCall.result.value);

                resultFormatted = `${status.toUpperCase()}: ${value}`;
            }

            // Return formatted tool call
            return `Tool: ${toolName}\nArguments: ${args}\nResult: ${resultFormatted}`;
        }).join("\n\n");
    }

    /**
     * Creates a system message with tool call results for agentic continuation
     * @param chatId The chat ID
     * @returns System message content or undefined if agent not configured or no tool calls
     */
    createToolResultSystemMessage(chatId: string): string | undefined {
        const context = this.contexts.get(chatId);

        if (!context?.config.enabled || context.lastToolCalls.length === 0) {
            return undefined;
        }

        const toolCallSummary = this.formatToolCallsForSystemMessage(context.lastToolCalls);
        const roundtripInfo = `(Roundtrip ${context.roundtrips}/${context.config.maxRoundtrips})`;

        return context.config.customSystemPrompt ||
            `${roundtripInfo} You previously executed these tool calls:\n\n${toolCallSummary}\n\nContinue based on these results. You may call additional tools if needed or provide a final response to the user.`;
    }

    /**
     * Processes tool calls and handles agent continuation if needed
     * @param chatId The chat ID
     * @param messageId The message ID containing tool calls
     * @param toolCalls The tool calls to process
     * @returns Promise that resolves when processing is complete
     */
    async processToolCalls(chatId: string, messageId: string, toolCalls: ToolCall[]): Promise<void> {
        // Get the agent context for this chat
        const context = this.contexts.get(chatId);

        // Skip if agent is not enabled or there are no tool calls
        if (!context?.config.enabled || toolCalls.length === 0) {
            return;
        }

        // Filter to only include tool calls with results
        const completedToolCalls = toolCalls.filter(tc => tc.result);
        if (completedToolCalls.length === 0) {
            return;
        }

        // Increment the roundtrip counter
        context.roundtrips += 1;
        context.isActive = true;

        // Check if we've reached the maximum roundtrips
        if (context.roundtrips >= context.config.maxRoundtrips) {
            console.log(
                `[AgentManager] Reached maximum roundtrips (${context.config.maxRoundtrips}) for chat ${chatId}`
            );

            // Add a system message noting that the maximum roundtrips were reached
            await this.chatManager.addMessage(
                chatId,
                `The agent reached the maximum allowed roundtrips (${context.config.maxRoundtrips}).`,
                "system",
                "system"
            );

            // Reset the agent
            this.resetAgent(chatId);
            return;
        }

        // Store the tool calls for the next roundtrip
        context.lastToolCalls = completedToolCalls;
        this.contexts.set(chatId, context);

        // If auto-continue is enabled, create a continuation
        if (context.config.autoContinue) {
            await this.continueChatWithToolResults(chatId);
        }
    }

    /**
     * Continues a chat with tool results
     * @param chatId The chat ID to continue
     * @returns Promise that resolves when continuation is complete
     */
    async continueChatWithToolResults(chatId: string): Promise<void> {
        const context = this.contexts.get(chatId);

        if (!context?.config.enabled || !context.isActive || context.lastToolCalls.length === 0) {
            return;
        }

        console.log(
            `[AgentManager] Auto-continuing agentic flow for chat ${chatId} (roundtrip ${context.roundtrips})`
        );

        try {
            // Create a temporary assistant placeholder message
            const assistantPlaceholder = await this.chatManager.addMessage(
                chatId,
                "",
                "assistant",
                "assistant",
                undefined
            );

            // Update the status to pending
            await this.chatManager.updateMessageStatus(
                chatId,
                assistantPlaceholder.id,
                MessageStatus.SENDING
            );

            // Create a virtual user message to continue the flow
            const virtualMessage = await this.chatManager.addMessage(
                chatId,
                "[Auto-continuation]",
                "user",
                "system" // Use system as username to distinguish from actual user messages
            );

            // Get the provider to use
            const provider = this.getLlmProvider(this.defaultProviderName);
            if (!provider) {
                throw new Error("No LLM provider configured");
            }

            // Continue the flow with the virtual message
            await this.getCompletionFn(virtualMessage, assistantPlaceholder, provider);
        } catch (error) {
            console.error("[AgentManager] Error auto-continuing agentic flow:", error);

            // Add an error message to the chat
            await this.chatManager.addMessage(
                chatId,
                "Error continuing agentic flow: " + (error instanceof Error ? error.message : String(error)),
                "system",
                "system"
            );

            // Reset the agent context
            this.resetAgent(chatId);
        }
    }
} 