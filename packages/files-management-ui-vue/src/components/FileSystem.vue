<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import type { SynchronizedFileSystem } from "../types/file-system";
import {
  WATCHER_PRIORITIES,
  type FileSystem,
  type FileSystemItem,
  type FileChangeInfo,
  type SyncTarget
} from "@piddie/shared-types";
import {
  BrowserSyncTarget,
  BrowserNativeSyncTarget,
  WebContainerSyncTarget
} from "@piddie/files-management";
import FileSystemExplorer from "./FileSystemExplorer.vue";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";

const props = defineProps<{
  system: SynchronizedFileSystem;
}>();

const currentPath = ref("/");
const entries = ref<FileSystemItem[]>([]);
const loading = ref(false);
const error = ref<Error | null>(null);
const showNewFileDialog = ref(false);
const newFileName = ref("");
const newFileError = ref<string | null>(null);
const explorerRef = ref<InstanceType<typeof FileSystemExplorer> | null>(null);
const uiSyncTarget = ref<SyncTarget | null>(null);

// Watch for system changes
watch(
  () => props.system,
  async (newSystem) => {
    console.log("System changed, initializing UI sync target");

    // Clean up previous UI sync target if exists
    if (uiSyncTarget.value) {
      console.log("Cleaning up previous UI sync target");
      await uiSyncTarget.value.unwatch();
      uiSyncTarget.value = null;
    }

    // Initialize a new UI sync target
    await initializeUISyncTarget(newSystem);

    // Load initial directory
    console.log("Loading initial directory");
    await loadDirectory("/");
  },
  { immediate: true }
);

// Initialize a dedicated UI sync target
async function initializeUISyncTarget(system: SynchronizedFileSystem) {
  try {
    console.log("Initializing UI sync target");
    loading.value = true;

    // Create UI sync target of the same type as the main sync target
    const mainTarget = system.syncTarget;
    const uiTargetId = `ui-${system.id}`;

    if (mainTarget instanceof BrowserNativeSyncTarget) {
      uiSyncTarget.value = new BrowserNativeSyncTarget(uiTargetId);
    } else if (mainTarget instanceof WebContainerSyncTarget) {
      uiSyncTarget.value = new WebContainerSyncTarget(uiTargetId);
    } else {
      uiSyncTarget.value = new BrowserSyncTarget(uiTargetId);
    }

    // Initialize with the SAME file system instance as the main sync target
    await uiSyncTarget.value.initialize(system.fileSystem, false, {
      skipFileScan: true
    });
    console.log(
      `UI sync target initialized for ${system.id} with existing file system`
    );

    // Set up watcher for UI updates
    await setupWatcher();
  } catch (err) {
    console.error("Failed to initialize UI sync target:", err);
    error.value = err as Error;
  } finally {
    loading.value = false;
  }
}

// Set up watcher on the UI sync target
async function setupWatcher() {
  if (!uiSyncTarget.value) {
    console.error("Cannot set up watcher: UI sync target not initialized");
    return;
  }

  try {
    console.log("Setting up watcher on UI sync target");
    await uiSyncTarget.value.watch(
      (changes: FileChangeInfo[]) => {
        console.log("UI sync target watcher triggered with changes:", changes);

        if (changes.length > 0) {
          console.log("Processing file changes in UI sync target");
          handleFileChanges(changes);

          // Also notify the explorer component
          if (explorerRef.value) {
            explorerRef.value.handleFileChanges(changes);
          }
        }
      },
      {
        priority: WATCHER_PRIORITIES.UI_UPDATES,
        metadata: {
          registeredBy: "FileSystem.vue",
          type: "ui-watcher"
        }
      }
    );
    console.log("Watcher set up successfully on UI sync target");
  } catch (err) {
    console.error("Failed to set up watcher on UI sync target:", err);
    error.value = err as Error;
  }
}

function isValidFileName(name: string): boolean {
  // Check for common invalid characters in filenames
  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
  return name.length > 0 && !invalidChars.test(name);
}

async function loadDirectory(path: string) {
  console.log("Loading directory:", path);
  loading.value = true;
  error.value = null;
  try {
    const directoryEntries = await props.system.fileSystem.listDirectory(path);
    console.log("Directory entries:", directoryEntries);

    // Use Vue's reactivity system to update the entries
    entries.value = [...directoryEntries];
    currentPath.value = path;
  } catch (err) {
    console.error("Error loading directory:", err);
    error.value = err as Error;
  } finally {
    loading.value = false;
  }
}

