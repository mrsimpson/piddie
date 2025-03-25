<script setup lang="ts">
import type { SynchronizedFileSystem } from "../types/file-system";
import SyncTargetStatus from "./SyncTargetStatus.vue";
import "@shoelace-style/shoelace/dist/components/select/select.js";
import "@shoelace-style/shoelace/dist/components/option/option.js";
import { watch } from "vue";

const props = defineProps<{
  systems: SynchronizedFileSystem[];
  selectedSystem: SynchronizedFileSystem | null;
}>();

const emit = defineEmits<{
  (e: "select", system: SynchronizedFileSystem): void;
}>();

// Watch for changes in systems and select browser system if available
watch(
  () => props.systems,
  (newSystems) => {
    if (
      !props.selectedSystem ||
      (props.selectedSystem.id !== "browser" &&
        newSystems.some((s) => s.id === "browser"))
    ) {
      const browserSystem = newSystems.find((s) => s.id === "browser");
      if (browserSystem) {
        emit("select", browserSystem);
      }
    }
  }
);

function handleSelect(event: Event) {
  const select = event.target as HTMLSelectElement & { value: string };
  const selectedId = select.value;
  const system = props.systems.find((s) => s.id === selectedId);
  if (system) {
    emit("select", system);
  }
}
</script>

<template>
  <div class="sync-target-selector">
    <sl-select :value="selectedSystem?.id" @sl-change="handleSelect">
      <sl-option v-for="system in systems" :key="system.id" :value="system.id">
        <div class="system-option">
          <span>{{ system.title }}</span>
          <SyncTargetStatus :target="system.syncTarget" />
        </div>
      </sl-option>
    </sl-select>
  </div>
</template>

<style scoped>
.sync-target-selector {
  width: 100%;
}

.system-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sl-spacing-small);
}
</style>
