import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * Status of a chat message
 */
export enum MessageStatus {
  /** Message is being processed */
  Processing = "processing",
  /** Message has been delivered */
  Delivered = "delivered",
  /** Message has been read */
  Read = "read",
  /** Message failed to deliver */
  Failed = "failed"
}

/**
 * A chat conversation
 */
export interface Chat {
  /** Unique ID of the chat */
  id: string;
  /** When the chat was created */
  created: Date;
  /** When the chat was last updated */
  lastUpdated: Date;
  /** Additional metadata for the chat */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * A message in a chat conversation
 */
export interface ChatMessage
  extends Omit<
    ChatCompletionMessageParam,
    "name" | "function_call" | "tool_calls" | "tool_call_id"
  > {
  /** Unique ID of the message */
  id: string;
  /** ID of the chat this message belongs to */
  chatId: string;
  /** ID of the parent message (for threaded conversations) */
  parentId?: string | undefined;
  /** When the message was created */
  timestamp: Date;
  /** Status of the message */
  status: MessageStatus;
}

/**
 * State of a chat conversation
 */
export interface ChatState {
  /** Unique ID of the conversation */
  id: string;
  /** Title or name of the conversation */
  title?: string;
  /** Additional metadata for the conversation */
  metadata?: Record<string, unknown> | undefined;
  /** When the conversation was created */
  createdAt: Date;
  /** When the conversation was last updated */
  updatedAt: Date;
  /** Number of messages in the conversation */
  messageCount: number;
}

/**
 * Options for retrieving chat history
 */
export interface GetHistoryOptions {
  /** Maximum number of messages to return */
  limit?: number;
  /** Return messages before this timestamp */
  before?: Date;
  /** Return messages after this timestamp */
  after?: Date;
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
   * Retrieves the history of a chat conversation
   * @param conversationId The ID of the conversation to retrieve history for
   * @param options Optional options for filtering the history
   */
  getHistory(
    conversationId: string,
    options?: GetHistoryOptions
  ): Promise<ChatMessage[]>;

  /**
   * Retrieves the state of a chat conversation
   * @param conversationId The ID of the conversation to retrieve state for
   */
  getState(conversationId: string): Promise<ChatState>;

  /**
   * Lists all chat conversations
   * @param limit Optional limit on the number of conversations to return
   * @param offset Optional offset for pagination
   */
  listConversations(limit?: number, offset?: number): Promise<Chat[]>;

  /**
   * Gets a chat by ID with its messages
   * @param chatId ID of chat to get
   */
  getChat(chatId: string): Promise<Chat & { messages: ChatMessage[] }>;

  /**
   * Adds a message to a chat
   * @param chatId ID of chat to add message to
   * @param content Content of message
   * @param role Role of message sender
   * @param parentId Optional ID of parent message
   */
  addMessage(
    chatId: string,
    content: string,
    role: ChatCompletionMessageParam["role"],
    parentId?: string
  ): Promise<ChatMessage>;

  /**
   * Updates the status of a message
   * @param messageId ID of message to update
   * @param status New status
   */
  updateMessageStatus(messageId: string, status: MessageStatus): Promise<void>;

  /**
   * Deletes a chat and all its messages
   * @param id ID of chat to delete
   */
  deleteChat(id: string): Promise<void>;
}
