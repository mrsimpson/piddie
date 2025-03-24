<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import { MessagesList, SimpleChatInput } from "@piddie/chat-management-ui-vue";
import {
  MessageStatus,
  type ChatCompletionRole
} from "@piddie/chat-management";
import { useChatStore } from "@piddie/chat-management-ui-vue";

// Demo project ID
const DEMO_PROJECT_ID = "demo-project-123";

// Setup stores
const chatStore = useChatStore();
const { messages, currentChat } = storeToRefs(chatStore);

const selectedRole = ref<ChatCompletionRole>("user");
const isProjectsListCollapsed = ref(false);
// Keep track of the current assistant placeholder message
const currentAssistantPlaceholder = ref<string | null>(null);

// Initialize chat on component mount
onMounted(async () => {
  // Create a demo chat if none exists
  try {
    // Create a new chat for the demo project
    await chatStore.createChat(DEMO_PROJECT_ID, { demo: true });

    // Explicitly load the chat after creation to ensure messages are available
    if (currentChat.value) {
      await chatStore.loadChat(currentChat.value.id);
    }
  } catch (error) {
    console.error("Error creating chat:", error);
  }
});

function handleSidePanelCollapse(collapsed: boolean) {
  isProjectsListCollapsed.value = collapsed;
}

async function handleSendMessage(content: string) {
  if (!content.trim() || !currentChat.value) return;

  try {
    if (selectedRole.value === "user") {
      // When sending as user, use the sendMessageToLlm to create a user message and assistant placeholder
      const { userMessage, assistantPlaceholder } =
        await chatStore.sendMessageToLlm(currentChat.value.id, content, "You");

      console.log("User message created:", userMessage.id);
      console.log("Assistant placeholder created:", assistantPlaceholder.id);

      // Ensure the chat is reloaded to display the new messages
      await chatStore.loadChat(currentChat.value.id);

      // Store the placeholder ID for later use when assistant responds
      currentAssistantPlaceholder.value = assistantPlaceholder.id;

      // Automatically switch to assistant role after sending a user message
      selectedRole.value = "assistant";
    } else {
      // When sending as assistant, update the placeholder if available
      if (currentAssistantPlaceholder.value) {
        // Update the existing placeholder with the assistant's response
        await chatStore.updateMessageContent(
          currentAssistantPlaceholder.value,
          content
        );
        await chatStore.updateMessageStatus(
          currentAssistantPlaceholder.value,
          MessageStatus.SENT
        );

        // Reload the chat to reflect the updated message
        if (currentChat.value) {
          await chatStore.loadChat(currentChat.value.id);
        }

        // Clear the placeholder reference since it's been used
        currentAssistantPlaceholder.value = null;

        // Switch back to user role for the next message
        selectedRole.value = "user";
      } else {
        // If no placeholder is available, just add a new assistant message
        await chatStore.addMessage(
          currentChat.value.id,
          content,
          selectedRole.value,
          "Assistant"
        );

        // Reload the chat to reflect the new message
        await chatStore.loadChat(currentChat.value.id);

        // Switch back to user role
        selectedRole.value = "user";
      }
    }
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

// Debug function to log messages when they change
watch(
  messages,
  (newMessages) => {
    console.log("Messages updated:", newMessages.length);
    newMessages.forEach((msg) => {
      console.log(
        `Message: ${msg.id} - Role: ${msg.role} - Content: ${msg.content.substring(0, 20)}...`
      );
    });
  },
  { deep: true }
);

async function clearChat() {
  if (currentChat.value) {
    try {
      await chatStore.deleteChat(currentChat.value.id);
      await chatStore.createChat(DEMO_PROJECT_ID, { demo: true });

      // Make sure to reload the chat after creation
      if (currentChat.value) {
        await chatStore.loadChat(currentChat.value.id);
      }

      currentAssistantPlaceholder.value = null;
      selectedRole.value = "user";
    } catch (error) {
      console.error("Error clearing chat:", error);
    }
  }
}
</script>

<template>
  <div class="app-container">
    <div class="app-layout">
      <router-view
        name="sidepanelLeft"
        class="side-panel"
        @collapse="handleSidePanelCollapse"
      />
      <div class="main-content">
        <div class="chat-demo-container">
          <h1>Chat Management Demo</h1>

          <!-- Debug info - can be removed in production -->
          <div class="debug-info">
            <small>Messages count: {{ messages.length }}</small>
            <small v-if="currentChat">Chat ID: {{ currentChat.id }}</small>
          </div>

          <div class="role-selector">
            <label>
              <input
                type="radio"
                v-model="selectedRole"
                value="user"
                :disabled="!!currentAssistantPlaceholder"
              />
              Send as User
            </label>
            <label>
              <input
                type="radio"
                v-model="selectedRole"
                value="assistant"
                :disabled="!currentAssistantPlaceholder"
              />
              Send as Assistant
            </label>
            <div class="current-role">
              Current turn:
              <strong>{{
                selectedRole === "user" ? "User" : "Assistant"
              }}</strong>
              <span v-if="currentAssistantPlaceholder" class="hint"
                >(Assistant needs to respond)</span
              >
            </div>
            <button @click="clearChat" class="clear-btn">Clear Chat</button>
          </div>

          <div class="messages-container">
            <MessagesList :messages="messages" />
          </div>

          <div class="chat-input">
            <SimpleChatInput @send-message="handleSendMessage" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  background: var(--sl-color-neutral-0);
  color: var(--sl-color-neutral-900);
  min-height: 100vh;
}

.app-layout {
  display: flex;
  min-height: 100vh;
}

.side-panel {
  transition: width 0.3s ease;
  width: 300px;
}

.main-content {
  flex: 1;
  height: 100vh;
  overflow-y: auto;
  padding: 1rem;
}

.chat-demo-container {
  max-width: 800px;
  margin: 0 auto;
}

.debug-info {
  margin-bottom: 0.5rem;
  color: var(--sl-color-neutral-500);
  font-size: 0.75rem;
  display: flex;
  gap: 1rem;
}

.role-selector {
  margin: 1rem 0;
  padding: 0.5rem;
  background: var(--sl-color-neutral-100);
  border-radius: 4px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.role-selector label {
  margin-right: 1.5rem;
  cursor: pointer;
}

.current-role {
  margin-right: auto;
  color: var(--sl-color-neutral-700);
}

.hint {
  font-size: 0.8rem;
  font-style: italic;
  color: var(--sl-color-primary-600);
  margin-left: 0.5rem;
}

.clear-btn {
  margin-left: auto;
  padding: 0.5rem 1rem;
  background: var(--sl-color-neutral-600);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.clear-btn:hover {
  background: var(--sl-color-neutral-700);
}

.messages-container {
  border: 1px solid var(--sl-color-neutral-200);
  border-radius: 4px;
  height: 400px;
  overflow-y: auto;
  margin-bottom: 1rem;
}
</style>
