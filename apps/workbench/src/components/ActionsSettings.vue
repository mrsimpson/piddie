<script setup lang="ts">
import { ref, onMounted } from "vue";
import { settingsManager } from "@piddie/settings";
import { WorkbenchSettingKey } from "@piddie/settings";
import { ActionsManager } from "@piddie/actions";
import { initializeActionsService } from "../services/actions";

const actionsServerUrl = ref("");
const isConnecting = ref(false);
const connectionStatus = ref<"connected" | "disconnected" | "error">(
  "disconnected"
);
const errorMessage = ref("");

// Load the current actions server URL from settings
onMounted(async () => {
  try {
    const settings = await settingsManager.getWorkbenchSettings();
    actionsServerUrl.value =
      (settings[WorkbenchSettingKey.ACTIONS_SERVER_URL] as string) ||
      "http://localhost:8080";

    // Check current connection status
    const actionsManager = ActionsManager.getInstance();
    const status = actionsManager.getConnectionStatus();
    connectionStatus.value = status.status as
      | "connected"
      | "disconnected"
      | "error";
    errorMessage.value = status.error || "";
  } catch (error) {
    console.error("Error loading actions settings:", error);
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
});

// Save the actions server URL and reconnect
async function saveAndConnect() {
  try {
    isConnecting.value = true;
    errorMessage.value = "";

    // Save the URL to settings
    await settingsManager.updateWorkbenchSetting(
      WorkbenchSettingKey.ACTIONS_SERVER_URL,
      actionsServerUrl.value
    );

    // Disconnect existing connection
    const actionsManager = ActionsManager.getInstance();
    actionsManager.disconnect();

    // Reconnect with new URL
    await initializeActionsService();

    // Update status
    const status = actionsManager.getConnectionStatus();
    connectionStatus.value = status.status as
      | "connected"
      | "disconnected"
      | "error";
    errorMessage.value = status.error || "";
  } catch (error) {
    console.error("Error saving actions settings:", error);
    errorMessage.value = error instanceof Error ? error.message : String(error);
    connectionStatus.value = "error";
  } finally {
    isConnecting.value = false;
  }
}
</script>

<template>
  <div class="actions-settings">
    <h3>Actions Server Settings</h3>

    <div class="form-group">
      <label for="actions-server-url">Actions Server URL</label>
      <div class="input-group">
        <input
          id="actions-server-url"
          v-model="actionsServerUrl"
          type="text"
          placeholder="http://localhost:8080"
        />
        <button @click="saveAndConnect" :disabled="isConnecting">
          {{ isConnecting ? "Connecting..." : "Connect" }}
        </button>
      </div>
    </div>

    <div class="status-indicator">
      <span>Status:</span>
      <span
        class="status-badge"
        :class="{
          connected: connectionStatus === 'connected',
          disconnected: connectionStatus === 'disconnected',
          error: connectionStatus === 'error'
        }"
      >
        {{ connectionStatus }}
      </span>
    </div>

    <div v-if="errorMessage" class="error-message">
      {{ errorMessage }}
    </div>
  </div>
</template>

<style scoped>
.actions-settings {
  padding: 1rem;
}

.form-group {
  margin-bottom: 1rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: bold;
}

.input-group {
  display: flex;
  gap: 0.5rem;
}

input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid var(--sl-color-neutral-300);
  border-radius: 4px;
}

button {
  padding: 0.5rem 1rem;
  background-color: var(--sl-color-primary-600);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:disabled {
  background-color: var(--sl-color-neutral-400);
  cursor: not-allowed;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
}

.status-badge {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.8rem;
  text-transform: uppercase;
}

.status-badge.connected {
  background-color: var(--sl-color-success-100);
  color: var(--sl-color-success-700);
}

.status-badge.disconnected {
  background-color: var(--sl-color-neutral-100);
  color: var(--sl-color-neutral-700);
}

.status-badge.error {
  background-color: var(--sl-color-danger-100);
  color: var(--sl-color-danger-700);
}

.error-message {
  margin-top: 1rem;
  padding: 0.5rem;
  background-color: var(--sl-color-danger-100);
  color: var(--sl-color-danger-700);
  border-radius: 4px;
}
</style>
