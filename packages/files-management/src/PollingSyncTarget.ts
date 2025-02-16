import type {
  FileSystem,
  FileChangeInfo,
  ResolutionFunctions,
  ResolutionType
} from "@piddie/shared-types";
import { SyncOperationError } from "@piddie/shared-types";
import { BaseSyncTarget } from "./BaseSyncTarget";

declare const globalThis: {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
};

/**
 * Base class for sync targets that use polling to detect changes
 */
export abstract class PollingSyncTarget extends BaseSyncTarget {
  private changeBuffer = new Map<string, FileChangeInfo>();
  private changeTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchTimeout: ReturnType<typeof setTimeout> | null = null;
  private isWatcherRunning = false;
  private shouldContinueWatching = false;
  private readonly WATCH_INTERVAL = 1000; // Fixed 1 second interval

  /**
   * Validate that the file system is of the correct type for this target
   * @throws {SyncOperationError} if file system is not of the correct type
   */
  protected abstract validateFileSystem(fileSystem: FileSystem): void;

  override async initialize(
    fileSystem: FileSystem,
    isPrimary: boolean,
    options: {
      skipFileScan?: boolean;
      resolutionFunctions?: ResolutionFunctions;
    } = {
      skipFileScan: false,
      resolutionFunctions: {
        resolveFromPrimary: () => Promise.resolve()
      }
    }
  ): Promise<void> {
    try {
      this.validateFileSystem(fileSystem);
    } catch (error) {
      this.transitionTo("error", "initialize");
      throw error;
    }

    this.fileSystem = fileSystem;
    this.isPrimaryTarget = isPrimary;
    this.isInitialSync = true;
    this.resolutionFunctions = options.resolutionFunctions;

    // Quick initialization
    this.transitionTo("initializing", "initialize");

    try {
      // For secondary targets, check for existing files unless explicitly skipped
      if (
        !isPrimary &&
        !options.skipFileScan &&
        (await this.checkForExistingFiles())
      ) {
        this.transitionTo("error", "initialize");
        return;
      }

      this.transitionTo("idle", "initialize");

      // Start watching for changes
      await this.startWatching();

      // Start background scan if not skipped
      if (!options.skipFileScan) {
        await this.startBackgroundScan();
      }
    } catch (error) {
      console.error("Initialization failed:", error);
      this.transitionTo("error", "initialize");
      throw error;
    }
  }

  protected async checkForExistingFiles(): Promise<boolean> {
    if (!this.fileSystem) {
      throw new SyncOperationError("No file system", "INITIALIZATION_FAILED");
    }

    try {
      const rootFiles = await this.fileSystem.listDirectory("/");
      // We consider it a conflict if there are any files in the root directory
      return rootFiles.length > 0;
    } catch (error) {
      console.error("Failed to check for existing files:", error);
      return false;
    }
  }

  private async startBackgroundScan(): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    // We should already be in idle state from initialize
    this.transitionTo("scanning", "scan");

    try {
      // Lock filesystem for scanning
      await this.lockFileSystem();

      try {
        const currentFiles = await this.getCurrentFilesState();
        this.updateLastKnownFiles(currentFiles);
      } finally {
        // Always unlock, even if scan fails
        await this.unlockFileSystem();
      }

      // Transition back to idle after successful scan
      this.transitionTo("idle", "finishScan");
    } catch (error) {
      // If we can't acquire the lock, just skip the scan
      if (
        error instanceof Error &&
        error.message.includes("locked by browser")
      ) {
        console.warn("Skipping background scan due to file system lock");
        // Still need to transition back to idle
        this.transitionTo("idle", "finishScan");
        return;
      }
      throw error;
    }
  }

  private async startWatching(): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    // Reset watch state
    this.shouldContinueWatching = true;

    const scheduleNextCheck = () => {
      if (this.shouldContinueWatching) {
        this.watchTimeout = globalThis.setTimeout(async () => {
          // Only perform check if not scanning
          if (this.getCurrentState() !== "scanning") {
            await this.performCheck();
          }
          scheduleNextCheck();
        }, this.WATCH_INTERVAL);
      }
    };

    // Start the watching cycle
    scheduleNextCheck();
  }

  private async performCheck(): Promise<void> {
    // Skip if already running or should stop
    if (this.isWatcherRunning || !this.shouldContinueWatching) {
      return;
    }

    try {
      this.isWatcherRunning = true;

      // Don't check for changes if we're not in idle state
      if (this.getCurrentState() !== "idle") {
        return;
      }

      const currentFiles = await this.getCurrentFilesState();
      const changes: FileChangeInfo[] = [];

      // First check for deleted files before updating lastKnownFiles
      for (const [path] of this.lastKnownFiles) {
        if (!currentFiles.has(path)) {
          changes.push({
            path,
            type: "delete",
            sourceTarget: this.id,
            metadata: {
              path,
              type: "file",
              hash: "",
              size: 0,
              lastModified: Date.now()
            }
          });
        }
      }

      // Then check for new and modified files
      for (const [path, currentState] of currentFiles) {
        const knownState = this.lastKnownFiles.get(path);
        if (!knownState) {
          // New file
          const metadata = await this.fileSystem!.getMetadata(path);
          changes.push({
            path,
            type: "create",
            sourceTarget: this.id,
            metadata
          });
        } else if (
          currentState.lastModified !== knownState.lastModified ||
          currentState.hash !== knownState.hash
        ) {
          // Modified file - detect changes by either timestamp or hash
          const metadata = await this.fileSystem!.getMetadata(path);
          changes.push({
            path,
            type: "modify",
            sourceTarget: this.id,
            metadata
          });
        }
      }

      if (changes.length > 0) {
        await this.handleFileChanges(changes);
        this.updateLastKnownFiles(currentFiles);
      }
    } catch (error) {
      console.warn("Error during file watch:", error);
    } finally {
      this.isWatcherRunning = false;
    }
  }

  protected async handleFileChanges(changes: FileChangeInfo[]): Promise<void> {
    for (const change of changes) {
      this.changeBuffer.set(change.path, change);
    }

    // Clear existing timeout if any
    if (this.changeTimeout !== null) {
      globalThis.clearTimeout(this.changeTimeout);
    }

    // Set new timeout to process changes
    this.changeTimeout = globalThis.setTimeout(async () => {
      const bufferedChanges = Array.from(this.changeBuffer.values());
      this.changeBuffer.clear();
      this.changeTimeout = null;

      // Notify watchers of the changes
      await this.notifyWatchers(bufferedChanges);
    }, 100); // 100ms debounce
  }

  override async recover(resolutionType?: ResolutionType): Promise<void> {
    // First do the base recovery
    await super.recover(resolutionType);

    // Restart the watcher
    this.shouldContinueWatching = false;
    if (this.watchTimeout !== null) {
      globalThis.clearTimeout(this.watchTimeout);
      this.watchTimeout = null;
    }

    // Clear any pending changes
    this.changeBuffer.clear();
    if (this.changeTimeout !== null) {
      globalThis.clearTimeout(this.changeTimeout);
      this.changeTimeout = null;
    }

    // Reset watcher state and start fresh
    this.isWatcherRunning = false;
    await this.startWatching();
  }

  override async unwatch(): Promise<void> {
    this.shouldContinueWatching = false;
    if (this.watchTimeout !== null) {
      globalThis.clearTimeout(this.watchTimeout);
      this.watchTimeout = null;
    }
    await super.unwatch();
  }
}
