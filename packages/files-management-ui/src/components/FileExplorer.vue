<script setup lang="ts">
import type { SynchronizedFileSystem } from '../types/file-explorer'
import FileSystemPanel from './FileSystemPanel.vue'

const props = defineProps<{
  systems: SynchronizedFileSystem[]
}>()
</script>

<template>
  <div class="file-explorer">
    <FileSystemPanel
      v-for="system in systems"
      :key="system.id"
      :file-system="system.fileSystem"
      :sync-target="system.syncTarget"
      :title="system.title"
    />
  </div>
</template>

<style scoped>
.file-explorer {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--sl-spacing-medium);
  height: 100%;
  padding: var(--sl-spacing-medium);
}
</style>
