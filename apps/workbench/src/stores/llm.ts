import { ref, reactive, onMounted } from "vue";
import { defineStore } from "pinia";
import { useChatStore } from "./chat";
import { MessageStatus } from "@piddie/chat-management";
import settingsManager from "./settings-db";
import type { LlmProviderConfig, ModelInfo } from "./settings-db";

// Import from the llm-integration package
import { createLlmAdapter, LlmStreamEvent } from "@piddie/llm-integration";

// Remove the local mock implementation and use the real one from the package
// function createLlmAdapter(config: LlmProviderConfig) {
//   // This is a mock implementation that will be replaced with the real one
//   return {
//     processMessage: async (message: any) => {
//       // Simulate a delay
//       await new Promise((resolve) => setTimeout(resolve, 1000));

//       // Return a mock response
//       return {
//         id: crypto.randomUUID(),
//         chatId: message.chatId,
//         content: `This is a mock response to: "${message.content}"`,
//         role: "assistant",
//         created: new Date(),
//         parentId: message.id
//       };
//     },
//     processMessageStream: async (message: any) => {
//       // Create an event emitter
//       const eventEmitter = new EventTarget();

//       // Simulate streaming with a delay
//       setTimeout(() => {
//         const response = {
//           id: crypto.randomUUID(),
//           chatId: message.chatId,
//           content: `This is a mock response to: "${message.content}"`,
//           role: "assistant",
//           created: new Date(),
//           parentId: message.id
//         };

//         // Emit the data event
//         eventEmitter.dispatchEvent(
//           new CustomEvent(LlmStreamEvent.DATA, { detail: response })
//         );

//         // Emit the end event
//         eventEmitter.dispatchEvent(
//           new CustomEvent(LlmStreamEvent.END, { detail: response })
//         );
//       }, 1000);

//       // Add event listener methods to make it compatible with the expected interface
//       return {
//         on: (event: string, callback: (data: any) => void) => {
//           eventEmitter.addEventListener(event, (e: Event) => {
//             const customEvent = e as CustomEvent;
//             callback(customEvent.detail);
//           });
//           return eventEmitter;
//         }
//       };
//     }
//   };
// }

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

  // Reactive configuration object
  const config = reactive<LlmProviderConfig>({
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-3.5-turbo",
    provider: "openai" // Set default provider
  });

  // LLM adapter instance - pass the chat manager for conversation history
  let llmAdapter = createLlmAdapter(config, chatStore.chatManager);

  // Load settings from database on store initialization
  onMounted(async () => {
    try {
      isLoading.value = true;
      const loadedConfig = await settingsManager.getLlmConfig();

      // Update the reactive config object
      Object.assign(config, loadedConfig);

      // Set available models if they exist
      if (
        loadedConfig.availableModels &&
        loadedConfig.availableModels.length > 0
      ) {
        availableModels.value = loadedConfig.availableModels;
      }

      // Recreate the adapter with the loaded configuration
      llmAdapter = createLlmAdapter(config, chatStore.chatManager);
    } catch (err) {
      console.error("Error loading LLM settings:", err);
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      isLoading.value = false;
    }
  });

  /**
   * Verifies the connection to the OpenAI API and retrieves available models
   */
  async function verifyConnection() {
    try {
      isVerifying.value = true;
      connectionStatus.value = "none";
      error.value = null;

      // Log the config being used for verification
      console.log("Verifying connection with config:", {
        baseUrl: config.baseUrl,
        apiKeyLength: config.apiKey ? config.apiKey.length : 0,
        model: config.defaultModel
      });

      // Verify the connection and get available models
      const models = await settingsManager.verifyConnection({ ...config });

      // Update the available models
      availableModels.value = models;
      connectionStatus.value = "success";

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
  async function updateConfig(newConfig: Partial<LlmProviderConfig>) {
    try {
      // Update the database
      const updatedConfig = await settingsManager.updateLlmConfig(newConfig);

      // Update the reactive config object
      Object.assign(config, updatedConfig);

      // Recreate the adapter with the new configuration
      llmAdapter = createLlmAdapter(config, chatStore.chatManager);

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

      // Update the reactive config object
      Object.assign(config, defaultConfig);

      // Recreate the adapter with the default configuration
      llmAdapter = createLlmAdapter(config, chatStore.chatManager);

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
    chatId?: string,
    useStreaming = true
  ) {
    try {
      // Check if API key is set
      if (!config.apiKey && config.provider !== "mock") {
        throw new Error(
          "API key is not set. Please configure your LLM settings."
        );
      }

      error.value = null;
      isProcessing.value = true;
      isStreaming.value = useStreaming;

      // If no chatId is provided, create a new chat
      if (!chatId) {
        const chat = await chatStore.createChat();
        chatId = chat.id;
      }

      // Add the user message to the chat
      const userMessage = await chatStore.addMessage(chatId, content, "user");

      // Get the model name to use as the username for the assistant message
      const modelName =
        config.defaultModel === "mock-model"
          ? "Mock Model"
          : config.defaultModel;

      // Create a placeholder for the assistant's response with SENDING status
      const assistantMessage = await chatStore.addMessage(
        chatId,
        "",
        "assistant",
        userMessage.id,
        modelName, // Pass the model name as the username
        MessageStatus.SENDING // Set initial status to SENDING
      );

      // Convert the message to the format expected by the LLM adapter
      const llmMessage = {
        id: userMessage.id,
        chatId: userMessage.chatId,
        content: userMessage.content,
        role: userMessage.role,
        status: userMessage.status,
        created: userMessage.created,
        parentId: userMessage.parentId
      };

      // Reset streaming message ID
      streamingMessageId.value = assistantMessage.id;

      const finalizeProcessing = () => {
        isStreaming.value = false;
        isProcessing.value = false;
        streamingMessageId.value = null;
      };

      if (useStreaming) {
        const stream = await llmAdapter.processMessageStream(llmMessage);

        stream.on(LlmStreamEvent.DATA, (chunk: { content: string }) => {
          // Update the assistant message with the new content
          chatStore.updateMessageContent(assistantMessage.id, chunk.content);
        });

        stream.on(LlmStreamEvent.END, () => {
          // Let the orchestrator handle status updates
          // We only need to finalize processing on our end
          finalizeProcessing();
        });

        stream.on(LlmStreamEvent.ERROR, (err: Error) => {
          // Set error value
          error.value = err;

          // Let the orchestrator handle status updates
          // We only need to finalize processing on our end
          finalizeProcessing();
        });
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

  return {
    isStreaming,
    isProcessing,
    isLoading,
    isVerifying,
    connectionStatus,
    streamingMessageId,
    error,
    config,
    availableModels,
    verifyConnection,
    updateConfig,
    resetConfig,
    sendMessage,
    cancelStreaming
  };
});
