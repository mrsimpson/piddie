<script setup lang="ts">
import { ref, provide, inject, onMounted } from "vue";
import { CollapsiblePanel } from "@piddie/common-ui-vue";
import { CommandTerminal } from "@piddie/webcontainer-ui";
import type { RuntimeEnvironmentManager as WebcontainerRuntimeManager } from "@piddie/webcontainer-ui";
import type { WebContainerProcess, WebContainer } from "@webcontainer/api";
import type { RuntimeEnvironmentManager } from "@piddie/runtime-environment";
import type { Ref } from "vue";
import "@piddie/webcontainer-ui/style";

const props = defineProps<{
  initialCollapsed?: boolean;
}>();

const emit = defineEmits<{
  collapse: [isCollapsed: boolean];
}>();

// Directly inject the runtime manager from the app context
const appRuntimeManager = inject<Ref<RuntimeEnvironmentManager | null>>(
  "runtimeManager",
  ref(null)
);

const webContainer = inject<Ref<WebContainer | null>>(
  "webContainer",
  ref(null)
);

const terminalReady = ref(false);
const error = ref<Error | null>(null);

// Display status message for debugging
const statusMessage = ref("Initializing terminal...");

onMounted(() => {
  console.log(
    "RuntimePanel mounted, runtime manager:",
    appRuntimeManager?.value,
    "ready:",
    appRuntimeManager?.value?.isReady?.()
  );

  if (appRuntimeManager?.value && appRuntimeManager.value.isReady()) {
    statusMessage.value = "Runtime manager available and ready!";
    terminalReady.value = true;
  } else if (appRuntimeManager?.value) {
    statusMessage.value =
      "Runtime manager available but not ready. Initializing...";

    // Try to initialize it if it exists but isn't ready
    if (appRuntimeManager.value.initialize) {
      appRuntimeManager.value
        .initialize()
        .then(() => {
          statusMessage.value = "Runtime manager initialized successfully!";
          terminalReady.value = true;
        })
        .catch((err) => {
          statusMessage.value =
            "Failed to initialize runtime manager: " + err.message;
          error.value = err;
        });
    }
  } else {
    statusMessage.value = "Waiting for runtime manager to initialize...";

    // Set a timeout to check again after a few seconds
    setTimeout(() => {
      console.log(
        "Checking runtime manager again:",
        appRuntimeManager?.value,
        "ready:",
        appRuntimeManager?.value?.isReady?.()
      );

      if (appRuntimeManager?.value && appRuntimeManager.value.isReady()) {
        statusMessage.value = "Runtime manager initialized!";
        terminalReady.value = true;
      } else if (appRuntimeManager?.value) {
        statusMessage.value =
          "Runtime manager available but not ready. Trying to initialize...";

        // Try to initialize it if it exists but isn't ready
        if (appRuntimeManager.value.initialize) {
          appRuntimeManager.value
            .initialize()
            .then(() => {
              statusMessage.value = "Runtime manager initialized successfully!";
              terminalReady.value = true;
            })
            .catch((err) => {
              statusMessage.value =
                "Failed to initialize runtime manager: " + err.message;
              error.value = err;
            });
        }
      } else {
        statusMessage.value =
          "Runtime manager initialization timeout. Please refresh the page.";
        error.value = new Error("Runtime manager not available after timeout");
      }
    }, 5000);
  }
});

// Create a runtime manager adapter that matches the expected interface
provide("runtimeManager", {
  container: webContainer?.value,
  async executeCommand(
    command: string,
    cwd?: string
  ): Promise<WebContainerProcess> {
    if (!appRuntimeManager?.value) {
      throw new Error("Runtime manager not available");
    }

    try {
      console.log(
        `Executing command: "${command}" in directory: "${cwd || "/"}"`
      );

      // Execute the command using the runtime manager
      const processResult = await appRuntimeManager.value.executeCommand(
        command,
        {
          cwd
        }
      );

      console.log("Command result:", processResult);

      if (!processResult) {
        throw new Error("Failed to execute command");
      }

      // Since we need to return a WebContainerProcess but we have a CommandResult,
      // we'll create a minimal implementation that works with CommandTerminal
      return {
        exit: Promise.resolve(processResult.exitCode || 0),
        output: new ReadableStream({
          start(controller) {
            if (processResult.stdout) {
              controller.enqueue(processResult.stdout);
            }
            if (processResult.stderr) {
              controller.enqueue(processResult.stderr);
            }
            controller.close();
          }
        }),
        write: async (input: string) => {
          console.log("Terminal input not supported:", input);
          // Not supported in our current implementation
        }
      } as unknown as WebContainerProcess;
    } catch (err) {
      console.error("Error executing command:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Return a process with an error message
      return {
        exit: Promise.resolve(1),
        output: new ReadableStream({
          start(controller) {
            controller.enqueue(`Error: ${errorMsg}\n`);
            controller.close();
          }
        }),
        write: async (input: string) => {
          console.log("Terminal input not supported in error state:", input);
          // Not supported in our current implementation
        }
      } as unknown as WebContainerProcess;
    }
  },
  async getWorkingDirectory(): Promise<string> {
    // If we can't get a working directory, default to root
    return "/";
  },
  async setWorkingDirectory(path: string): Promise<void> {
    // No direct method to set working directory in the current interface
    if (appRuntimeManager?.value) {
      // Try to change directory using a cd command
      try {
        await appRuntimeManager.value.executeCommand(`cd ${path}`, {});
      } catch (err) {
        console.error("Error changing directory:", err);
      }
    }
  }
} as WebcontainerRuntimeManager);

// Handle panel collapse
function handleCollapse(isCollapsed: boolean) {
  emit("collapse", isCollapsed);
}
</script>

<template>
  <CollapsiblePanel
    title="Runtime"
    expand-icon="terminal"
    direction="right"
    :initial-collapsed="props.initialCollapsed"
    @collapse="handleCollapse"
  >
    <template #content>
      <div class="runtime-content">
        <div v-if="error" class="error-message">
          <h3>Error</h3>
          <p>{{ error.message }}</p>
          <p>Please refresh the page to try again.</p>
        </div>
        <div v-else-if="!terminalReady" class="loading-message">
          <p>{{ statusMessage }}</p>
        </div>
        <CommandTerminal v-else :isVisible="true" />
      </div>
    </template>
  </CollapsiblePanel>
</template>

<style scoped>
.runtime-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  width: 100%;
  background-color: var(--sl-color-neutral-0);
  border-radius: var(--sl-border-radius-medium);
}

.loading-message,
.error-message,
.no-runtime-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 1rem;
  text-align: center;
}

.loading-message {
  color: var(--sl-color-primary-600);
}

.error-message {
  color: var(--sl-color-danger-600);
}

.no-runtime-message {
  color: var(--sl-color-neutral-700);
  font-style: italic;
}

/* Override terminal height to fill the panel */
:deep(.terminal-tabs-container) {
  height: 100% !important;
  border-top: none !important;
  border-radius: var(--sl-border-radius-medium);
  overflow: hidden;
}

:deep(.terminal-tabs-header) {
  background-color: var(--sl-color-neutral-100);
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

:deep(.terminal-tabs-content) {
  background-color: var(--sl-color-neutral-0);
}

:deep(.terminal-container) {
  padding: 0.5rem;
}
</style>
