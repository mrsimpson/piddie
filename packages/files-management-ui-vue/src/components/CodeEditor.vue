<script setup lang="ts">
import { ref, onMounted, watch, defineProps, defineEmits, computed } from "vue";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { storeToRefs } from "pinia";
import { useFileSystemStore } from "../stores/file-system";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";

const props = defineProps<{
  theme?: "light" | "dark";
}>();

const fileSystemStore = useFileSystemStore();
const { selectedFile } = storeToRefs(fileSystemStore);

// Local refs
const editorRef = ref<HTMLDivElement | null>(null);
const editorView = ref<EditorView | null>(null);
const content = ref("");
const originalContent = ref("");
const isDirty = computed(() => content.value !== originalContent.value);

// Custom keyboard shortcuts
const saveKeymap = keymap.of([
  {
    key: "Mod-s",
    run: () => {
      if (selectedFile.value && isDirty.value) {
        handleSave();
      }
      return true;
    }
  }
]);

// Extensions for the editor
const getExtensions = (): Extension[] => {
  const baseExtensions = [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    saveKeymap,
    javascript({ jsx: true, typescript: true }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        content.value = update.state.doc.toString();
      }
    })
  ];

  // Add theme extension if dark mode
  if (props.theme === "dark") {
    baseExtensions.push(oneDark);
  }

  return baseExtensions;
};

// Create the editor
function createEditor(initialContent: string) {
  if (!editorRef.value) return;

  // Destroy previous instance if exists
  if (editorView.value) {
    editorView.value.destroy();
  }

  const startState = EditorState.create({
    doc: initialContent,
    extensions: getExtensions()
  });

  // Create editor view
  editorView.value = new EditorView({
    state: startState,
    parent: editorRef.value
  });

  // Store initial content
  content.value = initialContent;
  originalContent.value = initialContent;
}

// Update content when selected file changes
watch(
  () => selectedFile.value?.content,
  (newContent) => {
    if (newContent !== undefined) {
      if (editorView.value) {
        // Update the editor content
        const currentContent = editorView.value.state.doc.toString();
        if (currentContent !== newContent) {
          editorView.value.dispatch({
            changes: {
              from: 0,
              to: currentContent.length,
              insert: newContent
            }
          });
        }
      } else {
        // Create editor if it doesn't exist
        createEditor(newContent);
      }
      content.value = newContent;
      originalContent.value = newContent; // Reset original content when file changes
    } else {
      // Clear editor if no file selected
      if (editorView.value) {
        editorView.value.dispatch({
          changes: {
            from: 0,
            to: editorView.value.state.doc.length,
            insert: ""
          }
        });
      } else {
        createEditor("");
      }
      content.value = "";
      originalContent.value = "";
    }
  },
  { immediate: true }
);

// Handle theme changes
watch(
  () => props.theme,
  () => {
    // Recreate editor with new theme
    if (editorView.value) {
      const currentContent = editorView.value.state.doc.toString();
      createEditor(currentContent);
    }
  }
);

// Save file content
const handleSave = async () => {
  if (selectedFile.value && isDirty.value) {
    try {
      await fileSystemStore.saveSelectedFile(content.value);
      console.log("File saved:", selectedFile.value.path);
      originalContent.value = content.value; // Update original content after save
    } catch (error) {
      console.error("Failed to save file:", error);
    }
  }
};

// Clean up on unmount
onMounted(() => {
  if (selectedFile.value?.content) {
    createEditor(selectedFile.value.content);
  } else {
    createEditor("");
  }
});

defineExpose({
  save: handleSave,
  getContent: () => content.value,
  isDirty: () => isDirty.value
});
</script>

<template>
  <div class="editor-container">
    <div class="editor-header" v-if="selectedFile">
      <div class="header-actions">
        <button
          class="save-button"
          @click="handleSave"
          :disabled="!isDirty"
          :title="isDirty ? 'Save file (Ctrl+S)' : 'No changes to save'"
          :class="{ 'button-disabled': !isDirty }"
        >
          <sl-icon name="save"></sl-icon>
        </button>
      </div>
      <div class="file-path" :class="{ dirty: isDirty }">
        {{ selectedFile.path }}
      </div>
    </div>
    <div ref="editorRef" class="editor-content"></div>
    <div v-if="!selectedFile" class="no-file-message">
      Select a file to edit
    </div>
  </div>
</template>

<style scoped>
.editor-container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--sl-color-neutral-0);
  border: 1px solid var(--sl-color-neutral-200);
}

.editor-header {
  display: flex;
  align-items: center;
  padding: 0.5rem;
  border-bottom: 1px solid var(--sl-color-neutral-200);
  background: var(--sl-color-neutral-50);
}

.header-actions {
  display: flex;
  align-items: center;
  margin-right: 0.5rem;
}

.file-path {
  font-family: var(--sl-font-mono);
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-neutral-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.file-path.dirty::after {
  content: " •";
  color: var(--sl-color-primary-600);
  font-weight: bold;
}

.save-button {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--sl-color-neutral-600);
  border-radius: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.save-button:hover:not(:disabled) {
  background: var(--sl-color-primary-100);
  color: var(--sl-color-primary-600);
}

.save-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.button-disabled {
  pointer-events: none;
}

.editor-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.no-file-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--sl-color-neutral-400);
  font-style: italic;
}

/* CodeMirror customizations */
:deep(.cm-editor) {
  height: 100%;
  width: 100%;
}

:deep(.cm-scroller) {
  overflow: auto;
  font-family: monospace;
  line-height: 1.5;
  font-size: 14px;
}
</style>
