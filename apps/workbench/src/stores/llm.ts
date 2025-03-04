import { ref, reactive, onMounted, watch } from "vue";
import { defineStore } from "pinia";
import { useChatStore } from "./chat";
import { useFileSystemStore } from "./file-system";
import { MessageStatus } from "@piddie/chat-management";
import { FileManagementMcpServer } from "@piddie/files-management";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import settingsManager from "./settings-db";
import type {
  LlmProviderConfig as WorkbenchLlmConfig,
  ModelInfo
} from "./settings-db";
import { LlmProviderFactory } from "../adapters/LlmProviderFactory";
import type { ProviderType } from "../adapters/LlmProviderFactory";

// Import from the llm-integration package
import {
  createLlmAdapter,
  LlmStreamEvent,
  type LlmStreamChunk,
  type LlmProviderConfig,
  type LlmMessage
} from "@piddie/llm-integration";

export const useLlmStore = defineStore("llm", () => {
  const chatStore = useChatStore();
  const fileSystemStoreInstance = useFileSystemStore();
  const isStreaming = ref(false);
  const isProcessing = ref(false);
  const streamingMessageId = ref<string | null>(null);
  const error = ref<Error | null>(null);
  const isLoading = ref(true);
  const isVerifying = ref(false);
  const connectionStatus = ref<"none" | "success" | "error">("none");
  const availableModels = ref<ModelInfo[]>([]);
  const fileManagementMcpServer = ref<FileManagementMcpServer | null>(null);

  // Create a wrapper for the file system store that implements the FileSystemStore interface

  // Reactive configuration object for workbench
  const workbenchConfig = reactive<WorkbenchLlmConfig>({
    apiKey: "",
    baseUrl: "http://localhost:4000/v1",
    defaultModel: "",
    selectedModel: "",
    provider: "litellm" // Set default provider
  });

  // Create LLM provider config for the LLM integration package
  const getLlmProviderConfig = (): LlmProviderConfig => {
    let name, description;

    if (workbenchConfig.provider === "litellm") {
      name = "LiteLLM";
      description = "LiteLLM API";
    } else if (workbenchConfig.provider === "ollama") {
      name = "Ollama";
      description = "Local Ollama Instance";
    } else {
      name = "Mock";
      description = "Mock LLM Provider";
    }

    // Log the config being created for debugging
    console.log("Creating LLM provider config:", {
      name,
      description,
      provider: workbenchConfig.provider,
      apiKeyLength: workbenchConfig.apiKey ? workbenchConfig.apiKey.length : 0,
      baseUrl: workbenchConfig.baseUrl,
      model: workbenchConfig.selectedModel || workbenchConfig.defaultModel
    });

    return {
      name,
      description,
      apiKey: workbenchConfig.apiKey,
      model: workbenchConfig.selectedModel || workbenchConfig.defaultModel,
      baseUrl: workbenchConfig.baseUrl,
      selectedModel: workbenchConfig.selectedModel,
      defaultModel: workbenchConfig.defaultModel,
      provider: workbenchConfig.provider
    };
  };

  // LLM adapter instance
  let llmAdapter = createLlmAdapter(getLlmProviderConfig());

  // Watch for file system initialization and register the MCP server
  watch(
    () => fileSystemStoreInstance.initialized,
    (initialized) => {
      if (initialized) {
        // Create and register the file management MCP server
        fileManagementMcpServer.value = new FileManagementMcpServer(
          fileSystemStoreInstance.getBrowserFileSystem()
        );
        // Register the MCP server with the LLM adapter
        if (fileManagementMcpServer.value && llmAdapter) {
          llmAdapter.registerMcpServer(
            fileManagementMcpServer.value as unknown as McpServer,
            "file_management"
          );
        }
      }
    }
  );

  // Update the file system when it changes
  watch(
    () => fileSystemStoreInstance.getBrowserFileSystem(),
    (newFileSystem) => {
      if (fileManagementMcpServer.value) {
        fileManagementMcpServer.value.updateFileSystem(newFileSystem);
      }
    }
  );

  // Load settings from database on store initialization
  onMounted(async () => {
    try {
      isLoading.value = true;

      // Load LLM config
      const loadedConfig = await settingsManager.getLlmConfig();

      // Load selected provider from workbench settings
      const selectedProvider = await settingsManager.getSelectedProvider();

      // Update the reactive config object
      Object.assign(workbenchConfig, loadedConfig, {
        provider: selectedProvider
      });

      // Set available models if they exist
      if (
        loadedConfig.availableModels &&
        loadedConfig.availableModels.length > 0
      ) {
        availableModels.value = loadedConfig.availableModels;
      }

      // Recreate the adapter with the loaded configuration
      llmAdapter = createLlmAdapter(getLlmProviderConfig());

      // Re-register the file management MCP server if it exists
      if (fileManagementMcpServer.value) {
        llmAdapter.registerMcpServer(
          fileManagementMcpServer.value as unknown as McpServer,
          "file_management"
        );
      }
    } catch (err) {
      console.error("Error loading LLM settings:", err);
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      isLoading.value = false;
    }
  });

  /**
   * Verifies the connection to the LLM provider API and retrieves available models
   */
  async function verifyConnection() {
    try {
      isVerifying.value = true;
      connectionStatus.value = "none";
      error.value = null;

      // Log the config being used for verification
      console.log("Verifying connection with config:", {
        provider: workbenchConfig.provider,
        baseUrl: workbenchConfig.baseUrl,
        apiKeyLength: workbenchConfig.apiKey
          ? workbenchConfig.apiKey.length
          : 0,
        model: workbenchConfig.defaultModel
      });

      if (!workbenchConfig.provider) {
        throw new Error("No provider selected");
      }

      // Get the adapter for the current provider
      const adapter = LlmProviderFactory.getAdapter(workbenchConfig.provider);

      // Fetch models using the adapter
      const models = await adapter.fetchModels(
        workbenchConfig.baseUrl,
        workbenchConfig.apiKey
      );

      // Update the available models
      availableModels.value = models;

      // Update the config with the available models
      await settingsManager.updateLlmConfig({
        availableModels: models
      });

      connectionStatus.value = "success";

      // Re-register the MCP server if it exists
      if (fileManagementMcpServer.value) {
        llmAdapter.registerMcpServer(
          fileManagementMcpServer.value as unknown as McpServer,
          "file_management"
        );
      }

      return true;
    } catch (err) {
      console.error("Error verifying connection:", err);
      error.value = err instanceof Error ? err : new Error(String(err));
      connectionStatus.value = "error";
      return false;
    } finally {
      isVerifying.value = false;
    }
  }

  /**
   * Updates the LLM configuration and saves it to the database
   * @param newConfig The new configuration
   */
  async function updateConfig(newConfig: Partial<WorkbenchLlmConfig>) {
    try {
      // If provider is being updated, save it to workbench settings
      if (newConfig.provider) {
        await settingsManager.updateSelectedProvider(newConfig.provider);
      }

      // If availableModels is being updated, update the reactive ref directly
      if (newConfig.availableModels) {
        availableModels.value = newConfig.availableModels;
      }

      // Ensure API key is preserved if not explicitly provided in the new config
      if (newConfig.provider && !newConfig.apiKey) {
        // If switching providers but no API key provided, keep the current one
        newConfig.apiKey = workbenchConfig.apiKey;
      }

      // Remove provider from newConfig as it's stored in workbench settings
      const { provider, ...configWithoutProvider } = newConfig;

      // Update the database
      const updatedConfig = await settingsManager.updateLlmConfig(
        configWithoutProvider
      );

      // Update the reactive config object with both the updated config and provider
      Object.assign(workbenchConfig, updatedConfig, {
        provider: provider || workbenchConfig.provider
      });

      // Recreate the adapter with the new configuration
      llmAdapter = createLlmAdapter(getLlmProviderConfig());

      // Re-register the file management MCP server if it exists
      if (fileManagementMcpServer.value) {
        llmAdapter.registerMcpServer(
          fileManagementMcpServer.value as unknown as McpServer,
          "file_management"
        );
      }

      return true;
    } catch (err) {
      console.error("Error updating LLM config:", err);
      error.value = err instanceof Error ? err : new Error(String(err));
      return false;
    }
  }

  /**
   * Resets the LLM configuration to defaults
   */
  async function resetConfig() {
    try {
      // Reset the database
      const defaultConfig = await settingsManager.resetLlmConfig();

      // Reset the selected provider to default
      await settingsManager.updateSelectedProvider("litellm");

      // Update the reactive config object
      Object.assign(workbenchConfig, defaultConfig, { provider: "litellm" });

      // Recreate the adapter with the default configuration
      llmAdapter = createLlmAdapter(getLlmProviderConfig());

      // Re-register the file management MCP server if it exists
      if (fileManagementMcpServer.value) {
        llmAdapter.registerMcpServer(
          fileManagementMcpServer.value as unknown as McpServer,
          "file_management"
        );
      }

      return true;
    } catch (err) {
      console.error("Error resetting LLM config:", err);
      error.value = err instanceof Error ? err : new Error(String(err));
      return false;
    }
  }

  /**
   * Sends a message to the LLM and receives a response
   * @param content The message content
   * @param chatId The ID of the chat to send the message to
   * @param useStreaming Whether to use streaming for the response
   */
  async function sendMessage(
    content: string,
    chatId: string,
    useStreaming = true
  ) {
    try {
      // Check if API key is set
      if (!workbenchConfig.apiKey && workbenchConfig.provider !== "mock") {
        throw new Error(
          "API key is not set. Please configure your LLM settings."
        );
      }

      error.value = null;
      isProcessing.value = true;
      isStreaming.value = useStreaming;

      // Add the user message to the chat
      const userMessage = await chatStore.addMessage(
        chatId,
        content,
        "user",
        "Developer"
      );

      // Get the model name to use as the username for the assistant message
      const modelName =
        workbenchConfig.provider === "mock"
          ? "Mock Model"
          : workbenchConfig.selectedModel || workbenchConfig.defaultModel;

      // Create a placeholder for the assistant's response with SENDING status
      const assistantMessage = await chatStore.addMessage(
        chatId,
        "",
        "assistant",
        modelName, // Pass the model name as the username
        MessageStatus.SENDING // Set initial status to SENDING
      );

      // Convert the message to the format expected by the LLM adapter
      const llmMessage: LlmMessage = {
        id: userMessage.id,
        chatId: userMessage.chatId,
        content: userMessage.content,
        role: userMessage.role,
        status: userMessage.status,
        created: userMessage.created,
        parentId: userMessage.parentId,
        provider: workbenchConfig.provider || "litellm" // Ensure provider is never undefined
      };

      // Reset streaming message ID
      streamingMessageId.value = assistantMessage.id;

      const finalizeProcessing = () => {
        isStreaming.value = false;
        isProcessing.value = false;
        streamingMessageId.value = null;
      };

      if (useStreaming) {
        // Keep track of accumulated content
        let accumulatedContent = "";

        const handleChunk = (chunk: LlmStreamChunk) => {
          // Only append content if it's not a final chunk with duplicate content
          if (!chunk.isFinal) {
            // Append the new content to the accumulated content
            accumulatedContent += chunk.content;

            // Update the assistant message with the accumulated content
            chatStore.updateMessageContent(
              assistantMessage.id,
              accumulatedContent
            );
          }
        };

        try {
          // Process the message with streaming
          const emitter = await llmAdapter.processMessageStream(
            llmMessage,
            handleChunk
          );

          // Listen for the END event to finalize processing
          emitter.once(LlmStreamEvent.END, () => {
            // Finalize processing when streaming is complete
            finalizeProcessing();
          });

          // Listen for ERROR events
          emitter.once(LlmStreamEvent.ERROR, (err: unknown) => {
            error.value = err instanceof Error ? err : new Error(String(err));
            finalizeProcessing();
          });
        } catch (err) {
          // Set error value
          error.value = err instanceof Error ? err : new Error(String(err));
          finalizeProcessing();
        }
      } else {
        // Use non-streaming for simpler implementation
        const response = await llmAdapter.processMessage(llmMessage);

        // Update the assistant message with the response
        chatStore.updateMessageContent(assistantMessage.id, response.content);

        // Let the orchestrator handle status updates
        // We only need to finalize processing on our end
        finalizeProcessing();
      }
    } catch (err) {
      console.error("Error sending message:", err);
      error.value = err instanceof Error ? err : new Error(String(err));

      // Ensure states are reset in case of an error
      isStreaming.value = false;
      isProcessing.value = false;
      streamingMessageId.value = null;
    }
  }

  /**
   * Cancels the current streaming response
   */
  function cancelStreaming() {
    if (isStreaming.value && streamingMessageId.value) {
      isStreaming.value = false;
      isProcessing.value = false;
      streamingMessageId.value = null;
    }
  }

  /**
   * Gets the stored configuration for a specific provider
   * @param providerType The provider type to get configuration for
   * @returns The stored configuration for the provider, or undefined if not found
   */
  async function getStoredProviderConfig(
    providerType: ProviderType
  ): Promise<WorkbenchLlmConfig | undefined> {
    try {
      // Get all stored configurations
      const storedConfig = await settingsManager.getLlmConfig();

      // If the requested provider matches the current stored provider, return the full config
      if (storedConfig.provider === providerType) {
        return storedConfig;
      }

      // Otherwise, return undefined as we don't currently store separate configs per provider
      return undefined;
    } catch (err) {
      console.error(
        `Error getting stored config for provider ${providerType}:`,
        err
      );
      return undefined;
    }
  }

  return {
    isStreaming,
    isProcessing,
    isLoading,
    isVerifying,
    connectionStatus,
    streamingMessageId,
    error,
    config: workbenchConfig, // Expose the workbench config
    availableModels,
    verifyConnection,
    updateConfig,
    resetConfig,
    sendMessage,
    cancelStreaming,
    getStoredProviderConfig
  };
});
