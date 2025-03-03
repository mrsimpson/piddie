import { BaseLlmProviderAdapter } from "./LlmProviderAdapter";
import type { ModelInfo } from "../stores/settings-db";

/**
 * Mock provider adapter for development and testing
 */
export class MockAdapter extends BaseLlmProviderAdapter {
  getName(): string {
    return "Mock";
  }

  getDescription(): string {
    return "Mock LLM Provider (Development)";
  }

  getDefaultBaseUrl(): string {
    return "";
  }

  getDefaultModel(): string {
    return "mock-model";
  }

  requiresApiKey(): boolean {
    return false;
  }

  getBaseUrlHelpText(): string {
    return "Not required for mock provider.";
  }

  getDefaultModels(): ModelInfo[] {
    return [{ id: "mock-model", name: "Mock Model (Development)" }];
  }

  async fetchModels(_baseUrl: string, _apiKey: string): Promise<ModelInfo[]> {
    // Mock provider always returns the default models
    return this.getDefaultModels();
  }

  async verifyConnection(_baseUrl: string, _apiKey: string): Promise<boolean> {
    // Mock provider is always available
    return true;
  }
}
