<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { FileSystem, SyncTarget, FileChangeInfo } from '@piddie/shared-types'
import type { FileViewModel } from '../types/file-explorer'
import { handleUIError } from '../utils/error-handling'
import TextFileEditor from './TextFileEditor.vue'

const props = defineProps<{
  fileSystem: FileSystem
  syncTarget: SyncTarget
  title: string
}>()

const currentPath = ref('/')

// Expose methods for parent components
defineExpose({
  handleFileChanges,
  loadDirectory,
  currentPath,
})

const items = ref<FileViewModel[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const showNewFileDialog = ref(false)
const showNewFolderDialog = ref(false)
const newItemName = ref('')
const selectedFile = ref<string | null>(null)
const showDeleteConfirmDialog = ref(false)

const sortedItems = computed(() => {
  return [...items.value].sort((a, b) => {
    // Directories first
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }
    // Then alphabetically
    return a.name.localeCompare(b.name)
  })
})

async function loadDirectory(path: string) {
  try {
    loading.value = true
    error.value = null
    currentPath.value = path

    console.log(`Loading directory ${path}...`)
    const entries = await props.fileSystem.listDirectory(path)
    console.log(`Found ${entries.length} entries:`, entries)

    const metadataPromises = entries.map(async (entry) => {
      try {
        return await props.fileSystem.getMetadata(entry.path)
      } catch (err) {
        console.error(`Failed to get metadata for ${entry.path}:`, err)
        throw err
      }
    })

    const metadata = await Promise.all(metadataPromises)
    console.log(`Got metadata for ${metadata.length} entries:`, metadata)

    items.value = entries.map((entry, index) => {
      const meta = metadata[index]
      if (!meta) {
        console.error(`No metadata for ${entry.path}`)
        throw new Error(`No metadata for ${entry.path}`)
      }

      return {
        path: entry.path,
        name: entry.path.split('/').pop() || '',
        isDirectory: entry.type === 'directory',
        size: meta.size,
        lastModified: meta.lastModified,
        metadata: meta,
        selected: false,
      }
    })
  } catch (err) {
    console.error(`Failed to load directory ${path}:`, err)
    error.value = err instanceof Error ? err.message : 'Failed to load directory'
    handleUIError(err, `Failed to load directory ${path}`, COMPONENT_ID)
  } finally {
    loading.value = false
  }
}

async function navigateUp() {
  const parentPath =
    currentPath.value === '/' ? '/' : currentPath.value.split('/').slice(0, -1).join('/') || '/'
  await loadDirectory(parentPath)
}

async function navigateTo(path: string) {
  await loadDirectory(path)
}

const COMPONENT_ID = 'FileSystemExplorer'
async function createNewFile() {
  if (!newItemName.value) return

  try {
    error.value = null
    if (await props.fileSystem.exists(newItemName.value)) {
      handleUIError(`File already exists: ${newItemName.value}`, COMPONENT_ID)
    }
    const filePath = `${currentPath.value}/${newItemName.value}`.replace(/\/+/g, '/')
    await props.fileSystem.writeFile(filePath, '')
    await loadDirectory(currentPath.value)
    showNewFileDialog.value = false
    newItemName.value = ''
  } catch (err) {
    handleUIError(err, 'Failed to create file', COMPONENT_ID)
  }
}

async function createNewFolder() {
  if (!newItemName.value) return

  try {
    error.value = null
    const folderPath = `${currentPath.value}/${newItemName.value}`.replace(/\/+/g, '/')
    await props.fileSystem.createDirectory(folderPath)
    await loadDirectory(currentPath.value)
    showNewFolderDialog.value = false
    newItemName.value = ''
  } catch (err) {
    handleUIError(err, 'Failed to create folder', COMPONENT_ID)
  }
}

