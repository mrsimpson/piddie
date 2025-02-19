import { defineStore } from "pinia";
import { ref } from "vue";
import type { Chat, Message } from "@piddie/chat-context";
import { ChatDatabase, DexieChatManager, MessageStatus } from "@piddie/chat-context";

export const useChatStore = defineStore("chat", () => {
  const db = new ChatDatabase();
  const chatManager = new DexieChatManager(db);
  const currentChat = ref<Chat | null>(null);
  const messages = ref<Message[]>([]);

  async function createChat(metadata?: Record<string, unknown>) {
    const chat = await chatManager.createChat(metadata);
    currentChat.value = chat;
    messages.value = chat.messages;
    return chat;
  }

  async function addMessage(chatId: string, content: string, role: "user" | "assistant", parentId?: string) {
    if (!chatId) throw new Error("No chat ID provided");
    
    const message = await chatManager.addMessage(chatId, content, role, parentId);
    if (chatId === currentChat.value?.id) {
      messages.value = [...messages.value, message];
    }
    return message;
  }

  async function loadChat(chatId: string) {
    const chat = await chatManager.getChat(chatId);
    currentChat.value = chat;
    messages.value = chat.messages;
    return chat;
  }

  async function listChats(limit?: number, offset = 0) {
    return chatManager.listChats(limit, offset);
  }

  return {
    currentChat,
    messages,
    createChat,
    addMessage,
    loadChat,
    listChats,
  };
});
