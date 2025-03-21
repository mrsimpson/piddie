import { ref, reactive, onMounted, watch } from "vue";
import { defineStore } from "pinia";
import { useChatStore } from "@piddie/chat-management-ui-vue";
import { useFileSystemStore } from "@piddie/files-management-ui-vue";
import { MessageStatus, type ToolCall } from "@piddie/chat-management";
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
      provider: workbenchConfig.provider || "litellm"
    };
  };

  // LLM adapter instance
  let llmAdapter = createLlmAdapter(
    getLlmProviderConfig(),
    chatStore.chatManager
  );

  // Watch for file system initialization and register the MCP server
  watch(
    () => fileSystemStoreInstance.initialized,
    async (initialized) => {
      if (initialized) {
        // Create and register the file management MCP server
        fileManagementMcpServer.value = new FileManagementMcpServer(
          fileSystemStoreInstance.getBrowserFileSystem()
        );
        // Register the MCP server with the LLM adapter
        if (fileManagementMcpServer.value && llmAdapter) {
          try {
            await llmAdapter.registerMcpServer(
              fileManagementMcpServer.value as unknown as McpServer,
              "file_management"
            );
            console.log("File management MCP server registered successfully");
          } catch (error) {
            console.error(
              "Failed to register file management MCP server:",
              error
            );
          }
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
      llmAdapter = createLlmAdapter(
        getLlmProviderConfig(),
        chatStore.chatManager
      );

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
      llmAdapter = createLlmAdapter(
        getLlmProviderConfig(),
        chatStore.chatManager
      );

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
      llmAdapter = createLlmAdapter(
        getLlmProviderConfig(),
        chatStore.chatManager
      );

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
      if (!workbenchConfig.apiKey && workbenchConfig.provider === "litellm") {
        //TODO: replace with a metadata at te providers that it needs a key
        error.value = new Error("API key is not set");
        return;
      }

      error.value = null;
      isProcessing.value = true;
      isStreaming.value = useStreaming;

      // Create the user message directly in the database
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

      // Create a temporary placeholder for the assistant's response
      const assistantMessage = await chatStore.addMessage(
        chatId,
        "",
        "assistant",
        modelName,
        userMessage.id,
        MessageStatus.SENDING,
        true
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
        provider: workbenchConfig.provider || "litellm",
        assistantMessageId: assistantMessage.id
      };

      // Track accumulated content and tool calls during streaming
      let accumulatedContent = "";
      let accumulatedToolCalls: ToolCall[] = [];

      // Map to track function call arguments by function name
      // Format: { "functionName": { argumentString, isComplete, callIndex } }
      const functionArgsMap = new Map<
        string,
        {
          argumentString: string;
          isComplete: boolean;
          callIndex: number;
        }
      >();

      // Counter to track tool calls with the same name
      const functionCallCounters: Record<string, number> = {};

      // Function to finalize processing
      const finalizeProcessing = async () => {
        isProcessing.value = false;
        isStreaming.value = false;

        try {
          // Process any incomplete function arguments in the map
          if (functionArgsMap.size > 0) {
            const finalToolCalls: ToolCall[] = [];

            // First add all the already processed tool calls
            finalToolCalls.push(...accumulatedToolCalls);

            // Process any remaining function arguments that might not have been processed yet
            functionArgsMap.forEach((value, functionName) => {
              if (!value.isComplete) {
                try {
                  // Try to parse the accumulated argument string
                  const argString = value.argumentString.trim();

                  // Only try to parse if it looks like complete JSON
                  if (
                    (argString.startsWith("{") && argString.endsWith("}")) ||
                    (argString.startsWith("[") && argString.endsWith("]"))
                  ) {
                    const functionArgs = JSON.parse(argString);

                    // Check if this function call already exists in finalToolCalls
                    const existingIndex = finalToolCalls.findIndex(
                      (tc) =>
                        tc.function.name === functionName &&
                        JSON.stringify(tc.function.arguments) ===
                          JSON.stringify(functionArgs)
                    );

                    if (existingIndex === -1) {
                      // Add as a new tool call if it doesn't exist
                      finalToolCalls.push({
                        function: {
                          name: functionName,
                          arguments: functionArgs
                        }
                      });
                    }

                    // Mark as complete
                    value.isComplete = true;
                  }
                } catch (e) {
                  // If parsing fails, it might be incomplete JSON
                  console.warn(
                    `Failed to parse function arguments for ${functionName}:`,
                    e
                  );
                }
              }
            });

            // Update the accumulated tool calls
            accumulatedToolCalls = finalToolCalls;
          }

          // Persist the temporary message with final content and tool calls
          await chatStore.persistEphemeralMessage(assistantMessage.id, {
            content: accumulatedContent,
            status: MessageStatus.SENT,
            tool_calls: accumulatedToolCalls
          });
        } catch (err) {
          console.error("Error persisting assistant message:", err);
          chatStore.updateMessageStatus(
            assistantMessage.id,
            MessageStatus.ERROR
          );
        }
      };

      if (useStreaming) {
        // Handle streaming response
        const handleChunk = (chunk: LlmStreamChunk) => {
          if (chunk.content) {
            accumulatedContent += chunk.content;
            chatStore.updateMessageContent(
              assistantMessage.id,
              accumulatedContent
            );
          }

          // Handle tool calls in the chunk
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            // Process each tool call
            chunk.tool_calls.forEach((toolCall) => {
              const functionName = toolCall.function.name;

              // Check if we already have an entry for this function name
              let entry = functionArgsMap.get(functionName);

              // If we have a complete entry or no entry, create a new one
              if (!entry || entry.isComplete) {
                // Get or increment the counter for this function name
                functionCallCounters[functionName] =
                  (functionCallCounters[functionName] || 0) + 1;
                const callIndex = functionCallCounters[functionName] - 1;

                // Create a new entry
                entry = {
                  argumentString: "",
                  isComplete: false,
                  callIndex: callIndex
                };
              }

              // Append the new argument chunk
              if (typeof toolCall.function.arguments === "string") {
                entry.argumentString += toolCall.function.arguments;

                // Check if this chunk completes the JSON object
                const argString = entry.argumentString.trim();
                if (
                  (argString.startsWith("{") && argString.endsWith("}")) ||
                  (argString.startsWith("[") && argString.endsWith("]"))
                ) {
                  try {
                    // Try to parse the arguments
                    const functionArgs = JSON.parse(argString);

                    // Create a new tool call with the parsed arguments
                    const newToolCall: ToolCall = {
                      function: {
                        name: functionName,
                        arguments: functionArgs
                      }
                    };

                    // Check if we already have this tool call
                    const existingIndex = accumulatedToolCalls.findIndex(
                      (tc) =>
                        tc.function.name === functionName &&
                        JSON.stringify(tc.function.arguments) ===
                          JSON.stringify(functionArgs)
                    );

                    if (existingIndex === -1) {
                      // Add to accumulated tool calls
                      accumulatedToolCalls.push(newToolCall);
                    }

                    // Mark as complete and create a new entry for future chunks with this function name
                    entry.isComplete = true;

                    // Start a new entry for the next call to this function
                    functionCallCounters[functionName] =
                      (functionCallCounters[functionName] || 0) + 1;
                  } catch {
                    // If parsing fails, it's likely incomplete JSON
                    // We'll continue accumulating
                  }
                }
              } else if (toolCall.function.arguments) {
                // If it's already an object, it's complete
                entry.argumentString = JSON.stringify(
                  toolCall.function.arguments
                );
                entry.isComplete = true;

                // Create a new tool call
                const newToolCall: ToolCall = {
                  function: {
                    name: functionName,
                    arguments: toolCall.function.arguments
                  }
                };

                // Check if we already have this tool call
                const existingIndex = accumulatedToolCalls.findIndex(
                  (tc) =>
                    tc.function.name === functionName &&
                    JSON.stringify(tc.function.arguments) ===
                      JSON.stringify(toolCall.function.arguments)
                );

                if (existingIndex === -1) {
                  // Add to accumulated tool calls
                  accumulatedToolCalls.push(newToolCall);
                }

                // Start a new entry for the next call to this function
                functionCallCounters[functionName] =
                  (functionCallCounters[functionName] || 0) + 1;
              }

              // Update the map
              functionArgsMap.set(functionName, entry);
            });

            // Update the UI with current tool calls
            chatStore.updateMessageToolCalls(
              assistantMessage.id,
              accumulatedToolCalls
            );
          }
        };

        try {
          // Process the message with streaming
          console.log("[LlmStore] Starting streaming process");
          const emitter = await llmAdapter.processMessageStream(
            llmMessage,
            handleChunk
          );

          // Set up event listeners
          emitter.on("end", async () => {
            console.log("[LlmStore] Stream ended, finalizing processing");
            await finalizeProcessing();
          });

          emitter.on("error", async (err: unknown) => {
            console.error("[LlmStore] Error in LLM stream:", err);
            error.value = err instanceof Error ? err : new Error(String(err));
            chatStore.updateMessageStatus(
              assistantMessage.id,
              MessageStatus.ERROR
            );
            await finalizeProcessing();
          });
        } catch (err: unknown) {
          console.error("Error setting up streaming:", err);
          error.value = err instanceof Error ? err : new Error(String(err));
          chatStore.updateMessageStatus(
            assistantMessage.id,
            MessageStatus.ERROR
          );
          await finalizeProcessing();
        }
      } else {
        // Handle non-streaming response
        try {
          const response = await llmAdapter.processMessage(llmMessage);

          // Update accumulated content
          accumulatedContent = response.content || "";

          // Convert tool calls to the correct format if present
          if (response.tool_calls && response.tool_calls.length > 0) {
            // Process each tool call
            response.tool_calls.forEach((toolCall) => {
              const functionName = toolCall.function.name;

              try {
                // Parse arguments if they're a string
                const functionArgs =
                  typeof toolCall.function.arguments === "string"
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function.arguments;

                // Create a new tool call with the parsed arguments
                const newToolCall: ToolCall = {
                  function: {
                    name: functionName,
                    arguments: functionArgs
                  }
                };

                // Add to accumulated tool calls
                accumulatedToolCalls.push(newToolCall);

                // Also add to the map for consistency with streaming case
                functionCallCounters[functionName] =
                  (functionCallCounters[functionName] || 0) + 1;
                const callIndex = functionCallCounters[functionName] - 1;

                functionArgsMap.set(functionName, {
                  argumentString:
                    typeof toolCall.function.arguments === "string"
                      ? toolCall.function.arguments
                      : JSON.stringify(toolCall.function.arguments),
                  isComplete: true,
                  callIndex: callIndex
                });
              } catch (e) {
                console.error(
                  `Error parsing function arguments for ${functionName}:`,
                  e
                );
              }
            });
          }

          // Update the temporary message
          chatStore.updateMessageContent(
            assistantMessage.id,
            accumulatedContent
          );
          if (accumulatedToolCalls.length > 0) {
            chatStore.updateMessageToolCalls(
              assistantMessage.id,
              accumulatedToolCalls
            );
          }

          // Finalize processing
          await finalizeProcessing();
        } catch (err: unknown) {
          console.error("Error processing message:", err);
          error.value = err instanceof Error ? err : new Error(String(err));
          chatStore.updateMessageStatus(
            assistantMessage.id,
            MessageStatus.ERROR
          );
          await finalizeProcessing();
        }
      }
    } catch (err: unknown) {
      console.error("Error in sendMessage:", err);
      error.value = err instanceof Error ? err : new Error(String(err));
      isProcessing.value = false;
      isStreaming.value = false;
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
    isProcessing,
    isStreaming,
    error,
    connectionStatus,
    isLoading,
    isVerifying,
    workbenchConfig,
    config: workbenchConfig, // Expose workbenchConfig as config for backward compatibility
    availableModels,
    verifyConnection,
    updateConfig,
    resetConfig,
    sendMessage,
    cancelStreaming,
    getStoredProviderConfig
  };
});
