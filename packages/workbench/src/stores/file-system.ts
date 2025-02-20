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
import type { Project } from "@piddie/project-management";

let webContainer: WebContainer | null = null;

export const useFileSystemStore = defineStore("file-system", () => {
  const syncManager = new FileSyncManager();
  const systems = ref<SynchronizedFileSystem[]>([]);

  async function initializeSyncManager(browserTarget: BrowserSyncTarget, webContainerTarget: WebContainerSyncTarget) {
    try {
      const status = syncManager.getStatus();
      const hasTargets = status.targets && status.targets.size > 0;

      if (!hasTargets) {
        return;
      }

      await syncManager.registerTarget(webContainerTarget, { role: "secondary" });

      // Start sync
      await syncManager.initialize();
    } catch (err) {
      console.error("Failed to initialize sync manager:", err);
    }
  }

  async function initializeForProject(project: Project) {
    try {
      // Initialize browser file system
      const browserFs = new BrowserFileSystem({
        name: project.id,
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
            registeredBy: "Workbench",
            type: "ui-explorer"
          }
        }
      });

      systems.value = [browserSystem];

      // Initialize web container
      webContainer = await WebContainer.boot();
      await webContainer.mount({});
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
    await syncManager.dispose();
    if (webContainer) {
      await webContainer.teardown();
      webContainer = null;
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
