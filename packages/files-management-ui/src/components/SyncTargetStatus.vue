<script setup lang="ts">
import type { SyncTarget } from "@piddie/shared-types";
import { ref, onMounted, onUnmounted, inject } from "vue";
import { handleUIError } from "../utils/error-handling";
import type { FileSyncManager } from "@piddie/files-management";

const COMPONENT_ID = "SyncTargetStatus";

const props = defineProps<{
  target: SyncTarget;
}>();

const syncManager = inject<FileSyncManager>("syncManager");
const state = ref(props.target.getState());
const updateInterval = ref<number>();
const lastErrorMessage = ref<string>(); // Track the last error message

function getStatusIcon(status: string): string {
  switch (status) {
    case "syncing":
      return "arrow-repeat";
    case "scanning":
      return "search";
    case "error":
      return "exclamation-triangle-fill";
    default:
      return "circle-fill";
  }
}

function updateState() {
  const newState = props.target.getState();
  // Add error to error store if status is error and it's a new error
  if (newState.status === "error" && newState.error && newState.error !== lastErrorMessage.value) {
    lastErrorMessage.value = newState.error;
    handleUIError(newState.error, `Sync error in ${props.target.id}`, props.target.id);
  } else if (newState.status !== "error") {
    // Reset last error when status is no longer error
    lastErrorMessage.value = undefined;
  }
  state.value = newState;
}

onMounted(() => {
  updateInterval.value = window.setInterval(updateState, 1000);
});

onUnmounted(() => {
  if (updateInterval.value) {
    clearInterval(updateInterval.value);
  }
});
</script>

<template>
  <div class="sync-target-status">
    <div class="status-indicator" :class="state.status">
      <sl-icon :name="getStatusIcon(state.status)" />
      {{ state.status }}
    </div>
    <div v-if="state.pendingChanges > 0" class="pending">
      {{ state.pendingChanges }} changes pending
    </div>
  </div>
</template>

<style scoped>
.sync-target-status {
  padding: var(--sl-spacing-x-small);
  border-radius: var(--sl-border-radius-small);
  background: var(--sl-color-neutral-50);
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-medium);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-x-small);
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-neutral-700);
  padding: var(--sl-spacing-x-small);
  border-radius: var(--sl-border-radius-small);
}

.status-indicator.syncing,
.status-indicator.scanning {
  background: var(--sl-color-primary-100);
  color: var(--sl-color-primary-600);
}

.status-indicator.error {
  background: var(--sl-color-danger-100);
  color: var(--sl-color-danger-700);
}

.pending {
  color: var(--sl-color-warning-600);
  font-size: var(--sl-font-size-small);
}
</style>
