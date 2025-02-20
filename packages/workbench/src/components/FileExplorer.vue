<script setup lang="ts">
import { ref, inject, onMounted } from "vue";
import type { FileSyncManager } from "@piddie/files-management";
import type { FileSystemEntry } from "@piddie/shared-types";
import { useFileSystemStore } from "../stores/file-system";
import "@shoelace-style/shoelace/dist/components/tree/tree.js";
import "@shoelace-style/shoelace/dist/components/tree-item/tree-item.js";
import FileExplorerToolbar from "./FileExplorerToolbar.vue";

const syncManager = inject<FileSyncManager>("syncManager");
const fileSystemStore = useFileSystemStore();
const files = ref<FileSystemEntry[]>([]);

async function loadFiles() {
  if (!syncManager || !fileSystemStore.systems.length) return;

  const browserSystem = fileSystemStore.systems[0];
  if (!browserSystem) return;

  files.value = await browserSystem.fileSystem.list("/");
}

async function createFile(path: string) {
  if (!syncManager || !fileSystemStore.systems.length) return;

  const browserSystem = fileSystemStore.systems[0];
  if (!browserSystem) return;

  await browserSystem.fileSystem.writeFile(path, "");
  await loadFiles();
}

function getFileIcon(entry: FileSystemEntry) {
  if (entry.type === "directory") {
    return entry.expanded ? "folder-open" : "folder";
  }
  return "file-earmark-text";
}

async function toggleExpand(entry: FileSystemEntry) {
  if (entry.type !== "directory") return;

  entry.expanded = !entry.expanded;
  if (entry.expanded && !entry.children?.length) {
    if (!syncManager || !fileSystemStore.systems.length) return;
    const browserSystem = fileSystemStore.systems[0];
    if (!browserSystem) return;

    const children = await browserSystem.fileSystem.list(entry.path);
    entry.children = children;
  }
}

onMounted(async () => {
  await loadFiles();
});
</script>

<template>
  <div class="file-explorer-container">
    <FileExplorerToolbar @create-file="createFile" />
    <sl-tree>
      <template v-for="entry in files" :key="entry.path">
        <sl-tree-item :expanded="entry.expanded" @click="toggleExpand(entry)">
          <sl-icon
            slot="expand-icon"
            v-if="entry.type === 'directory'"
            name="folder"
          ></sl-icon>
          <sl-icon
            slot="collapse-icon"
            v-if="entry.type === 'directory'"
            name="folder-open"
          ></sl-icon>
          <sl-icon
            slot="icon"
            v-if="entry.type === 'file'"
            name="file-earmark-text"
          ></sl-icon>
          {{ entry.name }}
          <template v-if="entry.expanded && entry.children?.length">
            <sl-tree-item
              v-for="child in entry.children"
              :key="child.path"
              :expanded="child.expanded"
              @click="toggleExpand(child)"
            >
              <sl-icon
                slot="expand-icon"
                v-if="child.type === 'directory'"
                name="folder"
              ></sl-icon>
              <sl-icon
                slot="collapse-icon"
                v-if="child.type === 'directory'"
                name="folder-open"
              ></sl-icon>
              <sl-icon
                slot="icon"
                v-if="child.type === 'file'"
                name="file-earmark-text"
              ></sl-icon>
              {{ child.name }}
            </sl-tree-item>
          </template>
        </sl-tree-item>
      </template>
    </sl-tree>
  </div>
</template>

<style scoped>
.file-explorer-container {
  height: 100%;
  width: 250px;
  border-right: 1px solid var(--sl-color-neutral-200);
  display: flex;
  flex-direction: column;
}

sl-tree {
  flex: 1;
  overflow: auto;
  padding: 0.5rem;
}

sl-tree-item {
  cursor: pointer;
}
</style>
