<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { SyncTarget, TargetState } from '@piddie/shared-types'

const props = defineProps<{
  target: SyncTarget
}>()

const state = ref<TargetState>(props.target.getState())
const updateInterval = ref<number>()

function updateState() {
  state.value = props.target.getState()
}

onMounted(() => {
  updateInterval.value = window.setInterval(updateState, 1000)
})

onUnmounted(() => {
  if (updateInterval.value) {
    clearInterval(updateInterval.value)
  }
})
</script>

<template>
  <div class="sync-target-status">
    <div class="status-indicator" :class="state.status">
      <sl-icon :name="state.status === 'syncing' ? 'arrow-repeat' : 'circle-fill'" />
      {{ state.status }}
    </div>
    <div v-if="state.error" class="error">
      {{ state.error }}
    </div>
    <div v-if="state.pendingChanges > 0" class="pending">
      {{ state.pendingChanges }} changes pending
    </div>
  </div>
</template>

<style scoped>
.sync-target-status {
  padding: var(--sl-spacing-x-small);
  border-radius: var(--sl-border-radius-small);
  background: var(--sl-color-neutral-50);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--sl-spacing-x-small);
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-neutral-700);
}

.status-indicator.syncing {
  color: var(--sl-color-primary-600);
}

.status-indicator.error {
  color: var(--sl-color-danger-600);
}

.error {
  margin-top: var(--sl-spacing-x-small);
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-danger-600);
}

.pending {
  margin-top: var(--sl-spacing-x-small);
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-warning-600);
}
</style>
