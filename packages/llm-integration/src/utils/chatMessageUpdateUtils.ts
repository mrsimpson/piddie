import type { ChatManager, ToolCall } from "@piddie/chat-management";
import { MessageStatus } from "@piddie/chat-management";

/**
 * Updates the status of a message
 * @param chatId The ID of the chat containing the message
 * @param messageId The ID of the message to update
 * @param status The new status
 * @param chatManager The chat manager to use for the update
 */
export async function updateMessageStatus(
    chatId: string,
    messageId: string,
    status: MessageStatus,
    chatManager?: ChatManager
): Promise<void> {
    if (!chatManager) {
        console.warn(
            "[Orchestrator] No chat manager available to update message status"
        );
        return;
    }

    // Skip database updates for temporary messages (they're handled by the chat store)
    if (messageId.startsWith("temp_")) {
        console.log(
            `[Orchestrator] Skipping database update for temporary message ${messageId}`
        );
        return;
    }

    try {
        await chatManager.updateMessageStatus(chatId, messageId, status);
    } catch (error) {
        console.error(`Error updating message status for ${messageId}:`, error);
    }
}

/**
 * Updates the content of a message
 * @param chatId The ID of the chat containing the message
 * @param messageId The ID of the message to update
 * @param content The new content
 * @param chatManager The chat manager to use for the update
 */
export async function updateMessageContent(
    chatId: string,
    messageId: string,
    content: string,
    chatManager?: ChatManager
): Promise<void> {
    if (!chatManager) {
        console.warn(
            "[Orchestrator] No chat manager available to update message content"
        );
        return;
    }

    // Skip database updates for temporary messages (they're handled by the chat store)
    if (messageId.startsWith("temp_")) {
        console.log(
            `[Orchestrator] Skipping database update for temporary message ${messageId}`
        );
        return;
    }

    try {
        await chatManager.updateMessageContent(chatId, messageId, content);
    } catch (error) {
        console.error(`Error updating message content for ${messageId}:`, error);
    }
}

/**
 * Updates the tool calls of a message
 * @param chatId The chat ID
 * @param messageId The message ID
 * @param toolCalls The tool calls
 * @param chatManager The chat manager to use for the update
 */
export function updateMessageToolCalls(
    chatId: string,
    messageId: string,
    toolCalls: ToolCall[],
    chatManager?: ChatManager
): void {
    if (!chatManager) {
        return;
    }

    // Use the chat manager to update the message
    chatManager.updateMessage(chatId, messageId, {
        tool_calls: toolCalls
    });
}

