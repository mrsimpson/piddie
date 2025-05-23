import type { ChatCompletionRole } from "openai/resources/chat";

export type { ChatCompletionRole };

/**
 * Represents the status of a message
 */
export enum MessageStatus {
  SENDING = "sending",
  SENT = "sent",
  ERROR = "error"
}

/**
 * Represents a tool call from an LLM
 */
export interface ToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
  result?: ToolCallResult;
}

/**
 * Represents the result of a tool call execution
 */
export interface ToolCallResult {
  status: "success" | "error";
  value: unknown;
  contentType?: string; // Optional descriptor for serialization
  timestamp?: Date; // When the tool was executed
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
  tool_calls?: ToolCall[]; // Tool calls extracted from the LLM response
}

/**
 * Represents a chat conversation
 */
export interface Chat {
  id: string;
  messages: Message[];
  created: Date;
  lastUpdated: Date;
  projectId: string;
  metadata: Record<string, unknown> | undefined; // For chat-specific data
}

/**
 * Interface for managing chat conversations
 */
export interface ChatManager {
  /**
   * Creates a new chat conversation
   * @param projectId project ID this chat belongs to
   * @param metadata Optional metadata for the chat
   */
  createChat(
    projectId: string,
    metadata?: Record<string, unknown>
  ): Promise<Chat>;

  /**
   * Adds a message to a chat
   * @param chatId The ID of the chat to add the message to
   * @param content The message content
   * @param role The role of the sender
   * @param username Human identifiable name of the sender
   * @param parentId Optional ID of the parent message (for replies)
   *
   */
  addMessage(
    chatId: string,
    content: string,
    role: ChatCompletionRole,
    username: string,
    parentId?: string,
    created?: Date
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
   * Lists chats for a specific project
   * @param projectId The ID of the project to list chats for
   * @param limit Optional limit on the number of chats to return
   * @param offset Optional offset for pagination
   */
  listProjectChats(
    projectId: string,
    limit?: number,
    offset?: number
  ): Promise<Chat[]>;

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
   * Updates multiple aspects of a message in a single transaction
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param updates Object containing the updates to apply
   */
  updateMessage(
    chatId: string,
    messageId: string,
    updates: {
      content?: string;
      status?: MessageStatus;
      tool_calls?: ToolCall[];
    }
  ): Promise<void>;

  /**
   * Updates a message's tool calls
   * @param chatId The ID of the chat containing the message
   * @param messageId The ID of the message to update
   * @param toolCalls The tool calls to add
   */
  updateMessageToolCalls(
    chatId: string,
    messageId: string,
    toolCalls: ToolCall[]
  ): Promise<void>;

  /**
   * Deletes a chat and all its messages
   * @param chatId The ID of the chat to delete
   */
  deleteChat(chatId: string): Promise<void>;
}
