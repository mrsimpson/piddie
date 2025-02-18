import Dexie from "dexie";
import type { Chat, Message, ChatManager } from "./types";
import { MessageStatus } from "./types";

/**
 * Database class for chat storage using Dexie
 */
export class ChatDatabase extends Dexie {
  chats!: Dexie.Table<Omit<Chat, "messages">, string>;
  messages!: Dexie.Table<Message, string>;

  constructor() {
    super("ChatDatabase");
    this.version(1).stores({
      chats: "id, created, lastUpdated",
      messages: "id, chatId, parentId, created, [chatId+created]"
    });
  }
}

/**
 * Implementation of ChatManager using Dexie for storage
 */
export class DexieChatManager implements ChatManager {
  constructor(private db: ChatDatabase) {}

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

  async addMessage(
    chatId: string,
    content: string,
    role: Message["role"],
    parentId?: string
  ): Promise<Message> {
    const chat = await this.db.chats.get(chatId);
    if (!chat) {
      throw new Error("Chat not found");
    }

    const message: Message = {
      id: `msg_${Date.now()}`,
      chatId, // Add chatId to message
      content,
      role,
      status: MessageStatus.SENT,
      created: new Date(),
      parentId: parentId || undefined
    };

    await this.db.messages.add(message);

    // Update chat's lastUpdated
    await this.db.chats.update(chatId, {
      lastUpdated: new Date()
    });

    return message;
  }

  async getChat(chatId: string): Promise<Chat> {
    const chat = await this.db.chats.get(chatId);
    if (!chat) {
      throw new Error("Chat not found");
    }

    const messages = await this.db.messages
      .where("chatId")
      .equals(chatId)
      .sortBy("created");

    return {
      ...chat,
      messages
    };
  }

  async listChats(limit?: number, offset = 0): Promise<Chat[]> {
    const chats = await this.db.chats
      .orderBy("lastUpdated")
      .reverse()
      .offset(offset)
      .limit(limit || Infinity)
      .toArray();

    // Get messages for each chat
    const chatsWithMessages = await Promise.all(
      chats.map(async (chat) => {
        const messages = await this.db.messages
          .where("chatId")
          .equals(chat.id)
          .sortBy("created");
        return { ...chat, messages };
      })
    );

    return chatsWithMessages;
  }

  async updateMessageStatus(
    chatId: string,
    messageId: string,
    status: MessageStatus
  ): Promise<void> {
    const message = await this.db.messages.get(messageId);
    if (!message || message.chatId !== chatId) {
      throw new Error("Message not found");
    }

    await this.db.messages.update(messageId, { status });
    await this.db.chats.update(chatId, {
      lastUpdated: new Date()
    });
  }

  async deleteChat(chatId: string): Promise<void> {
    const chat = await this.db.chats.get(chatId);
    if (!chat) {
      throw new Error("Chat not found");
    }

    // Delete all messages first
    await this.db.messages.where("chatId").equals(chatId).delete();
    // Then delete the chat
    await this.db.chats.delete(chatId);
  }
}
