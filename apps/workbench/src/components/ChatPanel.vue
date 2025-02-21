<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ref, watch } from "vue";
import { useChatStore } from "../stores/chat";
import CollapsiblePanel from "./ui/CollapsiblePanel.vue";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";

const chatStore = useChatStore();
const { currentChat, messages } = storeToRefs(chatStore);
const newMessage = ref("");
const isLoading = ref(true);

// Watch for chat changes to handle loading state
watch(
  () => currentChat.value,
  (newChat) => {
    isLoading.value = true;

    // Short delay to ensure smooth transition
    setTimeout(() => {
      isLoading.value = false;
    }, 300);
  },
  { immediate: true }
);

async function sendMessage() {
  if (!currentChat.value || !newMessage.value.trim()) return;

  await chatStore.addMessage(currentChat.value.id, newMessage.value, "user");
  newMessage.value = "";
}
</script>

<template>
  <div class="chat-panel">
    <CollapsiblePanel :display-toggle="false">
      <template #header>
        <div class="chat-header">
          <span>Chat</span>
        </div>
      </template>
      <template #content>
        <div class="chat-content">
          <div v-if="isLoading" class="loading-container">
            <sl-spinner></sl-spinner>
            <span>Loading chat...</span>
          </div>
          <div v-else-if="!currentChat" class="info-message">
            No chat available
          </div>
          <div v-else class="messages">
            <template v-for="message in messages" :key="message.id">
              <sl-card class="message" :class="message.role">
                <div class="message-content">{{ message.content }}</div>
              </sl-card>
            </template>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="input-container">
          <sl-input
            v-model="newMessage"
            placeholder="Type a message..."
            @keyup.enter="sendMessage"
          />
          <sl-button variant="primary" size="small" @click="sendMessage">
            Send
          </sl-button>
        </div>
      </template>
    </CollapsiblePanel>
  </div>
</template>

<style scoped>
.chat-panel {
  height: 100%;
  flex: 1;
  border-right: 1px solid var(--sl-color-neutral-200);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sl-spacing-x-small);
}

.chat-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sl-spacing-medium);
  padding: var(--sl-spacing-medium);
  color: var(--sl-color-neutral-600);
}

.loading-container sl-spinner {
  font-size: 2rem;
}

.info-message {
  color: var(--sl-color-neutral-600);
  padding: var(--sl-spacing-medium);
  text-align: center;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--sl-spacing-medium);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.message {
  --padding: 0.5rem;
  max-width: 80%;
}

.message.user {
  align-self: flex-end;
  background: var(--sl-color-primary-100);
}

.message.assistant {
  align-self: flex-start;
  background: var(--sl-color-neutral-100);
}

.message-content {
  white-space: pre-wrap;
}

.input-container {
  display: flex;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid var(--sl-color-neutral-200);
}

.input-container sl-input {
  flex: 1;
}
</style>
