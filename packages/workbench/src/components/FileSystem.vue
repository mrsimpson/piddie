<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import type { SynchronizedFileSystem } from "@/types/file-system";
import {
  WATCHER_PRIORITIES,
  type FileSystem,
  type FileSystemItem
} from "@piddie/shared-types";
import FileSystemExplorer from "@/components/FileSystemExplorer.vue";
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

function isValidFileName(name: string): boolean {
  // Check for common invalid characters in filenames
  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
  return name.length > 0 && !invalidChars.test(name);
}

async function loadDirectory(path: string) {
  loading.value = true;
  error.value = null;
  try {
    entries.value = await props.system.fileSystem.listDirectory(path);
    currentPath.value = path;
  } catch (err) {
    error.value = err as Error;
  } finally {
    loading.value = false;
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
  // Initial load
  await loadDirectory("/");

  // Set up watcher
  await props.system.syncTarget.watch(
    async () => loadDirectory(currentPath.value),
    {
      priority: WATCHER_PRIORITIES.UI_UPDATES,
      metadata: {
        registeredBy: "FileSystem.vue"
      }
    }
  );
});

onUnmounted(async () => {
  await props.system.syncTarget.unwatch();
});
</script>

<template>
  <div class="file-system">
    <FileSystemExplorer
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
