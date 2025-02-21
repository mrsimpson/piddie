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

/**
 * This store serves as API to the files-management package.
 * I bundles the necessities of the project driven workbench and orchestrates the storages
 */
export const useFileSystemStore = defineStore("file-system", () => {
  const syncManager = new FileSyncManager();
  const systems = ref<SynchronizedFileSystem[]>([]);
  const initialized = ref(false);

  async function initializeSyncManager(
    browserTarget: BrowserSyncTarget,
    webContainerTarget: WebContainerSyncTarget
  ) {
    try {
      const status = syncManager.getStatus();
      const hasTargets = status.targets && status.targets.size > 0;

      if (!hasTargets) {
        return;
      }

      await syncManager.registerTarget(webContainerTarget, {
        role: "secondary"
      });

      // Start sync
      await syncManager.initialize();
    } catch (err) {
      console.error("Failed to initialize sync manager:", err);
    }
  }

  async function initializeForProject(project: Project) {
    try {
      // If already initialized, clean up first
      if (initialized.value) {
        await cleanup();
      }

      // Reset systems array before initialization
      systems.value = [];

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
          resolveFromPrimary: () =>
            syncManager.fullSyncFromPrimaryToTarget(browserTarget)
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
          resolveFromPrimary: () =>
            syncManager.fullSyncFromPrimaryToTarget(webContainerTarget)
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
      initialized.value = true;
    } catch (err) {
      console.error("Failed to initialize file systems:", err);
      throw err; // Re-throw to allow error handling by caller
    }
  }

  async function cleanup() {
    try {
      await syncManager.dispose();

      if (webContainer) {
        await webContainer.teardown();
        webContainer = null;
      }

      // Reset systems before setting initialized to false
      systems.value = [];
      initialized.value = false;
    } catch (err) {
      console.error("Failed to clean up file systems:", err);
      throw err;
    }
  }

  return {
    syncManager,
    systems,
    initializeForProject,
    cleanup,
    initialized
  };
});
