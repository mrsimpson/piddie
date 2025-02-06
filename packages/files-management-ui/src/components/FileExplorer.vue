<script setup lang="ts">
import type { SynchronizedFileSystem } from '../types/file-explorer'
import FileSystem from './FileSystem.vue'

defineProps<{
  systems: SynchronizedFileSystem[]
}>()
</script>

<template>
  <div class="file-explorer">
    <FileSystem v-for="system in systems" :key="system.id" :system="system" />
    <slot name="after-explorer" />
  </div>
</template>

<style scoped>
.file-explorer {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--sl-spacing-medium);
  height: 100%;
}
</style>
