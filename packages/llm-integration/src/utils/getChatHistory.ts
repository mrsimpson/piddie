import type { ChatManager } from "@piddie/chat-management";

/**
 * Retrieves a cleaned chat history for a message
 * @param chatId The ID of the chat to retrieve history for
 * @param assistantMessageId Optional ID of the assistant message to exclude from history
 * @param chatManager The chat manager to use to retrieve history
 * @returns Array of messages in the format expected by the LLM
 */

export async function getChatHistory(
    chatId: string,
    assistantMessageId: string | undefined,
    chatManager?: ChatManager
): Promise<Array<{ role: string; content: string; }>> {
    if (!chatManager) {
        return [];
    }

    try {
        const chat = await chatManager.getChat(chatId);
        const history = chat.messages;

        // Filter out the placeholder assistant message if it exists
        const filteredHistory = assistantMessageId
            ? history.filter(
                (msg) => msg.id !== assistantMessageId || msg.content.trim() !== ""
            )
            : history;

        // Map to the format expected by the LLM
        const chatHistory = filteredHistory.map((msg) => ({
            role: msg.role,
            content: msg.content
        }));

        console.log(`Retrieved ${chatHistory.length} messages from chat history`);
        return chatHistory;
    } catch (error) {
        console.error("Error retrieving chat history:", error);
        // Continue without history rather than failing
        return [];
    }
}
