import { ref } from "vue";
import { defineStore } from "pinia";
import type { Chat, Message } from "@piddie/chat-management";
import { createChatManager, MessageStatus } from "@piddie/chat-management";

export const useChatStore = defineStore("chat", () => {
  const chatManager = createChatManager();
  const currentChat = ref<Chat | null>(null);
  const messages = ref<Message[]>([]);

  async function createChat(
    projectId: string,
    metadata?: Record<string, unknown>
  ) {
    const chat = await chatManager.createChat(projectId, metadata);
    currentChat.value = chat;
    messages.value = chat.messages;
    return chat;
  }

  async function addMessage(
    chatId: string,
    content: string,
    role: "user" | "assistant" | "system",
    username: string,
    parentId?: string,
    status: MessageStatus = MessageStatus.SENT
  ) {
    if (!chatId) throw new Error("No chat ID provided");

    // Create the message according to the interface (without username)
    const message = await chatManager.addMessage(
      chatId,
      content,
      role,
      username || role,
      parentId
    );

    // If username is provided, we'll need to store it separately
    // This is a workaround since the interface doesn't include username
    // but the implementation does
    if (username && message) {
      // In a real implementation, we would update the message with the username
      // For now, we'll just add it to our local copy
      message.username = username;
    }

    // Update the status if it's different from the default
    if (status !== MessageStatus.SENT) {
      await updateMessageStatus(message.id, status);
    }

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

    // Update the message content in the chat manager
    await chatManager.updateMessageContent(
      currentChat.value.id,
      messageId,
      content
    );
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

  async function listProjectChats(
    projectId: string,
    limit?: number,
    offset = 0
  ) {
    return chatManager.listProjectChats(projectId, limit, offset);
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
    chatManager,
    createChat,
    addMessage,
    updateMessageContent,
    updateMessageStatus,
    loadChat,
    listChats,
    listProjectChats,
    deleteChat,
    cleanup
  };
});
