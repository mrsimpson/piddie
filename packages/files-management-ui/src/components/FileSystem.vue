<script setup lang="ts">
import type { SynchronizedFileSystem } from "../types/file-explorer";
import type { FileChangeInfo } from "@piddie/shared-types";
import {
  BrowserSyncTarget,
  BrowserNativeSyncTarget,
  WebContainerSyncTarget
} from "@piddie/files-management";
import { WATCHER_PRIORITIES } from "@piddie/shared-types";
import FileSystemExplorer from "./FileSystemExplorer.vue";
import SyncTargetStatus from "./SyncTargetStatus.vue";
import { ref, onMounted, onBeforeUnmount, computed } from "vue";
import { handleUIError } from "../utils/error-handling";

const COMPONENT_ID = "FileSystem";
const props = defineProps<{
  system: SynchronizedFileSystem;
}>();

const explorerRef = ref<InstanceType<typeof FileSystemExplorer> | null>(null);
const uiSyncTarget = ref<
  BrowserSyncTarget | BrowserNativeSyncTarget | WebContainerSyncTarget | null
>(null);
const isInitializing = ref(true);
const isScanning = ref(false);
const isSyncing = ref(false);

// Computed loading text based on state
const loadingText = computed(() => {
  if (isInitializing.value) return 'Initializing...';
  if (isScanning.value) return 'Scanning files...';
  if (isSyncing.value) return 'Synchronizing files...';
  return '';
});

// Handle errors from child components
function handleError(err: Error | string) {
  handleUIError(err, "File system error", COMPONENT_ID);
}

// Initialize UI sync target
async function initializeUISyncTarget() {
  try {
    isInitializing.value = true;
    // Create UI sync target of the same type as the main sync target
    if (props.system.syncTarget instanceof BrowserNativeSyncTarget) {
      uiSyncTarget.value = new BrowserNativeSyncTarget(`ui-${props.system.id}`);
    } else if (props.system.syncTarget instanceof WebContainerSyncTarget) {
      uiSyncTarget.value = new WebContainerSyncTarget(`ui-${props.system.id}`);
    } else {
      uiSyncTarget.value = new BrowserSyncTarget(`ui-${props.system.id}`);
    }

    // Initialize with the SAME file system instance as the main sync target
    await uiSyncTarget.value.initialize(props.system.fileSystem, false, {skipBackgroundScan: true});
    console.log(`UI sync target initialized for ${props.system.id} with existing file system`);

    // Watch for state changes - only after initialization
    await uiSyncTarget.value.watch(
      () => {},
      {
        priority: WATCHER_PRIORITIES.UI_UPDATES,
        metadata: {
          registeredBy: COMPONENT_ID,
          type: "state-watcher"
        },
        filter: () => {
          // Update state based on target state
          const state = uiSyncTarget.value?.getState().state;
          isScanning.value = state === "scanning";
          isSyncing.value = state === "syncing";
          return false; // Don't actually process any changes
        }
      }
    );

    // Set up watching only after successful initialization
    await setupWatcher();
  } catch (err) {
    console.error(`Failed to initialize UI sync target for ${props.system.id}:`, err);
    handleUIError(err, "Failed to initialize UI sync target", COMPONENT_ID);
    throw err; // Re-throw to handle in mount
  } finally {
    isInitializing.value = false;
  }
}

// Set up watcher
async function setupWatcher() {
  if (!uiSyncTarget.value) {
    throw new Error("UI sync target not initialized");
  }

  try {
    await uiSyncTarget.value.watch(
      async (changes: FileChangeInfo[]) => {
        console.log(`UI update triggered for ${props.system.id}`);
        if (explorerRef.value) {
          await explorerRef.value.handleFileChanges(changes);
        }
      },
      {
        priority: WATCHER_PRIORITIES.UI_UPDATES,
        metadata: {
          registeredBy: "FileSystem",
          type: "ui-watcher",
          systemId: props.system.id
        }
      }
    );
    console.log(`Watcher set up for ${props.system.id}`);
  } catch (err) {
    console.error(`Failed to set up watcher for ${props.system.id}:`, err);
    handleUIError(err, "Failed to set up file watcher", COMPONENT_ID);
    throw err;
  }
}

// Clean up sync target
async function cleanupSyncTarget() {
  if (uiSyncTarget.value) {
    try {
      // Unwatch to stop receiving updates and clean up
      await uiSyncTarget.value.unwatch();
      console.log(`UI sync target cleaned up for ${props.system.id}`);
    } catch (err) {
      console.error(`Error cleaning up UI sync target for ${props.system.id}:`, err);
      handleUIError(err, "Error during sync target cleanup", COMPONENT_ID);
    } finally {
      uiSyncTarget.value = null;
    }
  }
}

// Component lifecycle
onMounted(async () => {
  try {
    await initializeUISyncTarget();
  } catch (err) {
    // Error already handled in initializeUISyncTarget
    console.error("Failed to set up UI sync target during mount:", err);
  }
});

onBeforeUnmount(async () => {
  await cleanupSyncTarget();
});
</script>

<template>
  <div class="file-system">
    <div v-if="isInitializing || isScanning || isSyncing" class="loading-overlay">
      <sl-spinner></sl-spinner>
      <div class="loading-text">
        {{ loadingText }}
      </div>
    </div>
    <FileSystemExplorer
      ref="explorerRef"
      :system="system"
      :sync-target="uiSyncTarget"
      :disabled="isInitializing || isScanning || isSyncing"
      @error="handleError"
    />
    <SyncTargetStatus :target="system.syncTarget" />
  </div>
</template>

<style scoped>
.file-system {
  position: relative;
  height: 100%;
  border: 1px solid var(--sl-color-neutral-300);
  border-radius: var(--sl-border-radius-medium);
  padding: var(--sl-spacing-medium);
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(var(--sl-color-neutral-0-rgb), 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sl-spacing-medium);
  z-index: 1;
}

.loading-text {
  color: var(--sl-color-neutral-700);
  font-size: var(--sl-font-size-small);
}
</style>
