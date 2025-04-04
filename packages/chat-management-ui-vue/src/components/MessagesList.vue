<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue";
import MessageComponent from "./Message.vue";
import type { Message } from "@piddie/chat-management";

const props = defineProps<{
  messages: Message[];
}>();

// Reference to the messages container for scrolling
const messagesContainer = ref<HTMLElement | null>(null);

/**
 * Scrolls to the bottom of the messages container
 */
const scrollToBottom = async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
};

// Watch for changes in messages to auto-scroll
watch(
  () => props.messages,
  async () => {
    await scrollToBottom();
  },
  { deep: true }
);

// Watch for changes in the last message's content (for streaming)
watch(
  () => props.messages[props.messages.length - 1]?.content,
  async () => {
    await scrollToBottom();
  }
);

// Initial scroll to bottom when component is mounted
onMounted(async () => {
  await scrollToBottom();
});
</script>

<template>
  <div ref="messagesContainer" class="messages">
    <MessageComponent
      v-for="message in messages"
      :key="message.id"
      :message="message"
    />
  </div>
</template>

<style scoped>
.messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--sl-spacing-medium);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  box-sizing: border-box;
  height: 100%;
}
</style>
