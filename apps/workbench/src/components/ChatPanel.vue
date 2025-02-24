<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ref, watch } from "vue";
import { useChatStore } from "../stores/chat";
import CollapsiblePanel from "./ui/CollapsiblePanel.vue";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";

const chatStore = useChatStore();
const { currentChat, messages, isProcessing } = storeToRefs(chatStore);
const newMessage = ref("");
const isLoading = ref(true);
const error = ref("");
const streamingMessage = ref("");

// Watch for chat changes to handle loading state
watch(
  () => currentChat.value,
  (newChat) => {
    isLoading.value = true;
    error.value = "";
    streamingMessage.value = "";

    // Short delay to ensure smooth transition
    setTimeout(() => {
      isLoading.value = false;
    }, 300);
  },
  { immediate: true }
);

async function sendMessage() {
  if (!currentChat.value || !newMessage.value.trim()) return;

  error.value = "";
  streamingMessage.value = "";
  const message = newMessage.value;
  newMessage.value = "";

  try {
    // Stream the response
    for await (const chunk of chatStore.streamMessage(message)) {
      streamingMessage.value += chunk;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to send message";
    // Add message back to input if failed
    newMessage.value = message;
  }
}
</script>

<template>
  <div class="chat-panel">
    <CollapsiblePanel :display-toggle="false">
      <template #header>
        <div class="chat-header">
          <h2>Chat</h2>
          <sl-spinner v-if="isProcessing" />
        </div>
      </template>

      <div v-if="isLoading" class="loading-container">
        <sl-spinner></sl-spinner>
      </div>
      <div v-else class="chat-container">
        <div class="messages" ref="messagesContainer">
          <sl-alert v-if="error" variant="danger" class="error-alert">
            {{ error }}
          </sl-alert>

          <div v-for="message in messages" :key="message.id" class="message">
            <sl-card>
              <div class="message-header">
                <strong>{{
                  message.role === "user" ? "You" : "Assistant"
                }}</strong>
              </div>
              <div class="message-content">
                {{ message.content }}
              </div>
            </sl-card>
          </div>

          <!-- Streaming message -->
          <div v-if="streamingMessage" class="message">
            <sl-card>
              <div class="message-header">
                <strong>Assistant</strong>
              </div>
              <div class="message-content streaming">
                {{ streamingMessage }}<span class="cursor"></span>
              </div>
            </sl-card>
          </div>
        </div>

        <div class="input-container">
          <sl-input
            v-model="newMessage"
            placeholder="Type your message..."
            :disabled="isProcessing"
            @keyup.enter="sendMessage"
          ></sl-input>
          <sl-button
            variant="primary"
            :disabled="isProcessing || !newMessage.trim()"
            @click="sendMessage"
          >
            Send
          </sl-button>
        </div>
      </div>
    </CollapsiblePanel>
  </div>
</template>

<style scoped>
.chat-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.chat-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.loading-container {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.message sl-card::part(base) {
  background: var(--sl-color-neutral-50);
}

.message-header {
  margin-bottom: 0.5rem;
  color: var(--sl-color-neutral-600);
}

.message-content {
  white-space: pre-wrap;
}

.message-content.streaming {
  position: relative;
}

.message-content.streaming .cursor {
  display: inline-block;
  width: 0.5em;
  height: 1em;
  background: var(--sl-color-primary-600);
  animation: blink 1s infinite;
  vertical-align: middle;
  margin-left: 2px;
}

@keyframes blink {
  0%,
  100% {
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
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

.error-alert {
  margin-bottom: 1rem;
}
</style>
