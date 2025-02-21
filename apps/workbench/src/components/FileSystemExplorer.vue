<script setup lang="ts">
import { ref, computed } from "vue";
import type { FileSystem, FileSystemItem } from "@piddie/shared-types";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";

const props = defineProps<{
  entries: FileSystemItem[];
  currentPath: string;
  loading: boolean;
  error: Error | null;
}>();

const emit = defineEmits<{
  (e: "navigate", path: string): void;
}>();

const sortedItems = computed(() => {
  return [...props.entries].sort((a, b) => {
    // Directories first
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    // Then alphabetically
    return a.path.localeCompare(b.path);
  });
});

function navigateTo(path: string) {
  emit("navigate", path);
}

function navigateUp() {
  const parentPath = props.currentPath.split("/").slice(0, -1).join("/") || "/";
  emit("navigate", parentPath);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024)
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
</script>

<template>
  <div class="file-system-explorer">
    <header class="explorer-header">
      <div class="navigation">
        <button
          class="navigation-button"
          :disabled="currentPath === '/'"
          @click="navigateUp"
        >
          <sl-icon name="arrow-up" />
        </button>
        <div class="current-path">{{ currentPath }}</div>
      </div>
      <div class="actions">
        <slot name="actions"></slot>
      </div>
    </header>

    <div v-if="error" class="error-message">
      {{ error.message }}
    </div>

    <div v-else-if="loading" class="loading">
      <sl-spinner></sl-spinner>
      Loading...
    </div>

    <div v-else class="file-list">
      <div
        v-for="item in sortedItems"
        :key="item.path"
        class="file-item"
        @click="item.type === 'directory' ? navigateTo(item.path) : null"
      >
        <sl-icon
          :name="item.type === 'directory' ? 'folder' : 'file-earmark'"
        />
        <span class="name">{{ item.path }}</span>
        <span class="date">{{ formatDate(item.lastModified) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-system-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.explorer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sl-spacing-x-small);
  padding: var(--sl-spacing-x-small);
  background: var(--sl-color-neutral-50);
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

.navigation {
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-x-small);
}

.navigation-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sl-spacing-x-small);
  border: none;
  background: none;
  cursor: pointer;
  color: var(--sl-color-neutral-600);
  border-radius: var(--sl-border-radius-small);
}

.navigation-button:hover:not(:disabled) {
  background: var(--sl-color-neutral-100);
  color: var(--sl-color-neutral-900);
}

.navigation-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.current-path {
  font-family: var(--sl-font-mono);
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-neutral-600);
}

.actions {
  display: flex;
  gap: var(--sl-spacing-x-small);
}

.file-list {
  flex: 1;
  overflow: auto;
  padding: var(--sl-spacing-x-small);
}

.file-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--sl-spacing-small);
  padding: var(--sl-spacing-x-small);
  border-radius: var(--sl-border-radius-small);
  cursor: pointer;
}

.file-item:hover {
  background: var(--sl-color-neutral-50);
}

.file-item sl-icon {
  color: var(--sl-color-neutral-500);
}

.file-item .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-item .date {
  font-size: var(--sl-font-size-x-small);
  color: var(--sl-color-neutral-500);
}

.loading,
.error-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sl-spacing-small);
  padding: var(--sl-spacing-large);
  color: var(--sl-color-neutral-500);
}

.error-message {
  color: var(--sl-color-danger-600);
}
</style>
