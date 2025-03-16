import type { LlmProviderAdapter } from "./LlmProviderAdapter";
import { LiteLlmAdapter } from "./LiteLlmAdapter";
import { OllamaAdapter } from "./OllamaAdapter";
import { MockAdapter } from "./MockAdapter";

// Provider type
export type ProviderType = "litellm" | "ollama" | "mock";

/**
 * Factory for creating LLM provider adapters
 */
export class LlmProviderFactory {
  private static providers: Map<ProviderType, LlmProviderAdapter> = new Map();

  /**
   * Get an adapter for the specified provider type
   * @param type The provider type
   * @returns The provider adapter
   */
  static getAdapter(type: ProviderType): LlmProviderAdapter {
    // Check if we already have an instance of this adapter
    if (!this.providers.has(type)) {
      // Create a new adapter instance
      let adapter: LlmProviderAdapter;

      switch (type) {
        case "litellm":
          adapter = new LiteLlmAdapter();
          break;
        case "ollama":
          adapter = new OllamaAdapter();
          break;
        case "mock":
          adapter = new MockAdapter();
          break;
        default:
          // Default to OpenAI
          adapter = new LiteLlmAdapter();
      }

      // Store the adapter instance
      this.providers.set(type, adapter);
    }

    // Return the adapter instance
    return this.providers.get(type)!;
  }

  /**
   * Get all available provider types
   * @returns Array of provider types
   */
  static getProviderTypes(): ProviderType[] {
    return ["litellm", "ollama", "mock"];
  }

  /**
   * Get display names for all providers
   * @returns Map of provider types to display names
   */
  static getProviderDisplayNames(): Map<ProviderType, string> {
    const displayNames = new Map<ProviderType, string>();

    displayNames.set("litellm", "LiteLLM");
    displayNames.set("ollama", "Ollama (Local)");
    displayNames.set("mock", "Mock (Development)");

    return displayNames;
  }

  /**
   * Get display name for a specific provider
   * @param type Provider type
   * @returns Display name for the provider
   */
  static getProviderDisplayName(type: ProviderType): string {
    const displayNames = this.getProviderDisplayNames();
    return displayNames.get(type) || type;
  }
}
