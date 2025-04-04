<script setup lang="ts">
import { computed } from "vue";
import { MessageStatus, type Message } from "@piddie/chat-management";
import ToolCalls from "./ToolCalls.vue";

const props = defineProps<{
  message: Message;
}>();

/**
 * Get the CSS class for a message based on its role and status
 */
const messageClass = computed(() => {
  const classes = ["message", `message-${props.message.role}`];

  if (props.message.status === MessageStatus.SENDING) {
    classes.push("message-sending");
  } else if (props.message.status === MessageStatus.ERROR) {
    classes.push("message-error");
  }

  if (isTemporaryMessage(props.message)) {
    classes.push("message-temporary");
  }

  return classes.join(" ");
});

/**
 * Check if a message is temporary
 */
function isTemporaryMessage(message: Message): boolean {
  return message.id.startsWith("temp_");
}
</script>

<template>
  <div :class="messageClass">
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
      {{ message.content }}
    </div>

    <!-- Display tool calls -->
    <ToolCalls v-if="message.tool_calls" :tool-calls="message.tool_calls" />
  </div>
</template>

<style scoped>
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

.message-temporary {
  border: 1px dashed var(--sl-color-neutral-300);
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
