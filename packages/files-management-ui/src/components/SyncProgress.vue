<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import type { SyncProgressEvent, SyncManager } from "@piddie/shared-types";

const props = defineProps<{
  syncManager: SyncManager;
}>();

const currentProgress = ref<SyncProgressEvent | null>(null);
const isVisible = ref(false);

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper to get progress percentage
function getProgressPercentage(): number {
  if (!currentProgress.value) return 0;

  switch (currentProgress.value.type) {
    case "syncing":
      return (currentProgress.value.syncedFiles / currentProgress.value.totalFiles) * 100;
    case "streaming":
      return (currentProgress.value.processedBytes / currentProgress.value.totalBytes) * 100;
    case "collecting":
      return (currentProgress.value.collectedFiles / currentProgress.value.totalFiles) * 100;
    case "completing":
      return 100;
    default:
      return 0;
  }
}

// Progress listener
function handleProgress(progress: SyncProgressEvent) {
  if (progress.type === "syncing") {
    currentProgress.value = progress;
  }

  // Show progress for all events except completion
  isVisible.value = progress.type !== "completing";

  // Hide progress after completion
  if (progress.type === "completing") {
    setTimeout(() => {
      isVisible.value = false;
      currentProgress.value = null;
    }, 2000);
  }
}

// Setup and cleanup
onMounted(() => {
  props.syncManager.addProgressListener(handleProgress);
});

onBeforeUnmount(() => {
  props.syncManager.removeProgressListener(handleProgress);
});

// Add this function in the script section after formatBytes:
function getFileName(): string {
  if (!currentProgress.value) return "";

  switch (currentProgress.value.type) {
    case "syncing":
    case "streaming":
    case "error":
      return currentProgress.value.currentFile;
    case "collecting":
      return "Scanning files...";
    case "completing":
      return "Finalizing...";
    default:
      return "";
  }
}
</script>

<template>
  <div class="sync-progress" :class="{ visible: isVisible }">
    <div class="progress-content">
      <sl-progress-bar
        v-if="currentProgress?.type !== 'error'"
        :value="getProgressPercentage()"
      ></sl-progress-bar>
      <div class="progress-info">
        <div class="progress-type">
          {{ currentProgress?.type?.toUpperCase() }}
        </div>
        <div class="progress-file" :title="getFileName()">
          {{ getFileName() }}
        </div>
        <div class="progress-count">
          <template v-if="currentProgress?.type === 'syncing'">
            {{ currentProgress.syncedFiles }}/{{ currentProgress.totalFiles }} files
          </template>
          <template v-else-if="currentProgress?.type === 'streaming'">
            {{ formatBytes(currentProgress.processedBytes) }}/{{
              formatBytes(currentProgress.totalBytes)
            }}
          </template>
          <template v-else-if="currentProgress?.type === 'collecting'">
            {{ currentProgress.collectedFiles }}/{{ currentProgress.totalFiles }} files
          </template>
          <template v-else-if="currentProgress?.type === 'completing'">
            {{ currentProgress.successfulFiles }}/{{ currentProgress.totalFiles }} files
          </template>
          <template v-else-if="currentProgress?.type === 'error'">
            <sl-icon name="exclamation-triangle"></sl-icon>
            Error
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sync-progress {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--sl-color-neutral-0);
  border-top: 1px solid var(--sl-color-neutral-200);
  padding: var(--sl-spacing-medium);
  transform: translateY(100%);
  transition: transform 0.3s ease-in-out;
  z-index: 1000;
}

.sync-progress.visible {
  transform: translateY(0);
}

.progress-content {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--sl-spacing-small);
}

.progress-info {
  display: grid;
  grid-template-columns: minmax(100px, auto) 1fr minmax(120px, auto);
  gap: var(--sl-spacing-medium);
  align-items: center;
  min-height: 24px;
}

.progress-type {
  font-size: var(--sl-font-size-small);
  font-weight: var(--sl-font-weight-semibold);
  color: var(--sl-color-neutral-600);
  text-transform: uppercase;
}

.progress-file {
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-neutral-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-count {
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-neutral-600);
  text-align: right;
  white-space: nowrap;
}

sl-progress-bar::part(base) {
  --height: 4px;
}

sl-icon {
  font-size: 1em;
  vertical-align: -0.125em;
  margin-right: var(--sl-spacing-2x-small);
  color: var(--sl-color-danger-600);
}
</style>
