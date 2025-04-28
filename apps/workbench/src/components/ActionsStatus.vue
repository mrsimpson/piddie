<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { ActionsManager } from "@piddie/actions";

const connectionStatus = ref<"connected" | "disconnected" | "error">(
  "disconnected"
);
const errorMessage = ref<string | null>(null);
const actionsManager = ActionsManager.getInstance();

// Update the connection status
function updateStatus() {
  const status = actionsManager.getConnectionStatus();
  connectionStatus.value = status.status as
    | "connected"
    | "disconnected"
    | "error";
  errorMessage.value = status.error;
}

// Set up an interval to periodically check connection status
let statusInterval: number | null = null;

onMounted(() => {
  // Check status immediately
  updateStatus();

  // Then check every 5 seconds
  statusInterval = window.setInterval(updateStatus, 5000);
});

onUnmounted(() => {
  if (statusInterval !== null) {
    window.clearInterval(statusInterval);
  }
});
</script>

<template>
  <div class="actions-status">
    <div class="status-indicator">
      <span
        class="status-badge"
        :class="{
          connected: connectionStatus === 'connected',
          disconnected: connectionStatus === 'disconnected',
          error: connectionStatus === 'error'
        }"
        :title="errorMessage || ''"
      >
        <span class="status-dot"></span>
        <span class="status-label">Actions</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.actions-status {
  display: inline-flex;
  align-items: center;
}

.status-indicator {
  display: flex;
  align-items: center;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 0.75rem;
  cursor: help;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-badge.connected {
  background-color: var(--sl-color-success-100);
}

.status-badge.connected .status-dot {
  background-color: var(--sl-color-success-600);
}

.status-badge.disconnected {
  background-color: var(--sl-color-neutral-100);
}

.status-badge.disconnected .status-dot {
  background-color: var(--sl-color-neutral-600);
}

.status-badge.error {
  background-color: var(--sl-color-danger-100);
}

.status-badge.error .status-dot {
  background-color: var(--sl-color-danger-600);
}
</style>
