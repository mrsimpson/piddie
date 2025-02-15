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

async function handleResolveFromPrimary() {
  if (!syncManager) {
    handleUIError("No sync manager available", COMPONENT_ID);
    return;
  }

  try {
    await syncManager.fullSyncFromPrimaryToTarget(props.target);
  } catch (err) {
    handleUIError(err, "Failed to resolve from primary", COMPONENT_ID);
  }
}

function updateState() {
  state.value = props.target.getState();
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
    
    <sl-button 
      v-if="state.status === 'error'"
      variant="warning"
      @click="handleResolveFromPrimary"
    >
    <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -->
      <sl-icon slot="prefix" name="arrow-repeat"></sl-icon>
      Full Sync from Primary
    </sl-button>

    <div v-if="state.error" class="error">
      {{ state.error }}
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
  padding: var(--sl-spacing-x-small) var(--sl-spacing-small);
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

.error {
  color: var(--sl-color-danger-600);
  font-size: var(--sl-font-size-small);
}

.pending {
  color: var(--sl-color-warning-600);
  font-size: var(--sl-font-size-small);
}
</style>
