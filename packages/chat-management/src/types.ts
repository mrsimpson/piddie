import type { ChatCompletionRole } from "openai/resources/chat";

/**
 * Represents the status of a message
 */
export enum MessageStatus {
  SENDING = "sending",
  SENT = "sent",
  ERROR = "error"
}

/**
 * Represents a chat message, composing with OpenAI's message format
 */
export interface Message {
  id: string;
  chatId: string;
  content: string;
  role: ChatCompletionRole;
  status: MessageStatus;
  created: Date;
  username: string | undefined;
  parentId: string | undefined; // For threading/replies
}

/**
 * Represents a chat conversation
 */
export interface Chat {
  id: string;
  messages: Message[];
  created: Date;
  lastUpdated: Date;
  metadata: Record<string, unknown> | undefined; // For chat-specific data
}

/**
 * Interface for managing chat conversations
 */
export interface ChatManager {
  /**
   * Creates a new chat conversation
   * @param metadata Optional metadata for the chat
   */
  createChat(metadata?: Record<string, unknown>): Promise<Chat>;

  /**
   * Adds a message to a chat
   * @param chatId The ID of the chat to add the message to
   * @param content The message content
   * @param role The role of the sender
   * @param parentId Optional ID of the parent message (for replies)
   */
  addMessage(
    chatId: string,
    content: string,
    role: ChatCompletionRole,
    parentId?: string
  ): Promise<Message>;

  /**
   * Retrieves a chat by its ID
   * @param chatId The ID of the chat to retrieve
   */
  getChat(chatId: string): Promise<Chat>;

  /**
   * Lists all chats
   * @param limit Optional limit on the number of chats to return
   * @param offset Optional offset for pagination
   */
  listChats(limit?: number, offset?: number): Promise<Chat[]>;

  /**
   * Updates a message's status
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param status The new status
   */
  updateMessageStatus(
    chatId: string,
    messageId: string,
    status: MessageStatus
  ): Promise<void>;

  /**
   * Updates a message's content
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param content The new content
   */
  updateMessageContent(
    chatId: string,
    messageId: string,
    content: string
  ): Promise<void>;

  /**
   * Deletes a chat and all its messages
   * @param chatId The ID of the chat to delete
   */
  deleteChat(chatId: string): Promise<void>;
}
