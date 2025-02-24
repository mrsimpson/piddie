/// <reference types="vite/client" />

import { ref } from "vue";
import { defineStore } from "pinia";
import type { Chat, ChatMessage } from "@piddie/chat-management";
import { createChatManager } from "@piddie/chat-management";
import { createLLMClient } from "@piddie/llm-integration";
import type { LLMClientConfig } from "@piddie/llm-integration";

// Initialize chat manager and LLM client
const chatManager = createChatManager();

const llmConfig: LLMClientConfig = {
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || "",
  baseUrl:
    import.meta.env.VITE_OPENAI_API_BASE_URL || "https://api.openai.com/v1",
  model: import.meta.env.VITE_OPENAI_MODEL || "gpt-4"
};

export const useChatStore = defineStore("chat", () => {
  const llmClient = createLLMClient(chatManager, llmConfig);

  const currentChat = ref<Chat | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const isProcessing = ref(false);
  const currentResponse = ref("");

  async function createChat(metadata?: Record<string, unknown>) {
    const chat = await chatManager.createChat(metadata);
    currentChat.value = chat;
    return chat;
  }

  async function loadChat(chatId: string) {
    const chat = await chatManager.getChat(chatId);
    currentChat.value = chat;
    messages.value = chat.messages;
  }

  async function addMessage(
    chatId: string,
    content: string,
    role: "user" | "assistant",
    parentId?: string
  ) {
    if (!chatId) throw new Error("No chat ID provided");

    const message = await chatManager.addMessage(
      chatId,
      content,
      role,
      parentId
    );
    if (chatId === currentChat.value?.id) {
      messages.value = [...messages.value, message];
    }
    return message;
  }

  async function* streamMessage(message: string) {
    if (!currentChat.value) {
      throw new Error("No chat selected");
    }

    isProcessing.value = true;
    currentResponse.value = "";

    try {
      for await (const chunk of llmClient.chat(
        message,
        currentChat.value!.id
      )) {
        currentResponse.value += chunk;
        yield chunk;
      }
    } finally {
      isProcessing.value = false;
      currentResponse.value = "";
    }
  }

  async function listChats(limit?: number, offset = 0) {
    return chatManager.listConversations(limit, offset);
  }

  async function deleteChat(chatId: string) {
    if (currentChat.value?.id === chatId) {
      currentChat.value = null;
      messages.value = [];
    }
    await chatManager.deleteChat(chatId);
  }

  async function cleanup() {
    // Cleanup any resources if needed
  }

  return {
    currentChat,
    messages,
    isProcessing,
    currentResponse,
    createChat,
    loadChat,
    streamMessage,
    listChats,
    deleteChat,
    cleanup,
    addMessage
  };
});
