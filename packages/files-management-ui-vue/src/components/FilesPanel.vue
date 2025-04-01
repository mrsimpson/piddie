<script setup lang="ts">
import { ref, watch, computed } from "vue";
import type { SynchronizedFileSystem } from "../types/file-system";
import type { FileSystemItem, FileChangeInfo } from "@piddie/shared-types";
import { WATCHER_PRIORITIES } from "@piddie/shared-types";
import { useFileSystemStore } from "../stores/file-system";
import FileSystemExplorer from "./FileSystemExplorer.vue";
import { CollapsiblePanel } from "@piddie/common-ui-vue";
import SyncTargetSelector from "./SyncTargetSelector.vue";
import CodeEditor from "./CodeEditor.vue";
import { useThemeStore } from "@piddie/common-ui-vue";
import type { SyncTarget } from "@piddie/files-management";

const props = defineProps<{
  systems: SynchronizedFileSystem[];
  initialCollapsed?: boolean;
  error?: Error | null;
}>();

const emit = defineEmits<{
  (e: "collapse", isCollapsed: boolean): void;
}>();

const fileSystemStore = useFileSystemStore();
const themeStore = useThemeStore();
const currentTheme = computed(() => themeStore.theme);
const selectedSystem = ref<SynchronizedFileSystem | null>(null);
const isLoading = ref(true);
const entries = ref<FileSystemItem[]>([]);
const currentPath = ref("/");
const explorerError = ref<Error | null>(null);
const loadingEntries = ref(false);
const explorerRef = ref<{ handleFileChanges: (changes: FileChangeInfo[]) => void } | null>(null);

// Update selected system when systems change
watch(
  () => props.systems,
  (newSystems) => {
    isLoading.value = true;
    if (newSystems.length === 0) {
      selectedSystem.value = null;
      return;
    }
    // Prefer browser system if available
    selectedSystem.value =
      newSystems.find((s) => s.id === "browser") || newSystems[0];
    setTimeout(() => {
      isLoading.value = false;
      loadDirectory("/");
    }, 300);
  },
  { immediate: true }
);

// Load entries when selected system or current path changes
watch([selectedSystem, currentPath], async () => {
  if (selectedSystem.value) {
    await loadDirectory(currentPath.value);
  }
});

// Watch for system changes and set up file change handlers
watch(selectedSystem, async (newSystem, oldSystem) => {
  if (oldSystem?.syncTarget) {
    // Unwatch old system
    await oldSystem.syncTarget.unwatch();
  }
  
  if (newSystem?.syncTarget) {
    // Watch new system
    await newSystem.syncTarget.watch(
      (changes: FileChangeInfo[]) => {
        console.log("FilesPanel: Received file changes:", changes);
        if (explorerRef.value) {
          explorerRef.value.handleFileChanges(changes);
          // Reload directory if changes affect current path
          const hasChangesInCurrentDir = changes.some((change: FileChangeInfo) => {
            const parentDir = change.path.split("/").slice(0, -1).join("/") || "/";
            return parentDir === currentPath.value;
          });
          if (hasChangesInCurrentDir) {
            loadDirectory(currentPath.value);
          }
        }
      },
      {
        priority: WATCHER_PRIORITIES.UI_UPDATES,
        metadata: {
          registeredBy: "FilesPanel",
          type: "ui-explorer"
        }
      }
    );
  }
}, { immediate: true });

async function loadDirectory(path: string) {
  if (!selectedSystem.value) return;

  loadingEntries.value = true;
  explorerError.value = null;
  try {
    const directoryEntries =
      await selectedSystem.value.fileSystem.listDirectory(path);
    entries.value = [...directoryEntries];
    currentPath.value = path;
  } catch (err) {
    console.error("Error loading directory:", err);
    explorerError.value = err as Error;
  } finally {
    loadingEntries.value = false;
  }
}

function handleSelectFile(item: FileSystemItem) {
  if (selectedSystem.value) {
    fileSystemStore.selectFile(item.path, selectedSystem.value);
  }
}

function handleNavigate(path: string) {
  currentPath.value = path;
}

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
    direction="left"
  >
    <template #header>
      <div class="panel-header">
        <SyncTargetSelector
          :systems="systems"
          :selected-system="selectedSystem"
          @select="handleSystemSelect"
        />
      </div>
    </template>
    <template #content>
      <div class="files-panel">
        <div class="explorer-section">
          <div class="explorer-header">
            <div class="current-path">{{ currentPath }}</div>
          </div>
          <div class="explorer-content">
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
            <FileSystemExplorer
              v-else-if="selectedSystem"
              ref="explorerRef"
              :entries="entries"
              :current-path="currentPath"
              :loading="loadingEntries"
              :error="explorerError || null"
              :selected-file="fileSystemStore.selectedFile?.path"
              @navigate="handleNavigate"
              @select-file="handleSelectFile"
            />
          </div>
        </div>
        <div class="editor-section">
          <CodeEditor :theme="currentTheme" />
        </div>
      </div>
    </template>
  </CollapsiblePanel>
</template>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-x-small);
  padding: var(--sl-spacing-x-small);
}

.files-panel {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 1px;
  height: 100%;
  width: 100%;
  background: var(--sl-color-neutral-200);
}

.explorer-section,
.editor-section {
  background: var(--sl-color-neutral-0);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.explorer-header {
  display: flex;
  align-items: center;
  padding: var(--sl-spacing-x-small);
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

.current-path {
  font-family: var(--sl-font-mono);
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-neutral-600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer-content {
  flex: 1;
  overflow: auto;
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
