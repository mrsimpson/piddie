<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, provide } from "vue";
import type { SynchronizedFileSystem } from "../types/file-explorer";
import type { SyncTarget } from "@piddie/shared-types";
import { createSynchronizedFileSystem } from "../types/file-explorer";
import {
  FileSyncManager,
  BrowserFileSystem,
  BrowserNativeFileSystem,
  BrowserSyncTarget,
  BrowserNativeSyncTarget,
  WebContainerFileSystem,
  WebContainerSyncTarget
} from "@piddie/files-management";
import { WATCHER_PRIORITIES } from "@piddie/shared-types";
import { WebContainer } from "@webcontainer/api";
import FileExplorer from "../components/FileExplorer.vue";
import ErrorDisplay from "../components/ErrorDisplay.vue";
import { handleUIError } from "../utils/error-handling";
import SyncProgress from "../components/SyncProgress.vue";
import IgnorePatternsModal from "../components/IgnorePatternsModal.vue";

const COMPONENT_ID = "DemoApp";
const systems = ref<SynchronizedFileSystem[]>([]);
const syncManager = new FileSyncManager();
const showIgnorePatterns = ref(false);

// Helper functions to check which systems are already added
function hasNativeSystem(): boolean {
  return systems.value.some((sys) => sys.syncTarget instanceof BrowserNativeSyncTarget);
}

function hasWebContainerSystem(): boolean {
  return systems.value.some((sys) => sys.syncTarget instanceof WebContainerSyncTarget);
}

// Monitor sync status
function monitorSync() {
  if (!syncManager) return;

  const status = syncManager.getStatus();
  const pendingSync = syncManager.getPendingSync();

  if (status.currentFailure) {
    handleUIError(
      status.currentFailure.error,
      `Sync failed for target ${status.currentFailure.targetId}`,
      COMPONENT_ID
    );
  }

  if (pendingSync) {
    console.log("Pending sync:", {
      sourceTarget: pendingSync.sourceTargetId,
      pendingTargets: Array.from(pendingSync.pendingByTarget.keys())
    });
  }
}

async function initializeBrowserSystem() {
  try {
    // Create and initialize browser file system
    const browserFs = new BrowserFileSystem({
      name: "demo-browser",
      rootDir: "/"
    });
    await browserFs.initialize();

    // Create and initialize browser sync target
    const browserTarget = new BrowserSyncTarget("browser");
    await browserTarget.initialize(browserFs, true, {
      skipFileScan: false,
      resolutionFunctions: {
        resolveFromPrimary: () => syncManager.fullSyncFromPrimaryToTarget(browserTarget)
      }
    });

    // Create synchronized system
    const browserSystem = await createSynchronizedFileSystem({
      id: "browser",
      title: "Browser Storage",
      fileSystem: browserFs,
      syncTarget: browserTarget,
      watcherOptions: {
        priority: WATCHER_PRIORITIES.UI_UPDATES,
        metadata: {
          registeredBy: "DemoApp",
          type: "ui-explorer"
        }
      }
    });

    systems.value = [browserSystem];
  } catch (err) {
    handleUIError(err, "Failed to initialize browser system", COMPONENT_ID);
  }
}

async function addNativeSystem() {
  try {
    // Request directory with readwrite permissions
    const dirHandle = await window.showDirectoryPicker({
      mode: "readwrite"
    });

    // Create and initialize native file system
    const nativeFs = new BrowserNativeFileSystem({
      //@ts-expect-error - there are two properties require by the FileSystemDirectoryHandle interface which are not returned from the window.showDirectoryPicker
      rootHandle: dirHandle
    });
    await nativeFs.initialize();

    // Create and initialize native sync target
    const nativeTarget = new BrowserNativeSyncTarget("native");

    try {
      await nativeTarget.initialize(nativeFs, false, {
        skipFileScan: false,
        resolutionFunctions: {
          resolveFromPrimary: () => syncManager.fullSyncFromPrimaryToTarget(nativeTarget)
        }
      });
    } catch (initError) {
      // Log the error but continue - we'll show the error state in the UI
      console.warn("Native target initialization resulted in error state:", initError);
    }

    // Create synchronized system
    const nativeSystem = await createSynchronizedFileSystem({
      id: "native",
      title: "Local Files",
      fileSystem: nativeFs,
      syncTarget: nativeTarget,
      watcherOptions: {
        priority: WATCHER_PRIORITIES.UI_UPDATES,
        metadata: {
          registeredBy: "DemoApp",
          type: "ui-explorer"
        }
      }
    });

    // Initialize sync manager first if not the first system
    if (systems.value.length >= 1) {
      try {
        await initializeSyncManager(systems.value[0].syncTarget, nativeTarget);
      } catch (syncError) {
        // Log the error but continue - the error state will be visible in the UI
        console.warn("Sync manager initialization failed:", syncError);
      }
    }

    // Add the system regardless of initialization state
    systems.value = [...systems.value, nativeSystem];
  } catch (err) {
    handleUIError(err, "Failed to set up native system", COMPONENT_ID);
  }
}

