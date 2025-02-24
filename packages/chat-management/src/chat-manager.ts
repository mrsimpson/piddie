import type { ChatMessage, ChatState, GetHistoryOptions } from "./types.js";

/**
 * Manages chat history and conversation state
 */
export class ChatManager {
  private conversations: Map<string, ChatState> = new Map();
  private messages: Map<string, ChatMessage[]> = new Map();

  /**
   * Add a message to a conversation
   */
  async addMessage(
    message: Omit<ChatMessage, "id" | "timestamp">
  ): Promise<ChatMessage> {
    const msg: ChatMessage = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date()
    };

    // Get or create conversation messages
    const messages = this.messages.get(message.chatId) || [];
    messages.push(msg);
    this.messages.set(message.chatId, messages);

    // Update conversation state
    const state = this.conversations.get(message.chatId) || {
      id: message.chatId,
      createdAt: new Date(),
      updatedAt: new Date(),
      messageCount: 0
    };

    state.messageCount++;
    state.updatedAt = new Date();
    this.conversations.set(message.chatId, state);

    return msg;
  }

  /**
   * Get messages from a conversation
   */
  async getHistory(
    conversationId: string,
    options: GetHistoryOptions = {}
  ): Promise<ChatMessage[]> {
    const messages = this.messages.get(conversationId) || [];
    let filtered = [...messages];

    if (options.before) {
      filtered = filtered.filter((m) => m.timestamp < options.before!);
    }

    if (options.after) {
      filtered = filtered.filter((m) => m.timestamp > options.after!);
    }

    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * Get state of a conversation
   */
  async getState(conversationId: string): Promise<ChatState | undefined> {
    return this.conversations.get(conversationId);
  }

  /**
   * List all conversations
   */
  async listConversations(): Promise<ChatState[]> {
    return Array.from(this.conversations.values());
  }

  /**
   * Deletes a chat
   */
  async deleteChat(conversationId: string): Promise<void> {
    const chat = await this.conversations.get(conversationId);
    if (!chat) {
      throw new Error("Chat not found");
    }

    this.messages.delete(conversationId);
    this.conversations.delete(conversationId);
  }
}
