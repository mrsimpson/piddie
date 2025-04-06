import type { LlmMessage } from "../types";
import type { ChatManager, Message } from "@piddie/chat-management";
import type { Tool } from "@piddie/actions";
import type { AgentManager } from "../AgentManager";
import { generateSystemPrompt } from "./systemPromptUtils";
import { getChatHistory } from "./getChatHistory";

/**
 * Enhances a message with chat history and tools
 * @param message The message to enhance
 * @param chatManager Chat manager for history retrieval
 * @param agentManager Optional agent manager for tool results
 * @param availableTools Array of available tools to include
 * @returns The enhanced message
 */
export async function enhanceMessageWithHistoryAndTools(
    message: LlmMessage,
    chatManager?: ChatManager,
    agentManager?: AgentManager,
    availableTools: Tool[] = []
): Promise<LlmMessage> {
    const enhancedMessage: LlmMessage = { ...message };

    try {
        // Get chat history
        const chatHistory = await getChatHistory(
            message.chatId,
            message.assistantMessageId,
            chatManager
        );

        // Check if this is part of an agentic flow with tool call results to process
        let systemMessage: string | undefined;
        if (agentManager) {
            systemMessage = agentManager.createToolResultSystemMessage(message.chatId);
        }

        if (systemMessage) {
            // Add the system message with tool results to the beginning of the history
            const systemMessageObj = {
                role: "system",
                content: systemMessage
            };

            if (chatHistory.length > 0) {
                enhancedMessage.messages = [systemMessageObj, ...chatHistory];
            } else {
                enhancedMessage.messages = [systemMessageObj];
            }

            console.log(`[Orchestrator] Added tool results system message for agentic flow`);
        } else {
            // Regular flow - just add the chat history
            if (chatHistory.length > 0) {
                enhancedMessage.messages = chatHistory;
            }
        }

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
        enhancedMessage.systemPrompt = generateSystemPrompt(supportsTools, mcpToolUseIndicator);
    }

    return enhancedMessage;
} 