async function addWebContainerSystem() {
  try {
    // Create and initialize WebContainer
    const webcontainer = await WebContainer.boot();
    await webcontainer.mount({});

    // Create and initialize WebContainer file system
    const webcontainerFs = new WebContainerFileSystem(webcontainer);
    await webcontainerFs.initialize();

    // Create and initialize WebContainer sync target
    const webcontainerTarget = new WebContainerSyncTarget("webcontainer");

    try {
      await webcontainerTarget.initialize(webcontainerFs, false, {
        skipFileScan: false,
        resolutionFunctions: {
          resolveFromPrimary: () => syncManager.fullSyncFromPrimaryToTarget(webcontainerTarget)
        }
      });
    } catch (initError) {
      // Log the error but continue - we'll show the error state in the UI
      console.warn("WebContainer target initialization resulted in error state:", initError);
    }

    // Create synchronized system
    const webcontainerSystem = await createSynchronizedFileSystem({
      id: "webcontainer",
      title: "WebContainer",
      fileSystem: webcontainerFs,
      syncTarget: webcontainerTarget,
      watcherOptions: {
        priority: WATCHER_PRIORITIES.UI_UPDATES,
        metadata: {
          registeredBy: "DemoApp",
          type: "ui-explorer"
        }
      }
    });

    // Initialize sync manager first if not the first system
    if (systems.value.length >= 1) {
      try {
        await initializeSyncManager(systems.value[0].syncTarget, webcontainerTarget);
      } catch (syncError) {
        // Log the error but continue - the error state will be visible in the UI
        console.warn("Sync manager initialization failed:", syncError);
      }
    }

    // Add the system regardless of initialization state
    systems.value = [...systems.value, webcontainerSystem];
  } catch (err) {
    handleUIError(err, "Failed to set up WebContainer system", COMPONENT_ID);
  }
}

async function initializeSyncManager(primaryTarget: SyncTarget, secondaryTarget: SyncTarget) {
  try {
    const status = syncManager.getStatus();
    // Check if any targets are registered to determine if sync manager is initialized
    const hasTargets = status.targets && status.targets.size > 0;

    // Only initialize if no targets are registered yet
    if (!hasTargets) {
      await syncManager.initialize();
      await syncManager.registerTarget(primaryTarget, { role: "primary" });

      // Monitor sync status
      const monitorInterval = setInterval(monitorSync, 1000);

      // Clean up on component unmount
      onBeforeUnmount(() => {
        clearInterval(monitorInterval);
      });

      console.log("Sync manager initialized with primary target");
    }

    // Register the secondary target
    await syncManager.registerTarget(secondaryTarget, { role: "secondary" });
    console.log("Secondary target registered successfully");
  } catch (err) {
    handleUIError(err, "Failed to initialize sync manager", COMPONENT_ID);
  }
}

// Provide sync manager to child components
provide("syncManager", syncManager);

// Initialize browser system on mount
onMounted(initializeBrowserSystem);
</script>

<template>
  <div class="demo-app">
    <header>
      <div class="header-content">
        <h1>File Management Demo</h1>
        <sl-button variant="neutral" size="small" @click="showIgnorePatterns = true">
          <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -->
          <sl-icon slot="prefix" name="filter"></sl-icon>
          Show Ignore Patterns
        </sl-button>
      </div>
    </header>

    <main>
      <div v-if="systems.length === 0" class="loading panel">
        <sl-spinner></sl-spinner>
        Initializing file systems...
      </div>
      <FileExplorer v-else :systems="systems" class="panel">
        <template v-if="!hasNativeSystem() || !hasWebContainerSystem()" #after-explorer>
          <div class="empty-panel">
            <div class="empty-state">
              <div class="button-group">
                <sl-button
                  v-if="!hasNativeSystem()"
                  variant="primary"
                  size="large"
                  @click="addNativeSystem"
                >
                  <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -->
                  <sl-icon slot="prefix" name="folder"></sl-icon>
                  Add Local Directory
                </sl-button>
                <sl-button
                  v-if="!hasWebContainerSystem()"
                  variant="primary"
                  size="large"
                  @click="addWebContainerSystem"
                >
                  <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -->
                  <sl-icon slot="prefix" name="code"></sl-icon>
                  Add WebContainer
                </sl-button>
              </div>
              <p class="hint">
                {{
                  systems.length === 1
                    ? "Add another filesystem to enable synchronization"
                    : "Add more filesystems to expand synchronization"
                }}
              </p>
            </div>
          </div>
        </template>
      </FileExplorer>
    </main>

    <ErrorDisplay />
    <SyncProgress :sync-manager="syncManager" />
    <IgnorePatternsModal
      :sync-manager="syncManager"
      :open="showIgnorePatterns"
      @sl-after-hide="showIgnorePatterns = false"
    />
  </div>
</template>

<style scoped>
.demo-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: var(--sl-spacing-medium);
}

header {
  margin-bottom: var(--sl-spacing-medium);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h1 {
  font-size: var(--sl-font-size-2x-large);
  margin: 0;
}

main {
  flex: 1;
  min-height: 0;
}

.panel {
  height: 100%;
  border: 1px solid var(--sl-color-neutral-200);
  border-radius: var(--sl-border-radius-medium);
  background: var(--sl-color-neutral-0);
}

.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sl-spacing-medium);
  padding: var(--sl-spacing-2x-large);
  text-align: center;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sl-spacing-medium);
  color: var(--sl-color-neutral-600);
}

.hint {
  color: var(--sl-color-neutral-600);
  font-size: var(--sl-font-size-small);
  margin: 0;
}

.button-group {
  display: flex;
  gap: var(--sl-spacing-medium);
}
</style>
