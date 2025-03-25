import type { ModelInfo } from "@piddie/settings";

/**
 * Interface for LLM provider adapters
 */
export interface LlmProviderAdapter {
  /**
   * Get the provider name
   */
  getName(): string;

  /**
   * Get the provider description
   */
  getDescription(): string;

  /**
   * Get the default base URL for the provider
   */
  getDefaultBaseUrl(): string;

  /**
   * Get the default model for the provider
   */
  getDefaultModel(): string;

  /**
   * Check if the provider requires an API key
   */
  requiresApiKey(): boolean;

  /**
   * Get the placeholder text for the API key input
   */
  getApiKeyPlaceholder(): string;

  /**
   * Get the placeholder text for the base URL input
   */
  getBaseUrlPlaceholder(): string;

  /**
   * Get the help text for the base URL input
   */
  getBaseUrlHelpText(): string;

  /**
   * Get the default models for the provider
   */
  getDefaultModels(): ModelInfo[];

  /**
   * Fetch available models from the provider
   * @param baseUrl The base URL of the provider API
   * @param apiKey The API key for the provider
   */
  fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]>;

  /**
   * Verify the connection to the provider
   * @param baseUrl The base URL of the provider API
   * @param apiKey The API key for the provider
   */
  verifyConnection(baseUrl: string, apiKey: string): Promise<boolean>;
}

export interface ApiResponse {
  data: ModelInfo[];
}

/**
 * Base class for LLM provider adapters
 */
export abstract class BaseLlmProviderAdapter implements LlmProviderAdapter {
  abstract getName(): string;
  abstract getDescription(): string;
  abstract getDefaultBaseUrl(): string;
  abstract getDefaultModel(): string;

  requiresApiKey(): boolean {
    return true;
  }

  getApiKeyPlaceholder(): string {
    return `Enter your ${this.getName()} API key`;
  }

  getBaseUrlPlaceholder(): string {
    return this.getDefaultBaseUrl();
  }

  getBaseUrlHelpText(): string {
    return "Change this if you're using a proxy or alternative endpoint.";
  }

  abstract getDefaultModels(): ModelInfo[];
  abstract fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]>;

  async verifyConnection(baseUrl: string, apiKey: string): Promise<boolean> {
    try {
      await this.fetchModels(baseUrl, apiKey);
      return true;
    } catch {
      return false;
    }
  }
}
