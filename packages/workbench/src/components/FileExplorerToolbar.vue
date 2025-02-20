<script setup lang="ts">
import { ref } from "vue";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";

const emit = defineEmits<{
  createFile: [path: string];
}>();

const showNewFileDialog = ref(false);
const newFilePath = ref("");

function handleCreateFile() {
  if (!newFilePath.value.trim()) return;
  emit("createFile", newFilePath.value);
  newFilePath.value = "";
  showNewFileDialog.value = false;
}
</script>

<template>
  <div class="toolbar">
    <sl-button size="small" @click="showNewFileDialog = true">
      <sl-icon slot="prefix" name="plus-circle"></sl-icon>
      New File
    </sl-button>

    <sl-dialog
      label="Create New File"
      :open="showNewFileDialog"
      @sl-after-hide="showNewFileDialog = false"
    >
      <sl-input
        v-model="newFilePath"
        label="File Path"
        placeholder="path/to/file.ts"
        @keyup.enter="handleCreateFile"
      />
      <div slot="footer">
        <sl-button @click="showNewFileDialog = false">Cancel</sl-button>
        <sl-button variant="primary" @click="handleCreateFile"
          >Create</sl-button
        >
      </div>
    </sl-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  padding: 0.5rem;
  border-bottom: 1px solid var(--sl-color-neutral-200);
  display: flex;
  gap: 0.5rem;
}
</style>
