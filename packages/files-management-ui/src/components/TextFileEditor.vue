<script setup lang="ts">
import { ref, watch } from 'vue'
import type { FileSystem } from '@piddie/shared-types'
import { handleUIError } from '../utils/error-handling'

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

async function loadContent() {
  try {
    loading.value = true
    error.value = null
    content.value = await props.fileSystem.readFile(props.filePath)
    isDirty.value = false
  } catch (err) {
    handleUIError(err, 'Failed to load file', 'TextFileEditor')
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
    emit('save')
  } catch (err) {
    handleUIError(err, 'Failed to save file', 'TextFileEditor')
  } finally {
    loading.value = false
  }
}

function handleContentChange(event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  content.value = textarea.value
  isDirty.value = true
}

// Load content when filePath changes
watch(() => props.filePath, loadContent, { immediate: true })
</script>

<template>
  <div class="text-editor">
    <header class="editor-header">
      <h3>{{ filePath }}</h3>
      <div class="toolbar">
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
    </div>
  </div>
</template>

<style scoped>
.text-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
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
  flex: 1;
  padding: var(--sl-spacing-small);
  overflow: hidden;
}

.editor-content sl-textarea {
  height: 100%;
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
</style>
