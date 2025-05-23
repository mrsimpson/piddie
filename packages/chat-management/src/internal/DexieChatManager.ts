import Dexie, { Table } from "dexie";
import type { Chat, Message, ChatManager, ToolCall } from "../types";
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

    // Add a new version with the projectId index
    this.version(2).stores({
      chats: "id, created, lastUpdated, projectId",
      messages: "id, chatId, created, status, [chatId+created]"
    });

    // Add a new version with tool_calls support
    this.version(3).stores({
      chats: "id, created, lastUpdated, projectId",
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

  /**
   * Checks if a message ID is from an ephemeral message
   * @param messageId The message ID to check
   * @returns True if the message is ephemeral, false otherwise
   */
  private isEphemeralMessage(messageId: string): boolean {
    return messageId.startsWith("temp_");
  }

  async createChat(
    projectId: string,
    metadata?: Record<string, unknown>
  ): Promise<Chat> {
    const chat: Omit<Chat, "messages"> = {
      id: projectId, // there will be only one chat per project for now
      created: new Date(),
      lastUpdated: new Date(),
      projectId,
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
    username = "",
    parentId?: string,
    created?: Date
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
      created: created || new Date(),
      status: MessageStatus.SENT,
      username,
      parentId
    };

    await this.db.messages.add(message);
    await this.db.chats.update(chatId, { lastUpdated: new Date() });

    return message;
  }

  async updateMessageStatus(
    chatId: string,
    messageId: string,
    status: MessageStatus
  ): Promise<void> {
    // Skip database operations for ephemeral messages
    if (this.isEphemeralMessage(messageId)) {
      return;
    }

    const message = await this.db.messages.get(messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    await this.db.messages.update(messageId, { status });
    await this.db.chats.update(chatId, { lastUpdated: new Date() });
  }

  /**
   * Updates a message's content
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param content The new content
   */
  async updateMessageContent(
    chatId: string,
    messageId: string,
    content: string
  ): Promise<void> {
    // Skip database operations for ephemeral messages
    if (this.isEphemeralMessage(messageId)) {
      return;
    }

    const message = await this.db.messages.get(messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    await this.db.messages.update(messageId, { content });
    await this.db.chats.update(chatId, { lastUpdated: new Date() });
  }

  async listChats(limit?: number, offset = 0): Promise<Chat[]> {
    const chats = (await this.db.chats.toArray()) || [];
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

    // Sort chats by lastUpdated (newest first)
    const sortedResult = result.sort(
      (a, b) =>
        (b.lastUpdated?.getTime() || 0) - (a.lastUpdated?.getTime() || 0)
    );

    // Apply pagination if limit is provided
    if (limit !== undefined) {
      return sortedResult.slice(offset, offset + limit);
    }

    return sortedResult;
  }

  async listProjectChats(
    projectId: string,
    limit?: number,
    offset = 0
  ): Promise<Chat[]> {
    // Get all chats for the project
    const chats = await this.db.chats
      .where("projectId")
      .equals(projectId)
      .toArray();
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

    // Sort chats by lastUpdated (newest first)
    const sortedResult = result.sort(
      (a, b) =>
        (b.lastUpdated?.getTime() || 0) - (a.lastUpdated?.getTime() || 0)
    );

    // Apply pagination if limit is provided
    if (limit !== undefined) {
      return sortedResult.slice(offset, offset + limit);
    }

    return sortedResult;
  }

  async deleteChat(id: string): Promise<void> {
    const chat = await this.db.chats.get(id);
    if (!chat) {
      throw new Error(`Chat not found: ${id}`);
    }

    await this.db.messages.where("chatId").equals(id).delete();
    await this.db.chats.delete(id);
  }

  /**
   * Updates a message's tool calls
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param toolCalls The tool calls to add
   */
  async updateMessageToolCalls(
    chatId: string,
    messageId: string,
    toolCalls: ToolCall[]
  ): Promise<void> {
    // Skip database operations for ephemeral messages
    if (this.isEphemeralMessage(messageId)) {
      return;
    }

    try {
      await this.db.transaction("rw", this.db.messages, async () => {
        const message = await this.db.messages.get(messageId);
        if (!message) {
          throw new Error(`Message ${messageId} not found`);
        }

        if (message.chatId !== chatId) {
          throw new Error(
            `Message ${messageId} does not belong to chat ${chatId}`
          );
        }

        await this.db.messages.update(messageId, {
          tool_calls: toolCalls
        });
      });

      // Update the chat's lastUpdated timestamp
      await this.db.chats.update(chatId, { lastUpdated: new Date() });
    } catch (error) {
      console.error("Error updating message tool calls:", error);
      throw error;
    }
  }

  /**
   * Updates multiple aspects of a message in a single transaction
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param updates Object containing the updates to apply
   */
  async updateMessage(
    chatId: string,
    messageId: string,
    updates: {
      content?: string;
      status?: MessageStatus;
      tool_calls?: ToolCall[];
    }
  ): Promise<void> {
    // Skip database operations for ephemeral messages
    if (this.isEphemeralMessage(messageId)) {
      return;
    }

    try {
      await this.db.transaction("rw", this.db.messages, async () => {
        const message = await this.db.messages.get(messageId);
        if (!message) {
          throw new Error(`Message ${messageId} not found`);
        }

        if (message.chatId !== chatId) {
          throw new Error(
            `Message ${messageId} does not belong to chat ${chatId}`
          );
        }

        // Apply all updates in a single transaction
        await this.db.messages.update(messageId, updates);
      });

      // Update the chat's lastUpdated timestamp
      await this.db.chats.update(chatId, { lastUpdated: new Date() });
    } catch (error) {
      console.error("Error updating message:", error);
      throw error;
    }
  }
}
