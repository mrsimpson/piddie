<script setup lang="ts">
import { useErrorStore } from "../stores/error-store";
import { computed, inject, defineProps } from "vue";
import type { FileSyncManager } from "@piddie/files-management";
import { handleUIError } from "../utils/error-handling";

const COMPONENT_ID = "ErrorDisplay";
const props = defineProps<{
  targetId: string; // Add prop for target ID
}>();

const errorStore = useErrorStore();
const syncManager = inject<FileSyncManager>("syncManager");

const targetErrors = computed(() => {
  return [...errorStore.errors.value]
    .filter((error) => error.componentId === props.targetId)
    .sort((a, b) => b.timestamp - a.timestamp);
});

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

async function doRecover(targetId: string) {
  if (!syncManager) {
    handleUIError("No sync manager available", COMPONENT_ID);
    return;
  }

  try {
    await syncManager.recoverTarget(targetId, "fromPrimary");
    // Remove the error after successful resolution
    errorStore.errors.value = errorStore.errors.value.filter(
      (error) => error.componentId !== targetId
    );
  } catch (err) {
    handleUIError(err, "Failed to resolve from primary", COMPONENT_ID);
  }
}
</script>

<template>
  <div class="error-display" v-if="targetErrors.length">
    <div v-for="error in targetErrors" :key="error.id" class="error-item">
      <sl-icon name="exclamation-triangle" class="info-icon"></sl-icon>
      <div class="error-details" v-show="false">
        <div class="error-message">{{ error.message }}</div>
        <div class="error-actions">
          <div class="error-meta">
            <span class="error-time">{{ formatTime(error.timestamp) }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="action-buttons">
      <sl-button size="small" variant="primary" @click="doRecover(props.targetId)">
        <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -->
        <sl-icon slot="prefix" name="arrow-repeat"></sl-icon>
        Resolve
      </sl-button>
    </div>
  </div>
</template>

<style scoped>
.error-display {
  display: flex;
  flex-direction: row;
  gap: var(--sl-spacing-x-small);
}

.error-item {
  position: relative;
  display: flex;
  align-items: center;
}

.error-item:hover .error-details {
  display: block !important;
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: var(--sl-spacing-x-small);
  background: var(--sl-color-danger-50);
  border: 1px solid var(--sl-color-danger-200);
  border-radius: var(--sl-border-radius-medium);
  padding: var(--sl-spacing-small);
  min-width: 300px;
  z-index: 1000;
}

.info-icon {
  color: var(--sl-color-danger-600);
  font-size: var(--sl-font-size-medium);
  cursor: help;
}

.error-message {
  color: var(--sl-color-danger-700);
  font-size: var(--sl-font-size-small);
  margin-bottom: var(--sl-spacing-small);
}

.error-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.error-meta {
  font-size: var(--sl-font-size-x-small);
  color: var(--sl-color-danger-600);
}

.action-buttons {
  display: flex;
  gap: var(--sl-spacing-x-small);
}
</style>
