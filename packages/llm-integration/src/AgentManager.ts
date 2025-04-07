import { EventEmitter } from "@piddie/shared-types";
import type { ChatManager, Message } from "@piddie/chat-management";
import { MessageStatus } from "@piddie/chat-management";
import type { LlmProviderConfig, LlmMessage, LlmStreamChunk, ToolCall } from "./types";
import { settingsManager } from "@piddie/settings";

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
 * Result of agent processing
 */
export interface AgentResult {
    type: 'continue' | 'complete' | 'error';
    systemMessage?: string;
    error?: Error;
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
     * Initializes agent configuration from stored settings
     * @param chatId The chat ID to initialize
     */
    public async initializeFromStoredSettings(chatId: string): Promise<void> {
        try {
            const storedSettings = await settingsManager.getAgentSettings(chatId);

            this.configureAgent(chatId, {
                enabled: storedSettings.enabled,
                maxRoundtrips: storedSettings.maxRoundtrips,
                autoContinue: storedSettings.autoContinue,
                customSystemPrompt: storedSettings.customSystemPrompt
            });

            console.log(`[AgentManager] Initialized agent for chat ${chatId} from stored settings:`, storedSettings);
        } catch (error) {
            console.error(`[AgentManager] Error initializing agent for chat ${chatId}:`, error);
        }
    }

    /**
     * Configures the agent for a specific chat
     * @param chatId The ID of the chat to configure
     * @param config Configuration options to apply
     */
    async configureAgent(chatId: string, config: Partial<AgentConfig>): Promise<void> {
        // Update in-memory settings first
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

        // Then persist to storage
        try {
            await settingsManager.updateAgentSettings(chatId, {
                enabled: existingContext.config.enabled,
                maxRoundtrips: existingContext.config.maxRoundtrips,
                autoContinue: existingContext.config.autoContinue,
                customSystemPrompt: existingContext.config.customSystemPrompt
            });

            console.log(`[AgentManager] Agent configured for chat ${chatId}:`, existingContext.config);
        } catch (error) {
            console.error(`[AgentManager] Error persisting agent settings for chat ${chatId}:`, error);
        }
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
     * Process a message and its tool calls to determine next action
     * @param message The message that was processed
     * @param toolCalls The tool calls that were executed
     * @returns Agent result indicating next action
     */
    async react(message: LlmMessage, toolCalls: ToolCall[]): Promise<AgentResult> {
        const context = this.contexts.get(message.chatId);

        // Skip if agent not enabled or no tool calls
        if (!context?.config.enabled || toolCalls.length === 0) {
            return { type: 'complete' };
        }

        // Filter to only include tool calls with results
        const completedToolCalls = toolCalls.filter(tc => tc.result);
        if (completedToolCalls.length === 0) {
            return { type: 'complete' };
        }

        // Increment the roundtrip counter
        context.roundtrips += 1;
        context.isActive = true;

        // Check if we've reached the maximum roundtrips
        if (context.roundtrips >= context.config.maxRoundtrips) {
            // Reset the agent
            this.resetAgent(message.chatId);
            return {
                type: 'complete',
                systemMessage: `The agent reached the maximum allowed roundtrips (${context.config.maxRoundtrips}).`
            };
        }

        // Store the tool calls for context
        context.lastToolCalls = completedToolCalls;
        this.contexts.set(message.chatId, context);

        // If auto-continue is enabled, prepare continuation
        if (context.config.autoContinue) {
            const systemMessage = this.formatToolCallsForSystemMessage(completedToolCalls);
            return {
                type: 'continue',
                systemMessage: `(Roundtrip ${context.roundtrips}/${context.config.maxRoundtrips}) ${systemMessage}\n\nContinue based on these results. You may call additional tools if needed or provide a final response to the user.`
            };
        }

        return { type: 'complete' };
    }
} 