/**
 * Configuration for an LLM request
 */
export interface LLMRequestConfig {
  /** The message to send to the LLM */
  message: string;
  /** Optional model to use */
  model?: string;
}

/**
 * Response from an LLM request
 */
export interface LLMResponse {
  /** The response content */
  content: string;
  /** Additional metadata about the response */
  metadata?: Record<string, unknown>;
}

/**
 * MCP tool response content item
 */
export interface McpToolResponseContent {
  type: "text";
  text: string;
}

/**
 * MCP tool response
 */
export interface McpToolResponse {
  content: McpToolResponseContent[];
  metadata?: Record<string, unknown>;
}
