<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ref } from "vue";
import { useChatStore } from "../stores/chat";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";

const chatStore = useChatStore();
const { currentChat, messages } = storeToRefs(chatStore);
const newMessage = ref("");

async function sendMessage() {
  if (!currentChat.value || !newMessage.value.trim()) return;
  
  await chatStore.addMessage(currentChat.value.id, newMessage.value, "user");
  newMessage.value = "";
}
</script>

<template>
  <div class="chat-container">
    <div class="messages">
      <template v-for="message in messages" :key="message.id">
        <sl-card class="message" :class="message.role">
          <div class="message-content">{{ message.content }}</div>
        </sl-card>
      </template>
    </div>
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
  </div>
</template>

<style scoped>
.chat-container {
  height: 100%;
  width: 300px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--sl-color-neutral-200);
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.message {
  --padding: 0.5rem;
  max-width: 100%;
}

.message.user {
  align-self: flex-end;
  width: 80%;
  background: var(--sl-color-primary-100);
}

.message.system {
  align-self: center;
  width: 90%;
  font-style: italic;
  background: var(--sl-color-neutral-100);
}

.message.assistant {
  align-self: flex-start;
  width: 80%;
  background: var(--sl-color-neutral-50);
}

.message-content {
  white-space: pre-wrap;
  font-size: 0.9rem;
}

.input-container {
  padding: 0.5rem;
  border-top: 1px solid var(--sl-color-neutral-200);
  display: flex;
  gap: 0.5rem;
}

.input-container sl-input {
  flex: 1;
}

.input-container sl-button {
  flex-shrink: 0;
}
</style>
