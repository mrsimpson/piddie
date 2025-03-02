import { BaseLlmProviderAdapter } from "./LlmProviderAdapter";
import type { ModelInfo } from "../stores/settings-db";

/**
 * LiteLLM (OpenAI like) provider adapter
 */
export class LiteLlmAdapter extends BaseLlmProviderAdapter {
  getName(): string {
    return "LiteLLM";
  }

  getDescription(): string {
    return "LiteLLM API";
  }

  getDefaultBaseUrl(): string {
    return import.meta.env.VITE_LITELLM_BASE_URL || "http://localhost:4000/v1";
  }

  getDefaultModel(): string {
    return import.meta.env.VITE_LITELLM_MODEL;
  }

  getDefaultModels(): ModelInfo[] {
    return [];
  }

  async fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
    console.log(`LiteLlmAdapter.fetchModels: Fetching models from ${baseUrl}`);
    console.log(
      `LiteLlmAdapter.fetchModels: API key length: ${apiKey ? apiKey.length : 0}`
    );

    const url = `${baseUrl}/models`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    // Only add Authorization header if API key is provided
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    console.log(`LiteLlmAdapter.fetchModels: Request headers:`, headers);

    const response = await fetch(url, {
      method: "GET",
      headers
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`LiteLlmAdapter.fetchModels: API error:`, errorData);
      throw new Error(
        `Failed to connect to API: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
      );
    }

    const data = await response.json();
    console.log(
      `LiteLlmAdapter.fetchModels: Received ${data.data?.length || 0} models`
    );

    // Extract model information
    const models: ModelInfo[] = data.data
      .map((model: any) => ({
        id: model.id,
        name: model.id.replace(/^gpt-/, "GPT ").replace(/-/g, " "),
        created: model.created
      }))
      .sort((a: ModelInfo, b: ModelInfo) => {
        // Sort by creation date (newest first)
        if (a.created && b.created) {
          return b.created - a.created;
        }
        return a.id.localeCompare(b.id);
      });

    return models;
  }
}
