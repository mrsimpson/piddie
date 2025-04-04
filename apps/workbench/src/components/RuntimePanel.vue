<script setup lang="ts">
import { ref, watch } from "vue";
import { CollapsiblePanel } from "@piddie/common-ui-vue";
import { TerminalSessionManager } from "@piddie/webcontainer-ui";
import type { RuntimeEnvironment } from "@piddie/runtime-environment";
import { useResourceService } from "@/composables/useResourceService";
import "@piddie/webcontainer-ui/style";

const props = defineProps<{
  initialCollapsed?: boolean;
  runtime?: RuntimeEnvironment;
}>();

const emit = defineEmits<{
  collapse: [isCollapsed: boolean];
}>();

const resourceService = useResourceService();
const terminalReady = ref(false);
const error = ref<Error | null>(null);
const statusMessage = ref("Initializing terminal...");

// Watch for runtime changes
watch(
  () => props.runtime,
  (runtime) => {
    if (runtime) {
      terminalReady.value = true;
      statusMessage.value = "Terminal ready";
    } else {
      terminalReady.value = false;
      statusMessage.value = "No runtime environment available";
    }
  },
  { immediate: true }
);

function handleCollapse(isCollapsed: boolean) {
  emit("collapse", isCollapsed);
}
</script>

<template>
  <CollapsiblePanel
    title="Runtime"
    expand-icon="terminal"
    direction="right"
    :initial-collapsed="props.initialCollapsed"
    @collapse="handleCollapse"
  >
    <template #content>
      <div class="runtime-content">
        <div v-if="error" class="error-message">
          <h3>Error</h3>
          <p>{{ error.message }}</p>
          <p>Please refresh the page to try again.</p>
        </div>
        <div v-else-if="!terminalReady" class="loading-message">
          <p>{{ statusMessage }}</p>
        </div>
        <TerminalSessionManager v-else :runtime="props.runtime!" />
      </div>
    </template>
  </CollapsiblePanel>
</template>

<style scoped>
.runtime-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  width: 100%;
  background-color: var(--sl-color-neutral-0);
  border-radius: var(--sl-border-radius-medium);
}

.loading-message,
.error-message,
.no-runtime-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 1rem;
  text-align: center;
}

.loading-message {
  color: var(--sl-color-primary-600);
}

.error-message {
  color: var(--sl-color-danger-600);
}

.no-runtime-message {
  color: var(--sl-color-neutral-700);
  font-style: italic;
}

/* Override terminal height to fill the panel */
:deep(.terminal-tabs-container) {
  height: 100% !important;
  border-top: none !important;
  border-radius: var(--sl-border-radius-medium);
  overflow: hidden;
}

:deep(.terminal-tabs-header) {
  background-color: var(--sl-color-neutral-100);
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

:deep(.terminal-tabs-content) {
  background-color: var(--sl-color-neutral-0);
}

:deep(.terminal-container) {
  padding: 0.5rem;
}
</style>
