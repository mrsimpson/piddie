import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type {
  Chat,
  ChatCompletionRole,
  Message,
  ToolCall
} from "@piddie/chat-management";
import { createChatManager, MessageStatus } from "@piddie/chat-management";
import { v4 as uuidv4 } from "uuid";

export const useChatStore = defineStore("chat", () => {
  const chatPersistence = createChatManager();
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
    const chat = await chatPersistence.createChat(projectId, metadata);
    currentChat.value = chat;
    return chat;
  }

  /**
   * Sends a user message to the LLM and creates an ephemeral assistant placeholder
   * @param chatId The ID of the chat
   * @param content The user message content
   * @param username Optional username for the user message
   * @returns The user message and assistant placeholder
   */
  async function sendMessageToLlm(
    chatId: string,
    content: string,
    username: string = "Developer"
  ): Promise<{ userMessage: Message; assistantPlaceholder: Message }> {
    if (!chatId) throw new Error("No chat ID provided");

    // Create and persist user message
    const userMessage = await addMessage(chatId, content, "user", username);

    // Create ephemeral assistant placeholder
    const assistantPlaceholder = await addMessage(
      chatId,
      "",
      "assistant",
      "Assistant", // Default name, can be updated later
      userMessage.id,
      MessageStatus.SENDING,
      true // isEphemeral
    );

    return { userMessage, assistantPlaceholder };
  }

  function isEphemeral(messageId: string) {
    return messageId.startsWith("temp_");
  }

  /**
   * Adds a message to a chat
   * @param chatId The ID of the chat to add the message to
   * @param content The message content
   * @param role The role of the sender
   * @param username Human identifiable name of the sender
   * @param parentId Optional ID of the parent message (for replies)
   * @param status The message status
   * @param isEphemeral Whether the message should be stored temporarily in memory only
   * @returns The created message
   */
  async function addMessage(
    chatId: string,
    content: string,
    role: ChatCompletionRole,
    username: string,
    parentId?: string,
    status: MessageStatus = MessageStatus.SENT,
    isEphemeral: boolean = false
  ): Promise<Message> {
    if (!chatId) throw new Error("No chat ID provided");

    if (isEphemeral) {
      // Create a temporary message in memory
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
    } else {
      // Create a persisted message in the database
      const message = await chatPersistence.addMessage(
        chatId,
        content,
        role,
        username || role,
        parentId
      );

      if (status !== MessageStatus.SENT) {
        await chatPersistence.updateMessageStatus(chatId, message.id, status);
      }

      return message;
    }
  }

  /**
   * Persists an ephemeral message to the database
   * @param messageId The ID of the ephemeral message to persist
   * @param updates Optional updates to apply when persisting
   * @returns The persisted message
   */
  async function persistEphemeralMessage(
    messageId: string,
    updates?: {
      content?: string;
      status?: MessageStatus;
      tool_calls?: ToolCall[];
    }
  ): Promise<Message> {
    const tempMessage = temporaryMessages.value.get(messageId);
    if (!tempMessage) {
      throw new Error(`Ephemeral message ${messageId} not found`);
    }

    // Create the message in the database
    const message = await chatPersistence.addMessage(
      tempMessage.chatId,
      updates?.content || tempMessage.content,
      tempMessage.role,
      tempMessage.username || tempMessage.role,
      tempMessage.parentId,
      tempMessage.created
    );

    // Apply status update if needed
    if (updates?.status && updates.status !== MessageStatus.SENT) {
      await chatPersistence.updateMessageStatus(
        message.chatId,
        message.id,
        updates.status
      );
    }

    // Apply tool calls if any
    if (updates?.tool_calls && updates?.tool_calls.length > 0) {
      await chatPersistence.updateMessageToolCalls(
        message.chatId,
        message.id,
        updates.tool_calls
      );

      // Add tool calls to the message object for UI update
      message.tool_calls = updates.tool_calls;
    }

    // Remove from temporary messages
    temporaryMessages.value.delete(messageId);

    // Reload the chat to ensure all messages are properly loaded
    if (currentChat.value && currentChat.value.id === message.chatId) {
      await loadChat(message.chatId);
    }

    return message;
  }

  function updateMessageStatus(messageId: string, status: MessageStatus) {
    // For ephemeral messages, just update in memory
    if (isEphemeral(messageId)) {
      const message = temporaryMessages.value.get(messageId);
      if (message) {
        // Create a new Map to trigger reactivity
        const updatedMessage = { ...message, status };
        temporaryMessages.value = new Map(temporaryMessages.value).set(
          messageId,
          updatedMessage
        );
      }
      return;
    }

    // For persisted messages, update in the database
    if (currentChat.value) {
      chatPersistence.updateMessageStatus(
        currentChat.value.id,
        messageId,
        status
      );
    }
  }

  async function updateMessageToolCalls(
    messageId: string,
    toolCalls: ToolCall[]
  ) {
    // For ephemeral messages, just update in memory
    if (isEphemeral(messageId)) {
      const tempMessage = temporaryMessages.value.get(messageId);
      if (tempMessage) {
        // Create a new Map to trigger reactivity
        const updatedMessage = { ...tempMessage, tool_calls: toolCalls };
        temporaryMessages.value = new Map(temporaryMessages.value).set(
          messageId,
          updatedMessage
        );
      }
      return;
    }

    // For persisted messages, update in the database
    if (!currentChat.value) {
      throw new Error("No active chat");
    }

    await chatPersistence.updateMessageToolCalls(
      currentChat.value.id,
      messageId,
      toolCalls
    );
  }

  /**
   * Update a message's content
   */
  function updateMessageContent(messageId: string, content: string) {
    // For ephemeral messages, just update in memory
    if (isEphemeral(messageId)) {
      const message = temporaryMessages.value.get(messageId);
      if (message) {
        // Create a new Map to trigger reactivity
        const updatedMessage = { ...message, content };
        temporaryMessages.value = new Map(temporaryMessages.value).set(
          messageId,
          updatedMessage
        );
      }
      return;
    }

    // For persisted messages, update in the database
    if (currentChat.value) {
      chatPersistence.updateMessageContent(
        currentChat.value.id,
        messageId,
        content
      );
    }
  }

  async function loadChat(chatId: string) {
    const chat = await chatPersistence.getChat(chatId);
    currentChat.value = chat;
    return chat;
  }

  async function listChats(limit?: number, offset = 0) {
    return chatPersistence.listChats(limit, offset);
  }

  async function listProjectChats(
    projectId: string,
    limit?: number,
    offset = 0
  ) {
    return chatPersistence.listProjectChats(projectId, limit, offset);
  }

  async function deleteChat(chatId: string) {
    await chatPersistence.deleteChat(chatId);
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
    chatManager: chatPersistence,
    createChat,
    sendMessageToLlm,
    addMessage,
    persistEphemeralMessage,
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
