import {
  Chat,
  ChatManager,
  Message,
  MessageStatus,
  ToolCall,
  type ChatCompletionRole
} from "@piddie/chat-management";

export class MockChatManager implements ChatManager {
  private chats = new Map<string, Chat>();
  private messages = new Map<string, Message>();

  async createChat(
    projectId: string,
    metadata?: Record<string, unknown>
  ): Promise<Chat> {
    const chat: Chat = {
      id: `chat-${Date.now()}`,
      projectId,
      created: new Date(),
      lastUpdated: new Date(),
      metadata: metadata || {},
      messages: []
    };
    this.chats.set(chat.id, chat);
    return chat;
  }

  async getChat(chatId: string): Promise<Chat> {
    const chat = this.chats.get(chatId);
    if (!chat) {
      throw new Error(`Chat ${chatId} not found`);
    }
    return chat;
  }

  async listChats(limit?: number, offset = 0): Promise<Chat[]> {
    return Array.from(this.chats.values())
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())
      .slice(offset, offset + (limit || this.chats.size));
  }

  async listProjectChats(
    projectId: string,
    limit?: number,
    offset = 0
  ): Promise<Chat[]> {
    return Array.from(this.chats.values())
      .filter((chat) => chat.projectId === projectId)
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())
      .slice(offset, offset + (limit || this.chats.size));
  }

  async deleteChat(chatId: string): Promise<void> {
    if (!this.chats.has(chatId)) {
      throw new Error(`Chat ${chatId} not found`);
    }
    this.chats.delete(chatId);

    // Delete all messages associated with this chat
    for (const [msgId, msg] of this.messages.entries()) {
      if (msg.chatId === chatId) {
        this.messages.delete(msgId);
      }
    }
  }

  async addMessage(
    chatId: string,
    content: string,
    role: string,
    username?: string,
    parentId?: string,
    created?: Date
  ): Promise<Message> {
    const chat = await this.getChat(chatId);

    const message: Message = {
      id: `msg-${Date.now()}`,
      chatId,
      content,
      role: role as ChatCompletionRole,
      status: MessageStatus.SENT,
      created: created || new Date(),
      username,
      parentId,
      tool_calls: []
    };

    this.messages.set(message.id, message);

    // Update the chat
    chat.messages.push(message);
    chat.lastUpdated = new Date();

    return message;
  }

  async updateMessageContent(
    chatId: string,
    messageId: string,
    content: string
  ): Promise<void> {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    message.content = content;
    // Update the parent chat's lastUpdated
    const chat = this.chats.get(chatId);
    if (chat) {
      chat.lastUpdated = new Date();
    }
  }

  async updateMessageStatus(
    chatId: string,
    messageId: string,
    status: MessageStatus
  ): Promise<void> {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    message.status = status;
    // Update the parent chat's lastUpdated
    const chat = this.chats.get(chatId);
    if (chat) {
      chat.lastUpdated = new Date();
    }
  }

  async updateMessageToolCalls(
    chatId: string,
    messageId: string,
    toolCalls: ToolCall[]
  ): Promise<void> {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    message.tool_calls = toolCalls;
    // Update the parent chat's lastUpdated
    const chat = this.chats.get(chatId);
    if (chat) {
      chat.lastUpdated = new Date();
    }
  }

  async updateMessage(
    chatId: string,
    messageId: string,
    updates: Partial<Message>
  ): Promise<void> {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    Object.assign(message, updates);
    // Update the parent chat's lastUpdated
    const chat = this.chats.get(chatId);
    if (chat) {
      chat.lastUpdated = new Date();
    }
  }
}
