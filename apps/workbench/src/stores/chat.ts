import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { Chat, Message, ToolCall } from "@piddie/chat-management";
import { createChatManager, MessageStatus } from "@piddie/chat-management";
import { v4 as uuidv4 } from "uuid";

export const useChatStore = defineStore("chat", () => {
  const chatManager = createChatManager();
  const currentChat = ref<Chat | null>(null);
  const temporaryMessages = ref<Map<string, Message>>(new Map());

  /**
   * Get all messages for the current chat, including temporary ones
   */
  const messages = computed(() => {
    if (!currentChat.value) return [];

    // Get persisted messages from current chat
    const chatMessages = currentChat.value.messages || [];

    // Get temporary messages for this chat
    const tempMessages = Array.from(temporaryMessages.value.values()).filter(
      (msg) => msg.chatId === currentChat.value?.id
    );

    // Combine and sort messages by creation time
    return [...chatMessages, ...tempMessages].sort((a, b) => {
      // Convert created to timestamps for comparison
      const timeA =
        a.created instanceof Date
          ? a.created.getTime()
          : new Date(a.created).getTime();
      const timeB =
        b.created instanceof Date
          ? b.created.getTime()
          : new Date(b.created).getTime();
      return timeA - timeB;
    });
  });

  async function createChat(
    projectId: string,
    metadata?: Record<string, unknown>
  ) {
    const chat = await chatManager.createChat(projectId, metadata);
    currentChat.value = chat;
    return chat;
  }

  /**
   * Creates a temporary message that exists only in memory
   */
  function createTemporaryMessage(
    chatId: string,
    content: string,
    role: "user" | "assistant" | "system",
    username: string,
    parentId?: string,
    status: MessageStatus = MessageStatus.SENDING
  ): Message {
    const message: Message = {
      id: `temp_${uuidv4()}`,
      chatId,
      content,
      role,
      status,
      created: new Date(),
      username,
      parentId,
      tool_calls: []
    };

    temporaryMessages.value.set(message.id, message);
    return message;
  }

  /**
   * Persists a temporary message to the database
   */
  async function persistMessage(
    messageId: string,
    updates?: {
      content?: string;
      status?: MessageStatus;
      tool_calls?: ToolCall[];
    }
  ): Promise<Message> {
    const tempMessage = temporaryMessages.value.get(messageId);
    if (!tempMessage) {
      throw new Error(`Temporary message ${messageId} not found`);
    }

    // Create the message in the database
    const message = await chatManager.addMessage(
      tempMessage.chatId,
      updates?.content || tempMessage.content,
      tempMessage.role,
      tempMessage.username || tempMessage.role,
      tempMessage.parentId
    );

    // Apply updates if any
    if (updates) {
      await chatManager.updateMessage(message.chatId, message.id, {
        status: updates.status,
        tool_calls: updates.tool_calls
      });
    }

    // Remove from temporary messages
    temporaryMessages.value.delete(messageId);
    return message;
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

    const message = await chatManager.addMessage(
      chatId,
      content,
      role,
      username || role,
      parentId
    );

    if (status !== MessageStatus.SENT) {
      await chatManager.updateMessageStatus(chatId, message.id, status);
    }

    return message;
  }

  async function updateMessageToolCalls(
    messageId: string,
    toolCalls: ToolCall[]
  ) {
    const tempMessage = temporaryMessages.value.get(messageId);
    if (tempMessage) {
      tempMessage.tool_calls = toolCalls;
      temporaryMessages.value.set(messageId, { ...tempMessage });
      return;
    }

    if (!currentChat.value) {
      throw new Error("No active chat");
    }

    await chatManager.updateMessageToolCalls(
      currentChat.value.id,
      messageId,
      toolCalls
    );
  }

  /**
   * Update a temporary message's content
   */
  function updateMessageContent(messageId: string, content: string) {
    const message = temporaryMessages.value.get(messageId);
    if (message) {
      message.content = content;
      temporaryMessages.value.set(messageId, { ...message });
    }
  }

  /**
   * Update a temporary message's status
   */
  function updateMessageStatus(messageId: string, status: MessageStatus) {
    const message = temporaryMessages.value.get(messageId);
    if (message) {
      message.status = status;
      temporaryMessages.value.set(messageId, { ...message });
    }
  }

  async function loadChat(chatId: string) {
    const chat = await chatManager.getChat(chatId);
    currentChat.value = chat;
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
    }
  }

  async function cleanup() {
    currentChat.value = null;
    temporaryMessages.value.clear();
  }

  return {
    currentChat,
    messages,
    chatManager,
    createChat,
    addMessage,
    createTemporaryMessage,
    persistMessage,
    updateMessageToolCalls,
    updateMessageContent,
    updateMessageStatus,
    loadChat,
    listChats,
    listProjectChats,
    deleteChat,
    cleanup
  };
});