// Handle file changes from sync target
function handleFileChanges(changes: FileChangeInfo[]) {
  console.log("Handling file changes:", changes);
  const currentDir = currentPath.value;

  // Check if the current directory itself was deleted
  const currentDirDeleted = changes.some(
    (change) =>
      change.type === "delete" &&
      (change.path === currentDir || currentDir.startsWith(change.path + "/"))
  );

  if (currentDirDeleted) {
    console.log("Current directory was deleted, navigating up");
    // Navigate up if current directory was deleted
    const parentPath = currentDir.split("/").slice(0, -1).join("/") || "/";
    loadDirectory(parentPath);
    return;
  }

  // Check if any of the changes affect the current directory
  const hasChangesInCurrentDir = changes.some((change) => {
    const parentDir = change.path.split("/").slice(0, -1).join("/") || "/";
    return parentDir === currentDir;
  });

  console.log("Changes affect current directory:", hasChangesInCurrentDir);
  if (hasChangesInCurrentDir) {
    console.log("Reloading current directory:", currentDir);
    // Reload the current directory if changes affect it
    loadDirectory(currentDir);
  }
}

function handleNavigate(path: string) {
  loadDirectory(path);
}

async function handleCreateFile() {
  if (!newFileName.value) {
    newFileError.value = "Please enter a file name";
    return;
  }

  if (!isValidFileName(newFileName.value)) {
    newFileError.value =
      'Invalid file name. File names cannot contain: < > : " / \\ | ? *';
    return;
  }

  try {
    const path =
      currentPath.value === "/"
        ? `/${newFileName.value}`
        : `${currentPath.value}/${newFileName.value}`;

    // Check if file already exists
    const exists = await props.system.fileSystem.exists(path);
    if (exists) {
      newFileError.value = "A file with this name already exists";
      return;
    }

    await props.system.fileSystem.writeFile(path, "");
    await loadDirectory(currentPath.value);
    showNewFileDialog.value = false;
    newFileName.value = "";
    newFileError.value = null;
  } catch (err) {
    newFileError.value = (err as Error).message;
  }
}

function openNewFileDialog() {
  showNewFileDialog.value = true;
  newFileName.value = "";
  newFileError.value = null;
  error.value = null;
}

onMounted(async () => {
  // Initial load is handled by the watch with immediate: true
});

onUnmounted(async () => {
  // Clean up UI sync target
  if (uiSyncTarget.value) {
    console.log("Cleaning up UI sync target on unmount");
    await uiSyncTarget.value.unwatch();
    uiSyncTarget.value = null;
  }
});
</script>

<template>
  <div class="file-system">
    <FileSystemExplorer
      ref="explorerRef"
      :entries="entries"
      :current-path="currentPath"
      :loading="loading"
      :error="error"
      @navigate="handleNavigate"
    >
      <template #actions>
        <sl-button size="small" @click="openNewFileDialog">
          <sl-icon slot="prefix" name="plus-lg"></sl-icon>
          New File
        </sl-button>
      </template>
    </FileSystemExplorer>

    <sl-dialog
      label="Create New File"
      :open="showNewFileDialog"
      @sl-after-hide="showNewFileDialog = false"
      @sl-initial-focus="$event.target.querySelector('sl-input').focus()"
    >
      <sl-input
        label="File Name"
        v-model="newFileName"
        @keyup.enter="handleCreateFile"
        :help-text="newFileError"
        :invalid="!!newFileError"
      ></sl-input>
      <div slot="footer">
        <sl-button @click="showNewFileDialog = false">Cancel</sl-button>
        <sl-button
          variant="primary"
          @click="handleCreateFile"
          :disabled="!newFileName"
          >Create</sl-button
        >
      </div>
    </sl-dialog>
  </div>
</template>

<style scoped>
.file-system {
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--sl-color-neutral-200);
  border-radius: var(--sl-border-radius-medium);
  overflow: hidden;
}

sl-dialog::part(footer) {
  display: flex;
  gap: var(--sl-spacing-small);
  justify-content: flex-end;
}
</style>
