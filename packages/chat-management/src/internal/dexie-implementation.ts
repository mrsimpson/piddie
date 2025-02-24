import Dexie, { Table } from "dexie";
import {
  Chat,
  ChatManager,
  ChatMessage,
  ChatState,
  GetHistoryOptions,
  MessageStatus
} from "../types";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

/**
 * Schema for the chat database
 */
export class ChatDatabase extends Dexie {
  chats!: Table<Chat>;
  messages!: Table<ChatMessage>;

  constructor() {
    super("piddie-chats");
    this.version(1).stores({
      chats: "id, created, lastUpdated",
      messages: "id, chatId, parentId, timestamp, role, status"
    });
  }
}

/**
 * Implementation of ChatManager using Dexie
 */
export class DexieChatManager implements ChatManager {
  private db: ChatDatabase;

  constructor(db = new ChatDatabase()) {
    this.db = db;
  }

  /**
   * Creates a new chat conversation
   * @param metadata Optional metadata for the chat
   */
  async createChat(metadata?: Record<string, unknown>): Promise<Chat> {
    const chat: Chat = {
      id: crypto.randomUUID(),
      created: new Date(),
      lastUpdated: new Date(),
      metadata
    };

    await this.db.chats.add(chat);
    return chat;
  }

  /**
   * Gets a chat by ID with its messages
   * @param chatId ID of chat to get
   */
  async getChat(chatId: string): Promise<Chat & { messages: ChatMessage[] }> {
    const chat = await this.db.chats.get(chatId);
    if (!chat) {
      throw new Error(`Chat not found: ${chatId}`);
    }

    const messages = await this.db.messages
      .where("chatId")
      .equals(chatId)
      .sortBy("timestamp");

    return { ...chat, messages };
  }

  /**
   * Adds a message to a chat
   * @param chatId ID of chat to add message to
   * @param content Content of message
   * @param role Role of message sender
   * @param parentId Optional ID of parent message
   */
  async addMessage(
    chatId: string,
    content: string,
    role: ChatCompletionMessageParam["role"],
    parentId?: string
  ): Promise<ChatMessage> {
    const chat = await this.db.chats.get(chatId);
    if (!chat) {
      throw new Error(`Chat not found: ${chatId}`);
    }

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      chatId,
      content,
      role,
      parentId,
      timestamp: new Date(),
      status: MessageStatus.Delivered
    };

    await this.db.messages.add(message);
    await this.updateChatLastUpdated(chatId);

    return message;
  }

  /**
   * Updates the status of a message
   * @param messageId ID of message to update
   * @param status New status
   */
  async updateMessageStatus(
    messageId: string,
    status: MessageStatus
  ): Promise<void> {
    const message = await this.db.messages.get(messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    await this.db.messages.update(messageId, { status });
    await this.updateChatLastUpdated(message.chatId);
  }

  /**
   * Retrieves the history of a chat conversation
   * @param conversationId The ID of the conversation to retrieve history for
   * @param options Optional options for filtering the history
   */
  async getHistory(
    conversationId: string,
    options?: GetHistoryOptions
  ): Promise<ChatMessage[]> {
    let query = this.db.messages.where("chatId").equals(conversationId);

    if (options?.before) {
      query = query.filter((msg) => msg.timestamp < options.before!);
    }
    if (options?.after) {
      query = query.filter((msg) => msg.timestamp > options.after!);
    }

    const messages = await query.sortBy("timestamp");
    return options?.limit ? messages.slice(0, options.limit) : messages;
  }

  /**
   * Lists all chat conversations
   * @param limit Optional limit on the number of conversations to return
   * @param offset Optional offset for pagination
   */
  async listConversations(limit?: number, offset = 0): Promise<Chat[]> {
    const chats = await this.db.chats
      .orderBy("lastUpdated")
      .reverse()
      .offset(offset);
    return limit ? await chats.limit(limit).toArray() : await chats.toArray();
  }

  /**
   * Retrieves the state of a chat conversation
   * @param conversationId The ID of the conversation to retrieve state for
   */
  async getState(conversationId: string): Promise<ChatState> {
    const chat = await this.db.chats.get(conversationId);
    if (!chat) {
      throw new Error(`Chat not found: ${conversationId}`);
    }

    const messages = await this.db.messages
      .where("chatId")
      .equals(conversationId)
      .count();

    return {
      id: chat.id,
      title: (chat.metadata?.["title"] as string) || chat.id,
      metadata: chat.metadata,
      createdAt: chat.created,
      updatedAt: chat.lastUpdated,
      messageCount: messages
    };
  }

  /**
   * Deletes a chat and all its messages
   * @param id ID of chat to delete
   */
  async deleteChat(id: string): Promise<void> {
    const chat = await this.db.chats.get(id);
    if (!chat) {
      throw new Error(`Chat not found: ${id}`);
    }
    await this.db.messages.where("chatId").equals(id).delete();
    await this.db.chats.delete(id);
  }

  private async updateChatLastUpdated(chatId: string): Promise<void> {
    await this.db.chats.update(chatId, {
      lastUpdated: new Date()
    });
  }
}
