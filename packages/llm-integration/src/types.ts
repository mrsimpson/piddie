import type { ChatCompletionRole } from "openai/resources/chat";
import type { MessageStatus, ToolCall } from "@piddie/chat-management";
import type { EventEmitter } from "@piddie/shared-types";

/**
 * Interface for LLM messages
 */
export interface LlmMessage {
  /** Unique identifier for the message */
  id: string;

  /** ID of the chat this message belongs to */
  chatId: string;

  /** Content of the message */
  content: string;

  /** Role of the message sender (user, assistant, system) */
  role: ChatCompletionRole;

  /** Status of the message */
  status: MessageStatus;

  /** Timestamp when the message was created */
  created: Date;

  /** ID of the parent message, if any */
  parentId?: string;

  /** System prompt to use for this message */
  systemPrompt?: string;

  /** Provider to use for this message */
  provider: string;

  /** ID of the assistant message placeholder (for updating existing messages) */
  assistantMessageId?: string;

  /** Array of messages for the conversation history */
  messages?: Array<{
    role: string;
    content: string;
  }>;

  /** Tools to be used by the LLM */
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
}

/**
 * Interface for LLM responses
 */
export interface LlmResponse {
  /** Unique identifier for the response */
  id: string;

  /** ID of the chat this response belongs to */
  chatId: string;

  /** Content of the response */
  content: string;

  /** Role of the response sender (usually 'assistant') */
  role: ChatCompletionRole;

  /** Timestamp when the response was created */
  created: Date;

  /** ID of the parent message */
  parentId?: string;

  /** Tool calls included in the response */
  tool_calls?: ToolCall[];

  /** Results of executed tool calls */
  tool_results?: Record<string, unknown>;
}

// Alias for linting purposes
export type _LlmResponse = LlmResponse;

/**
 * Interface for LLM client
 */
export interface LlmClient {
  /**
   * Process a message and return a response
   * @param message The message to process
   * @returns The response from the LLM
   */
  sendMessage(message: LlmMessage): Promise<LlmResponse>;

  /**
   * Process a message and stream the response
   * @param message The message to process
   * @returns An event emitter that emits 'data', 'end', and 'error' events
   */
  streamMessage(message: LlmMessage): EventEmitter;

  /**
   * Checks if the LLM supports function calling/tools
   * @returns A promise that resolves to true if tools are supported, false otherwise
   */
  checkToolSupport(): Promise<boolean>;
}

/**
 * Interface for LLM provider configuration
 */
export interface LlmProviderConfig {
  /** Provider type (openai, mock, etc.) – determines the adapter */
  provider: string;

  /** Human identifyable name of the provider */
  name?: string;

  /** Description of the provider */
  description?: string;

  /** Model to use for the provider */
  model: string;

  /** API key for the provider */
  apiKey?: string;

  /** Base URL for the provider API */
  baseUrl?: string;

  /** Selected model for the provider */
  selectedModel?: string;

  /** Default model for the provider */
  defaultModel?: string;

  /** Client implementation for the provider */
  client?: LlmClient;
}

/**
 * Enum for LLM stream events
 */
export enum LlmStreamEvent {
  DATA = "data",
  END = "end",
  ERROR = "error"
}

/**
 * Interface for LLM stream chunks
 */
export interface LlmStreamChunk {
  /** Content of the chunk */
  content: string;

  /** Tool calls included in the chunk */
  tool_calls?: ToolCall[];

  /** Result of a tool execution */
  tool_result?: {
    name: string;
    result: unknown;
  };

  /** Whether this is the final chunk */
  isFinal: boolean;
}

// re-export the tool call. TODO: clarify which package shall own it
export type { ToolCall };
