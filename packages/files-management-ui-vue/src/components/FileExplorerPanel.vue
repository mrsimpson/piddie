<script setup lang="ts">
import { ref, watch } from "vue";
import type { SynchronizedFileSystem } from "../types/file-system";
import FileSystem from "./FileSystem.vue";
import SyncTargetSelector from "./SyncTargetSelector.vue";
import { CollapsiblePanel } from "@piddie/common-ui-vue";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";

const props = defineProps<{
  systems: SynchronizedFileSystem[];
  error?: Error | null;
  initialCollapsed?: boolean;
}>();

const emit = defineEmits<{
  collapse: [isCollapsed: boolean];
}>();

const selectedSystem = ref<SynchronizedFileSystem | null>(null);
const isLoading = ref(true);

// Update selected system when systems change
watch(
  () => props.systems,
  (newSystems) => {
    isLoading.value = true;

    // If systems array is empty, reset selected system
    if (newSystems.length === 0) {
      selectedSystem.value = null;
      return;
    }

    // Always prefer browser system if available
    selectedSystem.value =
      newSystems.find((s) => s.id === "browser") || newSystems[0];

    // Short delay to ensure smooth transition
    setTimeout(() => {
      isLoading.value = false;
    }, 300);
  },
  { immediate: true }
);

function handleSystemSelect(system: SynchronizedFileSystem) {
  selectedSystem.value = system;
}

function handleCollapse(isCollapsed: boolean) {
  emit("collapse", isCollapsed);
}
</script>

<template>
  <CollapsiblePanel
    :initial-collapsed="props.initialCollapsed"
    @collapse="handleCollapse"
    expand-icon="folder"
  >
    <template #header>
      <div class="file-explorer-header">
        <SyncTargetSelector
          :systems="systems"
          :selected-system="selectedSystem"
          @select="handleSystemSelect"
        />
      </div>
    </template>
    <template #content>
      <div class="file-explorer">
        <div v-if="error" class="error-message">
          {{ error.message }}
        </div>
        <div v-else-if="isLoading" class="loading-container">
          <sl-spinner></sl-spinner>
          <span>Loading files...</span>
        </div>
        <div v-else-if="systems.length === 0" class="info-message">
          Loading file systems...
        </div>
        <FileSystem v-else-if="selectedSystem" :system="selectedSystem" />
      </div>
    </template>
  </CollapsiblePanel>
</template>

<style scoped>
.file-explorer {
  height: 100%;
  overflow-y: auto;
}

.file-explorer-header {
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-x-small);
}

.loading-container,
.error-message,
.info-message {
  padding: var(--sl-spacing-medium);
  text-align: center;
  color: var(--sl-color-neutral-600);
}

.error-message {
  color: var(--sl-color-danger-600);
}
</style>
