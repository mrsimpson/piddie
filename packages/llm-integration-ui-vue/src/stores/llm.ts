import { ref, reactive, onMounted } from "vue";
import { defineStore } from "pinia";
import { useChatStore } from "@piddie/chat-management-ui-vue";
import { MessageStatus, type ToolCall } from "@piddie/chat-management";
import { settingsManager } from "@piddie/settings";
import type {
  LlmProviderConfig as WorkbenchLlmConfig,
  ModelInfo
} from "@piddie/settings";
import { LlmProviderFactory } from "@piddie/llm-integration";
import type { ProviderType } from "@piddie/shared-types";

import {
  createLlmAdapter,
  type LlmStreamChunk,
  type LlmProviderConfig,
  type LlmMessage
} from "@piddie/llm-integration";

export const useLlmStore = defineStore("llm", () => {
  const chatStore = useChatStore();
  const isStreaming = ref(false);
  const isProcessing = ref(false);
  const streamingMessageId = ref<string | null>(null);
  const error = ref<Error | null>(null);
  const isLoading = ref(true);
  const isVerifying = ref(false);
  const connectionStatus = ref<"none" | "success" | "error">("none");
  const availableModels = ref<ModelInfo[]>([]);

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
  let llmAdapter = createLlmAdapter(
    getLlmProviderConfig(),
    chatStore.chatManager
  );

  async function initializeStore(): Promise<void> {
    try {
      isLoading.value = true;

      const loadedConfig = await settingsManager.getLlmConfig();
      const selectedProvider = await settingsManager.getSelectedProvider();
      Object.assign(workbenchConfig, loadedConfig, {
        provider: selectedProvider
      });
      if (
        loadedConfig.availableModels &&
        Array.isArray(loadedConfig.availableModels) &&
        loadedConfig.availableModels.length > 0
      ) {
        availableModels.value = [...loadedConfig.availableModels];
      }

      // Create the LLM adapter
      llmAdapter = createLlmAdapter(
        getLlmProviderConfig(),
        chatStore.chatManager
      );
    } catch (err) {
      console.error("Error initializing LLM store:", err);
      error.value = err instanceof Error ? err : new Error(String(err));
      throw err; // Re-throw to let the plugin handle initialization failures
    } finally {
      isLoading.value = false;
    }
  }
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

      // Re-initialize the adapter with the new configuration
      llmAdapter = createLlmAdapter(
        getLlmProviderConfig(),
        chatStore.chatManager
      );

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
      isStreaming.value = true;

      // Create an ephemeral user message first for immediate visibility
      const userMessage = await chatStore.addMessage(
        chatId,
        content,
        "user",
        "Developer",
        undefined,
        MessageStatus.SENT,
        true // isEphemeral
      );

      // Persist the user message in the background
      chatStore.persistEphemeralMessage(userMessage.id, {
        content,
        status: MessageStatus.SENT
      });

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

            // Check if this tool call has a result attached directly
            if (toolCall.result) {
              console.log(
                `[LlmStore] Received tool call with result for ${functionName}`
              );

              // First check if we already have this tool call in our accumulated list
              const existingToolCall = accumulatedToolCalls.find(
                (tc) =>
                  tc.function.name === toolCall.function.name &&
                  JSON.stringify(tc.function.arguments) ===
                  JSON.stringify(toolCall.function.arguments)
              );

              if (existingToolCall) {
                // Update the existing tool call with the result
                console.log(
                  `[LlmStore] Updating existing tool call with result for ${functionName}`
                );
                existingToolCall.result = toolCall.result;
              } else {
                // Add the new tool call with result to our accumulated list
                console.log(
                  `[LlmStore] Adding new tool call with result for ${functionName}`
                );
                accumulatedToolCalls.push(toolCall);
              }

              // Update the UI immediately with the tool call result
              chatStore.updateMessageToolCalls(
                assistantMessage.id,
                accumulatedToolCalls
              );

              return; // Skip the rest of the processing for this tool call
            }

            // Continue with existing processing for tool calls without results
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

  /**
   * Gets agent settings for a chat
   * @param chatId The chat ID to get settings for
   * @returns The agent settings
   */
  async function getAgentSettings(chatId: string) {
    if (!chatId) {
      throw new Error("Chat ID is required to get agent settings");
    }

    try {
      // Get agent settings from the settings manager
      return await settingsManager.getAgentSettings(chatId);
    } catch (error) {
      console.error("Error getting agent settings:", error);
      throw error;
    }
  }

  /**
   * Configures the agent for a chat
   * @param chatId The chat ID to configure
   * @param config Configuration options
   */
  async function configureAgent(
    chatId: string,
    config: {
      enabled: boolean;
      maxRoundtrips?: number;
      autoContinue?: boolean;
      customSystemPrompt?: string;
    }
  ) {
    if (!chatId) {
      throw new Error("Chat ID is required to configure agent");
    }

    if (!llmAdapter) {
      throw new Error("LLM adapter not initialized");
    }

    try {
      // Configure the agent through the adapter
      await llmAdapter.configureAgent(chatId, config);
    } catch (error) {
      console.error("Error configuring agent:", error);
      throw error;
    }
  }

  /**
   * Checks if the agent is enabled for a chat
   * @param chatId The chat ID to check
   * @returns True if the agent is enabled, false otherwise
   */
  function isAgentEnabled(chatId: string): boolean {
    if (!chatId || !llmAdapter) return false;

    return llmAdapter.isAgentEnabled(chatId);
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
    getStoredProviderConfig,
    initializeStore,
    getAgentSettings,
    configureAgent,
    isAgentEnabled
  };
});
