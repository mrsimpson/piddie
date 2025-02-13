<script setup lang="ts">
import { ref, watch } from "vue";
import type { FileSyncManager } from "@piddie/files-management";

const props = defineProps<{
  syncManager: FileSyncManager;
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "sl-after-hide"): void;
}>();

const patterns = ref<string[]>([]);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      patterns.value = props.syncManager.getIgnorePatterns();
    }
  }
);
</script>

<template>
  <sl-dialog :open="open" label="Ignore Patterns" @sl-after-hide="emit('sl-after-hide')">
    <div class="patterns-container">
      <div v-if="patterns.length === 0" class="empty-state">No ignore patterns configured</div>
      <ul v-else class="patterns-list">
        <li v-for="pattern in patterns" :key="pattern" class="pattern-item">
          {{ pattern }}
        </li>
      </ul>
    </div>
    <div slot="footer">
      <sl-button @click="emit('sl-after-hide')">Close</sl-button>
    </div>
  </sl-dialog>
</template>

<style scoped>
.patterns-container {
  min-width: 300px;
  max-height: 400px;
  overflow-y: auto;
}

.empty-state {
  text-align: center;
  color: var(--sl-color-neutral-500);
  padding: var(--sl-spacing-large);
}

.patterns-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.pattern-item {
  padding: var(--sl-spacing-small);
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

.pattern-item:last-child {
  border-bottom: none;
}
</style>
