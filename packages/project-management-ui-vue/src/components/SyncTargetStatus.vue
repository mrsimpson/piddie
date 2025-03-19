<script setup lang="ts">
import type { SyncTarget } from "@piddie/shared-types";
import { ref, onMounted, onUnmounted } from "vue";
import { handleUIError } from "../utils/error-handling";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";

const props = defineProps<{
  target: SyncTarget;
}>();

const state = ref(props.target.getState());
const updateInterval = ref<number>();
const lastErrorMessage = ref<string>();

function getStatusIcon(status: string): string {
  switch (status) {
    case "error":
      return "exclamation-triangle";
    case "syncing":
      return "arrow-repeat";
    case "ready":
      return "check2-circle";
    default:
      return "question-circle";
  }
}

function updateState() {
  const newState = props.target.getState();
  if (
    newState.status === "error" &&
    newState.error &&
    newState.error !== lastErrorMessage.value
  ) {
    lastErrorMessage.value = newState.error;
    handleUIError(
      newState.error,
      `Sync error in ${props.target.id}`,
      props.target.id
    );
  } else if (newState.status !== "error") {
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
    </div>
    <div v-if="state.pendingChanges > 0" class="pending">
      {{ state.pendingChanges }} changes pending
    </div>
  </div>
</template>

<style scoped>
.sync-target-status {
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-x-small);
  font-size: var(--sl-font-size-small);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-x-small);
}

.status-indicator.error {
  color: var(--sl-color-danger-600);
}

.status-indicator.syncing {
  color: var(--sl-color-primary-600);
}

.status-indicator.ready {
  color: var(--sl-color-success-600);
}

.pending {
  color: var(--sl-color-neutral-600);
}
</style>
