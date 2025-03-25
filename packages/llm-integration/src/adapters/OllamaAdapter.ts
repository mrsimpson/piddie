import { BaseLlmProviderAdapter } from "./LlmProviderAdapter";
import { type ModelInfo } from "@piddie/settings";

/**
 * Interface for Ollama tag response
 */
interface OllamaTag {
  name: string;
  modified_at: string;
  size: number;
}

/**
 * Ollama provider adapter
 */
export class OllamaAdapter extends BaseLlmProviderAdapter {
  getName(): string {
    return "Ollama";
  }

  getDescription(): string {
    return "Local Ollama Instance";
  }

  getDefaultBaseUrl(): string {
    return "http://localhost:11434";
  }

  getDefaultModel(): string {
    return "llama3.1";
  }

  override requiresApiKey(): boolean {
    return false;
  }

  override getBaseUrlHelpText(): string {
    return "URL where Ollama is running. Default is http://localhost:11434.";
  }

  getDefaultModels(): ModelInfo[] {
    return [];
  }

  async fetchModels(baseUrl: string): Promise<ModelInfo[]> {
    try {
      // Make a request to the Ollama tags endpoint
      const url = `${baseUrl}/api/tags`;

      const response: Response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to connect to Ollama API: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
        );
      }

      const data = await response.json();

      const responseData = data as {
        models: OllamaTag | OllamaTag[];
      };

      if (!responseData.models || !Array.isArray(responseData.models)) {
        throw new Error(
          "Invalid response from Ollama API: missing models array"
        );
      }

      // Extract model information
      const models: ModelInfo[] = responseData.models
        .map((model: OllamaTag) => {
          // Extract the base model name (remove tags)
          const baseName = model.name.split(":")[0] || model.name;

          // Format the name for display
          const displayName = baseName
            .replace(/^llama/, "Llama")
            .replace(/^mistral/, "Mistral")
            .replace(/^llava/, "LLaVA")
            .replace(/^phi/, "Phi")
            .replace(/^gemma/, "Gemma")
            .replace(/^mpt/, "MPT")
            .replace(/^falcon/, "Falcon")
            .replace(/^vicuna/, "Vicuna")
            .replace(/^orca/, "Orca")
            .replace(/^wizard/, "Wizard")
            .replace(/-/g, " ");

          return {
            id: model.name,
            name: displayName,
            created: new Date(model.modified_at).getTime() / 1000
          };
        })
        .sort((a: ModelInfo, b: ModelInfo) => {
          // Sort by creation date (newest first)
          if (a.created && b.created) {
            return b.created - a.created;
          }
          return a.id.localeCompare(b.id);
        });

      return models;
    } catch (error) {
      console.error("Error fetching Ollama models:", error);

      // If we can't fetch models, return the default ones
      return this.getDefaultModels();
    }
  }
}
