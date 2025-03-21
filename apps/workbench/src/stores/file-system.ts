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
          resolveFromPrimary: () =>
            syncManager.fullSyncFromPrimaryToTarget(syncTarget)
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
      console.log(`Initializing file systems for project: ${project.id}`);

      // Reset the store state but don't delete file systems
      if (initialized.value) {
        await resetStoreState();
      }

      // Reset systems array before initialization
      systems.value = [];

      // Initialize sync manager
      await initializeSyncManager();

      // Create or reuse browser file system for this project
      // The browser file system is automatically persisted with the project ID as name
      console.log(
        `Creating/loading browser file system for project: ${project.id}`
      );
      const browserFs = new BrowserFileSystem({
        name: project.id,
        rootDir: "/"
      });
      await browserFs.initialize();

      // Add the browser file system as a sync target
      await addSyncTarget(browserFs, "browser", "Browser Storage", true);

      // Always create a new WebContainer for the project
      try {
        console.log("Booting WebContainer...");
        webContainer = await WebContainer.boot();
        console.log("WebContainer booted, mounting...");
        await webContainer.mount({});
        console.log("WebContainer mounted");

        const webContainerFs = new WebContainerFileSystem(webContainer);
        await webContainerFs.initialize();
        await addSyncTarget(
          webContainerFs,
          "webcontainer",
          "WebContainer",
          false
        );
        console.log("WebContainer target added");
      } catch (webContainerError) {
        console.error("Failed to initialize WebContainer:", webContainerError);
        // Continue without WebContainer - mark as not initialized but don't fail completely
        webContainer = null;
      }

      initialized.value = true;
    } catch (err) {
      // On error, ensure we clean up any partial initialization
      try {
        await resetStoreState();
      } catch (cleanupErr) {
        console.error(
          "Failed to cleanup after initialization error:",
          cleanupErr
        );
      }
      console.error("Failed to initialize file systems:", err);
      throw err;
    }
  }

  // Reset store state without deleting file systems
  async function resetStoreState() {
    try {
      console.log("Resetting store state without deleting file systems");

      // Stop monitoring
      stopMonitoring();

      // Ensure all sync targets are unwatched first
      await Promise.all(
        systems.value.map(async (system) => {
          try {
            await system.syncTarget.unwatch();
          } catch (err) {
            console.warn("Error unwatching sync target:", err);
          }
        })
      );

      // Dispose sync manager and wait for completion
      if (syncManager) {
        await syncManager.dispose();
        syncManager = new FileSyncManager(); // Create fresh instance
      }

      // Ensure webcontainer is fully torn down before nulling
      if (webContainer) {
        console.log("Tearing down WebContainer");
        await webContainer.teardown();
        webContainer = null;
      }

      // Reset systems before setting initialized to false
      systems.value = [];
      initialized.value = false;

      // Wait a bit to ensure all cleanup is complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      console.log("Store state reset completed successfully");
    } catch (err) {
      console.error("Failed to reset store state:", err);
      throw err;
    }
  }

  // Full cleanup including deleting file systems
  async function cleanup() {
    try {
      console.log("Performing full cleanup including file systems");

      // First reset the store state
      await resetStoreState();

      console.log("Full cleanup completed successfully");
    } catch (err) {
      console.error("Failed to clean up file systems:", err);
      throw err;
    }
  }

  /**
   * Gets the active file system
   * @returns The active file system or null if not available
   */
  function getBrowserFileSystem(): FileSystem | null {
    if (systems.value.length === 0) {
      return null;
    }

    // we write to the BrowserFileSystem
    return (
      systems.value.find(
        (system) => system.fileSystem instanceof BrowserFileSystem
      )?.fileSystem ?? null
    );
  }

  /**
   * Cleans up a specific project's file system
   * This should be called when a project is deleted and it's not the current project
   * @param projectId The ID of the project to clean up
   */
  async function cleanupProjectFileSystem(projectId: string): Promise<void> {
    try {
      console.log(`Cleaning up file system for project: ${projectId}`);

      // Create a temporary BrowserFileSystem instance for the project
      // This will connect to the existing IndexedDB database for the project
      const tempFileSystem = new BrowserFileSystem({
        name: projectId,
        rootDir: "/"
      });

      // Dispose the file system to delete the IndexedDB database
      await tempFileSystem.dispose();
      console.log(
        `Successfully cleaned up file system for project: ${projectId}`
      );
    } catch (error) {
      console.error(
        `Failed to clean up file system for project ${projectId}:`,
        error
      );
      // Don't rethrow the error, as we want to continue with project deletion even if cleanup fails
    }
  }

  return {
    syncManager,
    systems,
    syncStatus,
    initializeForProject,
    addSyncTarget,
    cleanup,
    resetStoreState,
    initialized,
    getBrowserFileSystem,
    cleanupProjectFileSystem
  };
});
