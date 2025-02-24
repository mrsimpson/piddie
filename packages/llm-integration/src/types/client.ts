import type { ChatCompletionCreateParams } from "openai/resources/chat/completions";

/**
 * Configuration for the LLM client
 */
export interface LLMClientConfig {
  /** Base URL for LLM API */
  baseUrl?: string;
  /** API key for LLM API */
  apiKey: string;
  /** Model to use for chat completions */
  model?: string;
  /** Additional parameters for chat completions */
  defaultParams?: Partial<ChatCompletionCreateParams>;
}
