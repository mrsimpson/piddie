<script setup lang="ts">
import { type ToolCall } from "@piddie/chat-management";
import ToolCallComponent from "./ToolCall.vue";

const props = defineProps<{
  toolCalls: ToolCall[];
}>();
</script>

<template>
  <div v-if="toolCalls && toolCalls.length > 0" class="tool-calls">
    <div class="tool-calls-header">Tool Calls:</div>
    <ToolCallComponent
      v-for="(toolCall, index) in toolCalls"
      :key="index"
      :tool-call="toolCall"
    />
  </div>
</template>

<style scoped>
.tool-calls {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--sl-color-neutral-200);
}

.tool-calls-header {
  font-weight: bold;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
  color: var(--sl-color-neutral-700);
}
</style>
