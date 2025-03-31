<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useResourceService } from "../composables/useResourceService";

const command = ref("");
const output = ref("");
const isLoading = ref(false);

const resourceService = useResourceService();

async function runCommand() {
  if (!command.value.trim()) {
    return;
  }

  if (!resourceService.getRuntimeEnvironmentManager()) {
    output.value = "Error: Runtime environment not available";
    return;
  }

  isLoading.value = true;
  output.value = "Executing command...";

  try {
    const result = await resourceService
      .getRuntimeEnvironmentManager()!
      .executeCommand(command.value);

    if (!result) {
      output.value = "Error: Runtime environment not available";
      return;
    }

    if (result.success) {
      output.value =
        result.stdout || "Command executed successfully with no output";
    } else {
      output.value = `Error (${result.exitCode}): ${result.stderr || "Unknown error"}`;
    }
  } catch (error) {
    output.value = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="command-executor">
    <h2>Execute Commands</h2>
    <div class="input-container">
      <input
        v-model="command"
        type="text"
        placeholder="Enter command (e.g., node --version)"
        @keyup.enter="runCommand"
        :disabled="isLoading"
      />
      <button @click="runCommand" :disabled="isLoading">Run</button>
    </div>
    <div class="output">
      <h3>Output:</h3>
      <pre :class="{ loading: isLoading }">{{ output }}</pre>
    </div>
  </div>
</template>

<style scoped>
.command-executor {
  padding: 1rem;
  background-color: var(--sl-color-neutral-50);
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.input-container {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid var(--sl-color-neutral-300);
  border-radius: 0.25rem;
}

button {
  padding: 0.5rem 1rem;
  background-color: var(--sl-color-primary-600);
  color: white;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
}

button:hover {
  background-color: var(--sl-color-primary-700);
}

button:disabled {
  background-color: var(--sl-color-neutral-400);
  cursor: not-allowed;
}

.output {
  background-color: var(--sl-color-neutral-900);
  color: var(--sl-color-neutral-100);
  padding: 1rem;
  border-radius: 0.25rem;
  min-height: 100px;
}

pre {
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.loading {
  opacity: 0.7;
}
</style>
