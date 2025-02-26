import { ref } from "vue";
import { defineStore } from "pinia";
import type { Chat, Message } from "@piddie/chat-management";
import { createChatManager, MessageStatus } from "@piddie/chat-management";

export const useChatStore = defineStore("chat", () => {
  const chatManager = createChatManager();
  const currentChat = ref<Chat | null>(null);
  const messages = ref<Message[]>([]);

  async function createChat(metadata?: Record<string, unknown>) {
    const chat = await chatManager.createChat(metadata);
    currentChat.value = chat;
    messages.value = chat.messages;
    return chat;
  }

  async function addMessage(
    chatId: string,
    content: string,
    role: "user" | "assistant" | "system",
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

  async function updateMessageContent(messageId: string, content: string) {
    if (!currentChat.value) return;

    // Find the message in the current chat
    const messageIndex = messages.value.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) return;

    // Update the message content
    const updatedMessage = { ...messages.value[messageIndex], content };
    messages.value = [
      ...messages.value.slice(0, messageIndex),
      updatedMessage,
      ...messages.value.slice(messageIndex + 1)
    ];

    // In a real implementation, we would also update the message in the chat manager
    // For now, we're just updating the local state
  }

  async function updateMessageStatus(messageId: string, status: MessageStatus) {
    if (!currentChat.value) return;

    // Find the message in the current chat
    const messageIndex = messages.value.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) return;

    // Update the message status
    const updatedMessage = { ...messages.value[messageIndex], status };
    messages.value = [
      ...messages.value.slice(0, messageIndex),
      updatedMessage,
      ...messages.value.slice(messageIndex + 1)
    ];

    // In a real implementation, we would also update the message in the chat manager
    // For now, we're just updating the local state
    await chatManager.updateMessageStatus(
      currentChat.value.id,
      messageId,
      status
    );
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

  async function deleteChat(chatId: string) {
    await chatManager.deleteChat(chatId);
    if (currentChat.value?.id === chatId) {
      currentChat.value = null;
      messages.value = [];
    }
  }

  async function cleanup() {
    currentChat.value = null;
  }

  return {
    currentChat,
    messages,
    createChat,
    addMessage,
    updateMessageContent,
    updateMessageStatus,
    loadChat,
    listChats,
    deleteChat,
    cleanup
  };
});
