<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ref } from "vue";
import { useChatStore } from "../stores/chat";
import ScrollablePanel from "./ScrollablePanel.vue";
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
  <div class="chat-panel">
    <ScrollablePanel>
      <template #content>
        <div class="messages">
          <template v-for="message in messages" :key="message.id">
            <sl-card class="message" :class="message.role">
              <div class="message-content">{{ message.content }}</div>
            </sl-card>
          </template>
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
    </ScrollablePanel>
  </div>
</template>

<style scoped>
.chat-panel {
  height: 100%;
  width: 300px;
  border-right: 1px solid var(--sl-color-neutral-200);
}

.messages {
  padding: 1rem;
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