async function deleteSelectedFile() {
  if (!selectedFile.value) return

  try {
    error.value = null
    await props.fileSystem.deleteItem(selectedFile.value)
    await loadDirectory(currentPath.value)
    selectedFile.value = null
    showDeleteConfirmDialog.value = false
  } catch (err) {
    handleUIError(err, 'Failed to delete file', COMPONENT_ID)
  }
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

// Handle file changes from sync target
async function handleFileChanges(changes: FileChangeInfo[]) {
  console.log('FileSystemExplorer: Handling changes:', changes)
  const currentDir = currentPath.value

  // Check if the current directory itself was deleted
  const currentDirDeleted = changes.some(
    (change) =>
      change.type === 'delete' &&
      (change.path === currentDir || currentDir.startsWith(change.path + '/')),
  )

  if (currentDirDeleted) {
    console.log('FileSystemExplorer: Current directory was deleted, navigating up')
    // Navigate up if current directory was deleted
    await navigateUp()
    return
  }

  // Check if any of the changes affect the current directory
  const hasChangesInCurrentDir = changes.some((change) => {
    const parentDir = change.path.split('/').slice(0, -1).join('/') || '/'
    return parentDir === currentDir
  })

  if (hasChangesInCurrentDir) {
    console.log('FileSystemExplorer: Changes affect current directory, reloading')
    await loadDirectory(currentDir)
  } else {
    console.log('FileSystemExplorer: Changes do not affect current directory')
  }
}

// Set up and clean up file change watching
onMounted(async () => {
  try {
    console.log('FileSystemExplorer mounted, initializing...')
    await loadDirectory('/')
    console.log('Initial directory loaded')
  } catch (err) {
    console.error('Failed to initialize FileSystemExplorer:', err)
    error.value = err instanceof Error ? err.message : 'Failed to initialize file explorer'
    handleUIError(err, 'Failed to initialize file explorer', COMPONENT_ID)
  }
})

onUnmounted(async () => {
  try {
    console.log('FileSystemExplorer unmounting, cleaning up...')
  } catch (err) {
    console.error('Error during cleanup:', err)
  }
})
</script>

<template>
  <div class="file-system-explorer">
    <header class="panel-header">
      <div class="toolbar">
        <sl-button size="small" @click="navigateUp">
          <sl-icon name="arrow-up"></sl-icon>
        </sl-button>
        <sl-input size="small" :value="currentPath" readonly></sl-input>
        <sl-button size="small" @click="showNewFileDialog = true">
          <sl-icon name="file-earmark-plus"></sl-icon>
          New File
        </sl-button>
        <sl-button size="small" @click="showNewFolderDialog = true">
          <sl-icon name="folder-plus"></sl-icon>
          New Folder
        </sl-button>
        <sl-button
          size="small"
          variant="danger"
          :disabled="!selectedFile"
          @click="showDeleteConfirmDialog = true"
        >
          <sl-icon name="trash"></sl-icon>
          Delete
        </sl-button>
      </div>
    </header>

    <div v-if="error" class="error-message">
      {{ error }}
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
        @click="item.isDirectory ? navigateTo(item.path) : (selectedFile = item.path)"
      >
        <sl-icon :name="item.isDirectory ? 'folder' : 'file-earmark'"></sl-icon>
        <span class="name">{{ item.name }}</span>
        <span class="size">{{ formatSize(item.size) }}</span>
        <span class="date">{{ formatDate(item.lastModified) }}</span>
      </div>
    </div>

    <div v-if="selectedFile" class="editor-panel">
      <TextFileEditor
        :file-path="selectedFile"
        :file-system="fileSystem"
        @close="selectedFile = null"
        @save="loadDirectory(currentPath)"
      />
    </div>

    <!-- New File Dialog -->
    <sl-dialog
      label="Create New File"
      :open="showNewFileDialog"
      @sl-hide="showNewFileDialog = false"
    >
      <sl-input label="File Name" v-model="newItemName" @keyup.enter="createNewFile"></sl-input>
      <div slot="footer">
        <sl-button @click="showNewFileDialog = false">Cancel</sl-button>
        <sl-button variant="primary" @click="createNewFile">Create</sl-button>
      </div>
    </sl-dialog>

    <!-- New Folder Dialog -->
    <sl-dialog
      label="Create New Folder"
      :open="showNewFolderDialog"
      @sl-hide="showNewFolderDialog = false"
    >
      <sl-input label="Folder Name" v-model="newItemName" @keyup.enter="createNewFolder"></sl-input>
      <div slot="footer">
        <sl-button @click="showNewFolderDialog = false">Cancel</sl-button>
        <sl-button variant="primary" @click="createNewFolder">Create</sl-button>
      </div>
    </sl-dialog>

    <!-- Delete Confirmation Dialog -->
    <sl-dialog
      label="Confirm Delete"
      :open="showDeleteConfirmDialog"
      @sl-hide="showDeleteConfirmDialog = false"
    >
      <p>Are you sure you want to delete "{{ selectedFile }}"?</p>
      <p class="warning">This action cannot be undone.</p>
      <div slot="footer">
        <sl-button @click="showDeleteConfirmDialog = false">Cancel</sl-button>
        <sl-button variant="danger" @click="deleteSelectedFile">Delete</sl-button>
      </div>
    </sl-dialog>
  </div>
</template>

<style scoped>
.file-system-explorer {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: 300px 1fr;
  grid-template-areas:
    'header header'
    'list editor';
  border: 1px solid var(--sl-color-neutral-200);
  border-radius: var(--sl-border-radius-medium);
}

.panel-header {
  grid-area: header;
  padding: var(--sl-spacing-small);
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

.panel-header h2 {
  margin: 0 0 var(--sl-spacing-x-small);
  font-size: var(--sl-font-size-large);
}

.toolbar {
  display: flex;
  gap: var(--sl-spacing-x-small);
  align-items: center;
}

.toolbar sl-input {
  flex: 1;
}

.file-list {
  grid-area: list;
  border-right: 1px solid var(--sl-color-neutral-200);
  flex: 1;
  overflow-y: auto;
  padding: var(--sl-spacing-x-small);
}

.file-item {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: var(--sl-spacing-small);
  padding: var(--sl-spacing-x-small);
  align-items: center;
  cursor: pointer;
  border-radius: var(--sl-border-radius-small);
}

.file-item:hover {
  background: var(--sl-color-neutral-100);
}

.file-item .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-item .size,
.file-item .date {
  color: var(--sl-color-neutral-600);
  font-size: var(--sl-font-size-small);
}

.loading,
.error-message {
  padding: var(--sl-spacing-large);
  text-align: center;
  color: var(--sl-color-neutral-600);
}

.error-message {
  color: var(--sl-color-danger-600);
}

.editor-panel {
  grid-area: editor;
  padding: var(--sl-spacing-small);
  overflow: hidden;
}

sl-dialog::part(footer) {
  display: flex;
  gap: var(--sl-spacing-small);
  justify-content: flex-end;
}

.warning {
  color: var(--sl-color-danger-600);
  margin-top: var(--sl-spacing-small);
  font-size: var(--sl-font-size-small);
}
</style>
