<script setup lang="ts">
import { type ToolCall } from "@piddie/chat-management";
import { computed } from "vue";

const props = defineProps<{
  toolCall: ToolCall;
}>();

/**
 * Format tool call arguments for display
 */
function formatToolCallArguments(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2);
}

/**
 * Format tool call result for display
 */
function formatToolCallResult(result: ToolCall["result"]): string {
  if (!result) return "";

  try {
    if (isJsonResult(result)) {
      return JSON.stringify(result.value, null, 2);
    } else if (isTextResult(result)) {
      return String(result.value);
    } else if (isBinaryResult(result)) {
      return "Binary data";
    }
    return String(result.value);
  } catch (e) {
    return String(result.value);
  }
}

/**
 * Get the result type display text
 */
function getResultTypeDisplay(result: ToolCall["result"]): string {
  if (!result) return "";

  if (isJsonResult(result)) {
    return "JSON";
  } else if (isTextResult(result)) {
    return result.contentType!.replace("text/", "");
  } else if (isBinaryResult(result)) {
    return "Binary";
  }

  return result.contentType || "Text";
}

/**
 * Determine if a tool call has a result
 */
function hasToolCallResult(toolCall: ToolCall): boolean {
  return Boolean(toolCall.result);
}

/**
 * Determine if a result is binary data
 */
function isBinaryResult(result: ToolCall["result"]): boolean {
  if (!result) return false;

  return result.contentType === "application/octet-stream";
}

/**
 * Determine if a result is JSON
 */
function isJsonResult(result: ToolCall["result"]): boolean {
  if (!result) return false;

  return result.contentType === "application/json";
}

/**
 * Determine if a result is text
 */
function isTextResult(result: ToolCall["result"]): boolean {
  if (!result) return false;

  return !!result.contentType?.startsWith("text/");
}

/**
 * Compute result class based on type and status
 */
const resultClass = computed((): Record<string, boolean> => {
  if (!props.toolCall.result) return {};

  const classes: Record<string, boolean> = {
    [props.toolCall.result.status]: true
  };

  if (isJsonResult(props.toolCall.result)) {
    classes["json-result"] = true;
  }

  if (isBinaryResult(props.toolCall.result)) {
    classes["binary-result"] = true;
  }

  return classes;
});
</script>

<template>
  <div
    class="tool-call"
    :class="{ 'tool-call-with-result': hasToolCallResult(toolCall) }"
  >
    <div class="tool-call-name">
      {{ toolCall.function.name }}
      <span
        v-if="toolCall.result"
        class="tool-call-status"
        :class="toolCall.result.status"
      >
        {{ toolCall.result.status }}
      </span>
    </div>
    <pre class="tool-call-arguments">{{
      formatToolCallArguments(toolCall.function.arguments)
    }}</pre>

    <!-- Display tool call result if present -->
    <div v-if="toolCall.result" class="tool-call-result">
      <div class="tool-call-result-header">
        Result:
        <span class="result-type" v-if="toolCall.result.contentType">
          {{ getResultTypeDisplay(toolCall.result) }}
        </span>
      </div>
      <pre class="tool-call-result-value" :class="resultClass">
        {{ formatToolCallResult(toolCall.result) }}
      </pre>
    </div>
  </div>
</template>

<style scoped>
.tool-call {
  background-color: var(--sl-color-neutral-50);
  border-radius: var(--sl-border-radius-small);
  padding: 0.5rem;
  margin-bottom: 0.5rem;
}

.tool-call-with-result {
  border-left: 3px solid var(--sl-color-primary-500);
}

.tool-call-name {
  font-weight: bold;
  font-family: monospace;
  color: var(--sl-color-primary-600);
  margin-bottom: 0.25rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tool-call-status {
  font-size: 0.75rem;
  padding: 0.1rem 0.4rem;
  border-radius: var(--sl-border-radius-pill);
  background-color: var(--sl-color-neutral-200);
}

.tool-call-status.success {
  background-color: var(--sl-color-success-100);
  color: var(--sl-color-success-700);
}

.tool-call-status.error {
  background-color: var(--sl-color-danger-100);
  color: var(--sl-color-danger-700);
}

.tool-call-arguments {
  font-family: monospace;
  font-size: 0.8rem;
  background-color: var(--sl-color-neutral-100);
  padding: 0.5rem;
  border-radius: var(--sl-border-radius-small);
  overflow-x: auto;
  margin: 0;
}

.tool-call-result {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--sl-color-neutral-300);
}

.tool-call-result-header {
  font-weight: bold;
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
  color: var(--sl-color-neutral-700);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.result-type {
  font-size: 0.7rem;
  padding: 0.1rem 0.3rem;
  background-color: var(--sl-color-neutral-200);
  border-radius: var(--sl-border-radius-pill);
  font-weight: normal;
}

.tool-call-result-value {
  font-family: monospace;
  font-size: 0.8rem;
  padding: 0.5rem;
  border-radius: var(--sl-border-radius-small);
  overflow-x: auto;
  margin: 0;
  background-color: var(--sl-color-neutral-50);
}

.tool-call-result-value.success {
  background-color: var(--sl-color-success-50);
  border-left: 2px solid var(--sl-color-success-500);
}

.tool-call-result-value.error {
  background-color: var(--sl-color-danger-50);
  border-left: 2px solid var(--sl-color-danger-500);
}

.tool-call-result-value.json-result {
  color: var(--sl-color-primary-700);
}

.tool-call-result-value.binary-result {
  color: var(--sl-color-neutral-600);
  font-style: italic;
}
</style>
