import type { LlmMessage } from "../types";
import type { ChatManager, Message } from "@piddie/chat-management";
import type { Tool } from "@piddie/actions";
import type { AgentManager } from "../AgentManager";
import { compileSystemPrompt } from "./systemPromptUtils";
import { getChatHistory } from "./getChatHistory";

/**
 * Enhances a message with chat history and tools
 * 
 * @param message The message to enhance
 * @param chatManager Chat manager for history retrieval
 * @param agentManager Optional agent manager for tool results
 * @param availableTools Array of available tools to include
 * @returns The enhanced message
 */
export async function addTools(
    message: LlmMessage,
    availableTools: Tool[] = []
): Promise<LlmMessage> {
    const enhancedMessage: LlmMessage = { ...message };

    try {

        // Add tools to the message if any were provided
        if (availableTools.length > 0) {
            enhancedMessage.tools = availableTools.map((tool) => ({
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description || "",
                    parameters: {
                        type: "object",
                        properties: tool.inputSchema.properties || {},
                        ...(tool.inputSchema.type !== "object"
                            ? { type: tool.inputSchema.type }
                            : {})
                    }
                }
            }));
        } else {
            enhancedMessage.tools = [];
        }
    } catch (error) {
        console.error("Error enhancing message with history and tools:", error);
        // Ensure we at least have an empty history if there was an error
        enhancedMessage.messages = enhancedMessage.messages || [];
        enhancedMessage.tools = enhancedMessage.tools || [];
    }

    return enhancedMessage;
}

/**
 * Enhance a message with system prompt
 * @param message The message to enhance
 * @param supportsTools Whether the provider supports tools natively
 * @returns The enhanced message
 */
export function enhanceMessageWithSystemPrompt(
    message: LlmMessage,
    supportsTools: boolean,
    mcpToolUseIndicator: string
): LlmMessage {
    // Add system prompt if not present
    const enhancedMessage = { ...message };

    if (!enhancedMessage.systemPrompt) {
        enhancedMessage.systemPrompt = compileSystemPrompt(supportsTools, mcpToolUseIndicator);
    }

    return enhancedMessage;
} 