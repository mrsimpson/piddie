import { defineStore } from "pinia";
import { ref, onUnmounted } from "vue";
import {
  FileSyncManager,
  BrowserFileSystem,
  WebContainerFileSystem,
  BrowserSyncTarget,
  WebContainerSyncTarget,
  type FileSystem
} from "@piddie/files-management";
import type { SynchronizedFileSystem } from "../types/file-system";
import { createSynchronizedFileSystem } from "../types/file-system";
import { WATCHER_PRIORITIES } from "@piddie/shared-types";
import { WebContainer } from "@webcontainer/api";
import type { Project } from "@piddie/project-management";
import type { SyncTarget } from "@piddie/shared-types";

let webContainer: WebContainer | null = null;

/**
 * This store serves as API to the files-management package.
 * I bundles the necessities of the project driven workbench and orchestrates the storages
 */
export const useFileSystemStore = defineStore("file-system", () => {
  let syncManager = new FileSyncManager();
  const systems = ref<SynchronizedFileSystem[]>([]);
  const initialized = ref(false);
  const syncStatus = ref<{
    error: Error | null;
    pendingTargets: string[];
  }>({
    error: null,
    pendingTargets: []
  });

  // Monitor sync status
  let monitorInterval: number | undefined = undefined;

  function stopMonitoring() {
    if (monitorInterval !== undefined) {
      clearInterval(monitorInterval);
      monitorInterval = undefined;
    }
  }
  
  function monitorSync() {
    if (!syncManager) return;

    const status = syncManager.getStatus();
    const pendingSync = syncManager.getPendingSync();

    // Update sync status
    syncStatus.value = {
      error: status.currentFailure?.error ?? null,
      pendingTargets: pendingSync
        ? Array.from(pendingSync.pendingByTarget.keys())
        : []
    };

    // Log issues for debugging
    if (status.currentFailure) {
      console.error(
        `Sync failed for target ${status.currentFailure.targetId}:`,
        status.currentFailure.error
      );
    }
  }

  async function initializeSyncManager() {
    try {
      // Stop any existing monitoring
      stopMonitoring();

      // Create new sync manager instance
      const oldManager = syncManager;
      syncManager = new FileSyncManager();

      // Dispose old manager if it exists
      try {
        await oldManager?.dispose();
      } catch (err) {
        console.warn("Error disposing old sync manager:", err);
      }

      // Initialize new manager
      await syncManager.initialize();

      // Start monitoring sync status
      monitorInterval = window.setInterval(monitorSync, 1000);
      
      // Clean up on store disposal
      onUnmounted(() => {
        stopMonitoring();
      });

      console.log("New sync manager initialized");
    } catch (err) {
      console.error("Failed to initialize sync manager:", err);
      syncStatus.value.error = err as Error;
      throw err;
    }
  }

  async function createUiSyncTarget(
    fileSystem: FileSystem,
    targetId: string
  ): Promise<SyncTarget> {
    // Create UI sync target matching the filesystem type
    let uiTarget: SyncTarget;
    if (fileSystem instanceof BrowserFileSystem) {
      uiTarget = new BrowserSyncTarget(`ui-${targetId}`);
    } else if (fileSystem instanceof WebContainerFileSystem) {
      uiTarget = new WebContainerSyncTarget(`ui-${targetId}`);
    } else {
      throw new Error("Unsupported file system type");
    }

    // Initialize with filesystem but skip file scan
    await uiTarget.initialize(fileSystem, false, {
      skipFileScan: true
    });

    return uiTarget;
  }

  async function addSyncTarget(
    fileSystem: FileSystem,
    targetId: string,
    title: string,
    isPrimary = false
  ): Promise<SynchronizedFileSystem> {
    try {
      // Create sync target based on file system type
      let syncTarget: SyncTarget;
      if (fileSystem instanceof BrowserFileSystem) {
        syncTarget = new BrowserSyncTarget(targetId);
      } else if (fileSystem instanceof WebContainerFileSystem) {
        syncTarget = new WebContainerSyncTarget(targetId);
      } else {
        throw new Error("Unsupported file system type");
      }

      // Initialize sync target with resolution functions for syncing
      await syncTarget.initialize(fileSystem, isPrimary, {
        skipFileScan: false,
        resolutionFunctions: {
          resolveFromPrimary: () => syncManager.fullSyncFromPrimaryToTarget(syncTarget),
          // resolveFromSecondary: () => syncManager.fullSyncFromTargetToPrimary(syncTarget)
        }
      });

      // Create UI sync target for reactive updates
      const uiTarget = await createUiSyncTarget(fileSystem, targetId);

      // Register sync target with sync manager
      await syncManager.registerTarget(syncTarget, {
        role: isPrimary ? "primary" : "secondary"
      });

      // Create synchronized system with UI target
      const system = await createSynchronizedFileSystem({
        id: targetId,
        title,
        fileSystem,
        syncTarget: uiTarget, // Use UI target for reactive updates
        watcherOptions: {
          priority: WATCHER_PRIORITIES.UI_UPDATES,
          metadata: {
            registeredBy: "FileSystemStore",
            type: "ui-explorer"
          }
        }
      });

      // Add to systems list
      systems.value = [...systems.value, system];

      // If secondary, sync from primary
      if (!isPrimary && syncManager.getPrimaryTarget()) {
        await syncManager.fullSyncFromPrimaryToTarget(syncTarget);
      }

      return system;
    } catch (err) {
      console.error(`Failed to add sync target ${targetId}:`, err);
      throw err;
    }
  }

  async function initializeForProject(project: Project) {
    try {
      // If already initialized, clean up first and wait for cleanup
      if (initialized.value) {
        await cleanup();
        // Additional wait to ensure WebContainer is fully cleaned up
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Reset systems array before initialization
      systems.value = [];

      // Initialize sync manager
      await initializeSyncManager();

      // Initialize browser file system as primary
      const browserFs = new BrowserFileSystem({
        name: project.id,
        rootDir: "/"
      });
      await browserFs.initialize();
      await addSyncTarget(browserFs, "browser", "Browser Storage", true);

      // Initialize web container as secondary
      try {
        console.log("Booting WebContainer...");
        webContainer = await WebContainer.boot();
        console.log("WebContainer booted, mounting...");
        await webContainer.mount({});
        console.log("WebContainer mounted");

        const webContainerFs = new WebContainerFileSystem(webContainer);
        await webContainerFs.initialize();
        await addSyncTarget(webContainerFs, "webcontainer", "WebContainer");
        console.log("WebContainer target added");
      } catch (webContainerError) {
        console.error("Failed to initialize WebContainer:", webContainerError);
        // Continue without WebContainer - mark as not initialized but don't fail completely
        webContainer = null;
      }

      initialized.value = true;
    } catch (err) {
      console.error("Failed to initialize file systems:", err);
      throw err;
    }
  }

  async function cleanup() {
    try {
      // Stop monitoring
      stopMonitoring();

      // Dispose sync manager
      await syncManager.dispose();
      syncManager = new FileSyncManager(); // Create fresh instance

      // Ensure webcontainer is fully torn down before nulling
      if (webContainer) {
        await webContainer.teardown();
        webContainer = null;
      }

      // Reset systems before setting initialized to false
      systems.value = [];
      initialized.value = false;

      // Wait a bit to ensure all cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      console.error("Failed to clean up file systems:", err);
      throw err;
    }
  }

  return {
    syncManager,
    systems,
    syncStatus,
    initializeForProject,
    addSyncTarget,
    cleanup,
    initialized
  };
});
