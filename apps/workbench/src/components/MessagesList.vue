<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue";
import { MessageStatus, type Message } from "@piddie/chat-management";

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

/**
 * Get the CSS class for a message based on its role and status
 */
function getMessageClass(role: string, status: MessageStatus) {
  const classes = ["message", `message-${role}`];

  if (status === MessageStatus.SENDING) {
    classes.push("message-sending");
  } else if (status === MessageStatus.ERROR) {
    classes.push("message-error");
  }

  return classes.join(" ");
}

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
    <div
      v-for="message in messages"
      :key="message.id"
      :class="getMessageClass(message.role, message.status)"
    >
      <div class="message-header">
        <span class="message-role">{{
          message.role === "user" ? "You" : message.username || "Assistant"
        }}</span>
        <span
          v-if="message.status === MessageStatus.SENDING"
          class="message-status"
        >
          Sending...
        </span>
        <span
          v-if="message.status === MessageStatus.ERROR"
          class="message-status error"
        >
          Error
        </span>
      </div>

      <div class="message-content">
        {{ message.content || "..." }}
      </div>
    </div>
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

.message {
  padding: 1rem;
  border-radius: var(--sl-border-radius-medium);
  max-width: 80%;
  box-sizing: border-box;
}

.message-user {
  align-self: flex-end;
  background-color: var(--sl-color-primary-100);
  color: var(--sl-color-neutral-900);
}

.message-assistant {
  align-self: flex-start;
  background-color: var(--sl-color-neutral-100);
  color: var(--sl-color-neutral-900);
}

.message-sending {
  opacity: 0.7;
}

.message-error {
  border: 1px solid var(--sl-color-danger-500);
}

.message-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}

.message-role {
  font-weight: bold;
}

.message-status {
  font-style: italic;
  color: var(--sl-color-neutral-500);
}

.message-status.error {
  color: var(--sl-color-danger-500);
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
