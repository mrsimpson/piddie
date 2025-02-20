import Dexie, { Table } from "dexie";
import type { Chat, Message, ChatManager } from "../types";
import { MessageStatus } from "../types";
import type { ChatCompletionRole } from "openai/resources/chat";

/**
 * Database schema for chat management
 * @internal
 */
export class ChatDatabase extends Dexie {
  chats!: Table<Omit<Chat, "messages">, string>;
  messages!: Table<Message, string>;

  constructor() {
    super("piddie-chats");

    this.version(1).stores({
      chats: "id, created, lastUpdated",
      messages: "id, chatId, created, status, [chatId+created]"
    });
  }
}

/**
 * Implements chat management using Dexie as the storage layer
 * @internal
 */
export class DexieChatManager implements ChatManager {
  private db: ChatDatabase;

  constructor(db?: ChatDatabase) {
    this.db = db || new ChatDatabase();
  }

  async createChat(metadata?: Record<string, unknown>): Promise<Chat> {
    const chat: Omit<Chat, "messages"> = {
      id: `chat_${Date.now()}`,
      created: new Date(),
      lastUpdated: new Date(),
      metadata: metadata || undefined
    };

    await this.db.chats.add(chat);
    return {
      ...chat,
      messages: []
    };
  }

  async getChat(id: string): Promise<Chat> {
    const chat = await this.db.chats.get(id);
    if (!chat) {
      throw new Error(`Chat not found: ${id}`);
    }

    const messages = await this.db.messages
      .where("chatId")
      .equals(id)
      .sortBy("created");

    return {
      ...chat,
      messages
    };
  }

  async addMessage(
    chatId: string, 
    content: string, 
    role: ChatCompletionRole,
    parentId?: string
  ): Promise<Message> {
    const chat = await this.db.chats.get(chatId);
    if (!chat) {
      throw new Error(`Chat not found: ${chatId}`);
    }

    const message: Message = {
      id: `msg_${Date.now()}`,
      chatId,
      content,
      role,
      created: new Date(),
      status: MessageStatus.SENT,
      parentId
    };

    await this.db.messages.add(message);
    await this.db.chats.update(chatId, { lastUpdated: new Date() });

    return message;
  }

  async updateMessageStatus(messageId: string, status: MessageStatus): Promise<void> {
    const message = await this.db.messages.get(messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    await this.db.messages.update(messageId, { status });
    await this.db.chats.update(message.chatId, { lastUpdated: new Date() });
  }

  async listChats(): Promise<Chat[]> {
    const chats = await this.db.chats.toArray();
    const result: Chat[] = [];

    for (const chat of chats) {
      const messages = await this.db.messages
        .where("chatId")
        .equals(chat.id)
        .sortBy("created");

      result.push({
        ...chat,
        messages
      });
    }

    return result;
  }

  async deleteChat(id: string): Promise<void> {
    const chat = await this.db.chats.get(id);
    if (!chat) {
      throw new Error(`Chat not found: ${id}`);
    }

    await this.db.messages.where("chatId").equals(id).delete();
    await this.db.chats.delete(id);
  }
}
