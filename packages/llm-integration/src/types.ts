import type { ChatCompletionRole } from "openai/resources/chat";
import type { MessageStatus } from "@piddie/chat-management";
import type { EventEmitter } from "./event-emitter";

/**
 * Represents a message sent to the LLM
 */
export interface LlmMessage {
  id: string;
  chatId: string;
  content: string;
  role: ChatCompletionRole;
  status: MessageStatus;
  created: Date;
  parentId?: string | undefined;
}

/**
 * Represents a response from the LLM
 */
export interface LlmResponse {
  id: string;
  chatId: string;
  content: string;
  role: ChatCompletionRole;
  created: Date;
  parentId?: string | undefined;
}

/**
 * Configuration for the LLM provider
 */
export interface LlmProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  selectedModel?: string;
  provider?: "openai" | "mock";
}

/**
 * Interface for the LLM client
 */
export interface LlmClient {
  /**
   * Sends a message to the LLM and receives a response
   * @param message The message to send
   * @returns A promise that resolves to the LLM response
   */
  sendMessage(message: LlmMessage): Promise<LlmResponse>;

  /**
   * Sends a message to the LLM and streams the response
   * @param message The message to send
   * @returns An event emitter that emits 'data', 'end', and 'error' events
   */
  streamMessage(message: LlmMessage): EventEmitter;
}

/**
 * Events emitted by the LLM client during streaming
 */
export enum LlmStreamEvent {
  DATA = "data",
  END = "end",
  ERROR = "error"
}

/**
 * Data structure for streaming response chunks
 */
export interface LlmStreamChunk {
  id: string;
  chatId: string;
  content: string;
  role: ChatCompletionRole;
  created: Date;
  parentId?: string | undefined;
  isComplete: boolean;
}
