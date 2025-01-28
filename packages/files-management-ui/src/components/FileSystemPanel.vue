<script setup lang="ts">
import type { FileSystem, SyncTarget } from '@piddie/shared-types';
import FileSystemExplorer from './FileSystemExplorer.vue';
import SyncTargetStatus from './SyncTargetStatus.vue';

const props = defineProps<{
  fileSystem: FileSystem;
  syncTarget: SyncTarget;
  title: string;
}>();
</script>

<template>
  <div class="file-system-panel">
    <FileSystemExplorer
      :file-system="fileSystem"
      :title="title"
    />
    <SyncTargetStatus
      :target="syncTarget"
      class="sync-status"
    />
  </div>
</template>

<style scoped>
.file-system-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sync-status {
  margin-top: var(--sl-spacing-small);
}
</style> 