import { BaseLlmProviderAdapter } from "./LlmProviderAdapter";
import type { ModelInfo } from "@piddie/settings";

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

  override requiresApiKey(): boolean {
    return false;
  }

  override getBaseUrlHelpText(): string {
    return "Not required for mock provider.";
  }

  getDefaultModels(): ModelInfo[] {
    return [{ id: "mock-model", name: "Mock Model (Development)" }];
  }

  async fetchModels(): Promise<ModelInfo[]> {
    // Mock provider always returns the default models
    return this.getDefaultModels();
  }

  override async verifyConnection(): Promise<boolean> {
    // Mock provider is always available
    return true;
  }
}
