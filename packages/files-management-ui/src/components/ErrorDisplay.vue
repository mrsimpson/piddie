<script setup lang="ts">
import { useErrorStore } from '../stores/error-store'
import { computed } from 'vue'

const errorStore = useErrorStore()

const sortedErrors = computed(() => {
  return [...errorStore.errors.value].sort((a, b) => b.timestamp - a.timestamp)
})

function dismissError(id: string) {
  errorStore.removeError(id)
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}
</script>

<template>
  <div class="error-display" v-if="sortedErrors.length">
    <div v-for="error in sortedErrors" :key="error.id" class="error-item">
      <div class="error-content">
        <div class="error-message">{{ error.message }}</div>
        <div class="error-meta">
          <span class="error-time">{{ formatTime(error.timestamp) }}</span>
          <span v-if="error.componentId" class="error-component">{{ error.componentId }}</span>
        </div>
      </div>
      <sl-button size="small" variant="text" @click="dismissError(error.id)">
        <sl-icon name="x"></sl-icon>
      </sl-button>
    </div>
  </div>
</template>

<style scoped>
.error-display {
  position: fixed;
  bottom: var(--sl-spacing-medium);
  right: var(--sl-spacing-medium);
  max-width: 400px;
  z-index: 1000;
}

.error-item {
  display: flex;
  align-items: flex-start;
  gap: var(--sl-spacing-x-small);
  background: var(--sl-color-danger-50);
  border: 1px solid var(--sl-color-danger-200);
  border-radius: var(--sl-border-radius-medium);
  padding: var(--sl-spacing-small);
  margin-top: var(--sl-spacing-x-small);
}

.error-content {
  flex: 1;
}

.error-message {
  color: var(--sl-color-danger-700);
  font-size: var(--sl-font-size-small);
}

.error-meta {
  display: flex;
  gap: var(--sl-spacing-small);
  margin-top: var(--sl-spacing-x-small);
  font-size: var(--sl-font-size-x-small);
  color: var(--sl-color-danger-600);
}

.error-component {
  font-family: var(--sl-font-mono);
}
</style>
