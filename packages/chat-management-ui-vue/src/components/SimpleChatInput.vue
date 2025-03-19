<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  (event: 'send-message', content: string): void;
}>();

const userInput = ref('');

function sendMessage() {
  if (!userInput.value.trim()) return;
  
  emit('send-message', userInput.value);
  userInput.value = '';
}
</script>

<template>
  <div class="simple-chat-input">
    <textarea
      v-model="userInput"
      placeholder="Type your message here..."
      @keydown.enter.prevent="sendMessage"
      rows="3"
    ></textarea>
    <button 
      @click="sendMessage"
      class="send-button"
    >
      Send
    </button>
  </div>
</template>

<style scoped>
.simple-chat-input {
  display: flex;
  flex-direction: column;
  margin-top: 1rem;
  border: 1px solid var(--sl-color-neutral-300);
  border-radius: 4px;
  overflow: hidden;
}

textarea {
  flex: 1;
  padding: 0.75rem;
  border: none;
  resize: none;
  font-family: inherit;
  font-size: 1rem;
  outline: none;
}

.send-button {
  align-self: flex-end;
  background-color: var(--sl-color-primary-600);
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  margin: 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
}

.send-button:hover {
  background-color: var(--sl-color-primary-700);
}

.send-button:disabled {
  background-color: var(--sl-color-neutral-400);
  cursor: not-allowed;
}
</style> 