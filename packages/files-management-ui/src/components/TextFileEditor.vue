<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { FileSystem, FileChangeInfo } from '@piddie/shared-types'
import { BrowserSyncTarget, BrowserNativeSyncTarget, BrowserNativeFileSystem } from '@piddie/files-management'
import { WATCHER_PRIORITIES } from '@piddie/shared-types'
import { handleUIError } from '../utils/error-handling'

const COMPONENT_ID = 'TextFileEditor'

const props = defineProps<{
  filePath: string
  fileSystem: FileSystem
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save'): void
}>()

const content = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const isDirty = ref(false)
const uiSyncTarget = ref<BrowserSyncTarget | BrowserNativeSyncTarget | null>(null)
const hasExternalChanges = ref(false)

async function loadContent() {
  try {
    loading.value = true
    error.value = null
    content.value = await props.fileSystem.readFile(props.filePath)
    isDirty.value = false
    hasExternalChanges.value = false
  } catch (err) {
    handleUIError(err, 'Failed to load file', COMPONENT_ID)
  } finally {
    loading.value = false
  }
}

async function saveContent() {
  try {
    loading.value = true
    error.value = null
    await props.fileSystem.writeFile(props.filePath, content.value)
    isDirty.value = false
    hasExternalChanges.value = false
    emit('save')
  } catch (err) {
    handleUIError(err, 'Failed to save file', COMPONENT_ID)
  } finally {
    loading.value = false
  }
}

function handleContentChange(event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  content.value = textarea.value
  isDirty.value = true
}

// Initialize UI sync target for file changes
async function initializeFileWatcher() {
  try {
    // Create UI sync target matching the filesystem type
    const isNativeFs = props.fileSystem instanceof BrowserNativeFileSystem
    uiSyncTarget.value = isNativeFs
      ? new BrowserNativeSyncTarget(`editor-${props.filePath}`)
      : new BrowserSyncTarget(`editor-${props.filePath}`)

    // Initialize with the same filesystem
    await uiSyncTarget.value.initialize(props.fileSystem, false)
    
    // Watch for changes on the same filesystem
    await uiSyncTarget.value.watch(
      async (changes: FileChangeInfo[]) => {
        // Check if our file was changed
        const fileChanged = changes.some(change => change.path === props.filePath)
        if (fileChanged) {
          console.log(`File ${props.filePath} changed externally`)
          // Get the latest content from the filesystem
          const currentContent = await props.fileSystem.readFile(props.filePath)
          // Only mark as changed if content actually differs
          if (currentContent !== content.value) {
            if (isDirty.value) {
              // If we have unsaved changes, just mark that there are external changes
              hasExternalChanges.value = true
            } else {
              // If no unsaved changes, reload the content
              await loadContent()
            }
          }
        }
      },
      {
        priority: WATCHER_PRIORITIES.UI_UPDATES,
        metadata: {
          registeredBy: COMPONENT_ID,
          type: 'editor-watcher',
          filePath: props.filePath
        }
      }
    )
  } catch (err) {
    console.error('Failed to initialize file watcher:', err)
    handleUIError(err, 'Failed to initialize file watcher', COMPONENT_ID)
  }
}

// Clean up watcher
async function cleanupFileWatcher() {
  if (uiSyncTarget.value) {
    try {
      await uiSyncTarget.value.unwatch()
      uiSyncTarget.value = null
    } catch (err) {
      console.error('Error cleaning up file watcher:', err)
    }
  }
}

// Load content when filePath changes
watch(() => props.filePath, async () => {
  await loadContent()
  // Reinitialize watcher for new file
  await cleanupFileWatcher()
  await initializeFileWatcher()
}, { immediate: true })

// Component lifecycle
onMounted(initializeFileWatcher)
onBeforeUnmount(cleanupFileWatcher)

async function handleReload() {
  await loadContent()
}
</script>

<template>
  <div class="text-editor">
    <header class="editor-header">
      <h3>{{ filePath }}</h3>
      <div class="toolbar">
        <sl-button 
          v-if="hasExternalChanges" 
          size="small" 
          variant="warning"
          @click="handleReload"
        >
          <sl-icon name="arrow-clockwise"></sl-icon>
          Reload
        </sl-button>
        <sl-button size="small" :disabled="!isDirty" @click="saveContent">
          <sl-icon name="save"></sl-icon>
          Save
        </sl-button>
        <sl-button size="small" @click="emit('close')">
          <sl-icon name="x"></sl-icon>
          Close
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

    <div v-else class="editor-content">
      <sl-textarea
        :value="content"
        @input="handleContentChange"
        resize="auto"
        rows="20"
      ></sl-textarea>
      <div v-if="hasExternalChanges" class="external-changes-warning">
        <sl-alert variant="warning" open>
          <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
          This file has been modified externally. Click 'Reload' to load the latest version (your changes will be lost).
        </sl-alert>
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-editor {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--sl-color-neutral-200);
  border-radius: var(--sl-border-radius-medium);
}

.editor-header {
  padding: var(--sl-spacing-small);
  border-bottom: 1px solid var(--sl-color-neutral-200);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.editor-header h3 {
  margin: 0;
  font-size: var(--sl-font-size-medium);
}

.toolbar {
  display: flex;
  gap: var(--sl-spacing-x-small);
}

.editor-content {
  position: relative;
  flex: 1;
  padding: var(--sl-spacing-small);
  overflow: hidden;
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

.external-changes-warning {
  position: absolute;
  bottom: var(--sl-spacing-medium);
  left: var(--sl-spacing-medium);
  right: var(--sl-spacing-medium);
}
</style>
