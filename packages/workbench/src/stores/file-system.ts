import { defineStore } from "pinia";
import { ref } from "vue";
import {
  FileSyncManager,
  BrowserFileSystem,
  WebContainerFileSystem,
  BrowserSyncTarget,
  WebContainerSyncTarget
} from "@piddie/files-management";
import type { SynchronizedFileSystem } from "../types/file-system";
import { createSynchronizedFileSystem } from "../types/file-system";
import { WATCHER_PRIORITIES } from "@piddie/shared-types";
import { WebContainer } from "@webcontainer/api";

export const useFileSystemStore = defineStore("file-system", () => {
  const syncManager = new FileSyncManager();
  const systems = ref<SynchronizedFileSystem[]>([]);
  const webContainer = ref<WebContainer | null>(null);

  async function initializeSyncManager(browserTarget: BrowserSyncTarget, webContainerTarget: WebContainerSyncTarget) {
    try {
      const status = syncManager.getStatus();
      const hasTargets = status.targets && status.targets.size > 0;

      if (!hasTargets) {
        // First time initialization
        await syncManager.initialize();
        await syncManager.registerTarget(browserTarget, { role: "primary" });
        console.log("Sync manager initialized with primary target");
      }

      // Register the secondary target if it's not already registered
      const existingTargets = syncManager.getSecondaryTargets();
      if (!existingTargets.some((t) => t.id === webContainerTarget.id)) {
        await syncManager.registerTarget(webContainerTarget, { role: "secondary" });
        console.log("Secondary target registered successfully");
      }

      // Start sync
      await syncManager.initialize();
    } catch (err) {
      console.error("Failed to initialize sync manager:", err);
    }
  }

  async function initializeForProject(projectPath: string) {
    try {
      // Initialize browser file system
      const browserFs = new BrowserFileSystem({
        name: projectPath,
        rootDir: projectPath.split("/").join("-")
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
            registeredBy: "Workbench",
            type: "ui-explorer"
          }
        }
      });

      systems.value = [browserSystem];

      // Initialize web container
      webContainer.value = await WebContainer.boot();
      const webContainerFs = new WebContainerFileSystem(webContainer);
      await webContainerFs.initialize();

      // Create and initialize web container sync target
      const webContainerTarget = new WebContainerSyncTarget("webcontainer");
      await webContainerTarget.initialize(webContainerFs, false, {
        skipFileScan: false,
        resolutionFunctions: {
          resolveFromPrimary: () => syncManager.fullSyncFromPrimaryToTarget(webContainerTarget)
        }
      });

      // Create synchronized system
      const webContainerSystem = await createSynchronizedFileSystem({
        id: "webcontainer",
        title: "WebContainer",
        fileSystem: webContainerFs,
        syncTarget: webContainerTarget,
        watcherOptions: {
          priority: WATCHER_PRIORITIES.UI_UPDATES,
          metadata: {
            registeredBy: "Workbench",
            type: "ui-explorer"
          }
        }
      });

      systems.value.push(webContainerSystem);

      // Initialize sync manager with both targets
      await initializeSyncManager(browserTarget, webContainerTarget);
    } catch (err) {
      console.error("Failed to initialize file systems:", err);
    }
  }

  async function cleanup() {
    await syncManager.stop();
    if (webContainer.value) {
      await webContainer.value.teardown();
      webContainer.value = null;
    }
    systems.value = [];
  }

  return {
    syncManager,
    systems,
    initializeForProject,
    cleanup
  };
});
