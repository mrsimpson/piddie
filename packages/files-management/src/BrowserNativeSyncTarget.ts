import type {
  FileSystem,
  FileChangeInfo
} from "@piddie/shared-types";
import { BrowserNativeFileSystem } from "./BrowserNativeFileSystem";
import { SyncOperationError } from "@piddie/shared-types";
import { BaseSyncTarget } from "./BaseSyncTarget";

declare const globalThis: {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
};

/**
 * Browser-native implementation of the SyncTarget interface.
 * Uses polling to detect file changes since the browser doesn't provide native file watching.
 */
export class BrowserNativeSyncTarget extends BaseSyncTarget {
  override readonly type = "browser";
  private watchTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchCallback: ((changes: FileChangeInfo[]) => void) | null = null;

  constructor(targetId: string) {
    super(targetId);
  }

  override async initialize(fileSystem: FileSystem, isPrimary: boolean): Promise<void> {
    if (this.currentState !== "uninitialized" && this.currentState !== "error") {
      return;
    }

    try {
      if (!(fileSystem instanceof BrowserNativeFileSystem)) {
        throw new SyncOperationError(
          "BrowserNativeSyncTarget requires BrowserNativeFileSystem",
          "INITIALIZATION_FAILED"
        );
      }

      this.fileSystem = fileSystem;
      this.isPrimaryTarget = isPrimary;
      this.isInitialSync = !isPrimary;

      await this.fileSystem.initialize();
      this.transitionTo("idle", "initialize");
    } catch (error) {
      this.currentState = "error";
      this.error = error instanceof Error ? error.message : "Unknown error";
      throw error;
    }
  }

  override async watch(callback: (changes: FileChangeInfo[]) => void): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncOperationError("Not initialized", "WATCH_FAILED");
    }

    // Store callback for cleanup
    this.watchCallback = callback;
    let consecutiveErrors = 0;
    const MAX_ERRORS = 3;

    const checkForChanges = async () => {
      try {
        // Don't check for changes if we're not in idle state
        if (this.currentState !== "idle") {
          return;
        }

        const currentFiles = await this.getCurrentFilesState();
        const changes: FileChangeInfo[] = [];

        // Check for new and modified files
        for (const [path, currentState] of currentFiles) {
          const knownState = this.lastKnownFiles.get(path);
          if (!knownState) {
            // New file
            const metadata = await this.fileSystem!.getMetadata(path);
            changes.push({
              path,
              type: "create",
              hash: metadata.hash,
              size: metadata.size,
              lastModified: currentState.lastModified,
              sourceTarget: this.id
            });
          } else if (currentState.lastModified !== knownState.lastModified || currentState.hash !== knownState.hash) {
            // Modified file - detect changes by either timestamp or hash
            const metadata = await this.fileSystem!.getMetadata(path);
            changes.push({
              path,
              type: "modify",
              hash: metadata.hash,
              size: metadata.size,
              lastModified: currentState.lastModified,
              sourceTarget: this.id
            });
          }
        }

        // Check for deleted files
        for (const [path] of this.lastKnownFiles) {
          if (!currentFiles.has(path)) {
            changes.push({
              path,
              type: "delete",
              hash: "",
              size: 0,
              lastModified: Date.now(),
              sourceTarget: this.id
            });
          }
        }

        // Notify if changes detected
        if (changes.length > 0 && this.watchCallback) {
          this.watchCallback(changes);
          // Update lastKnownFiles to avoid duplicate notifications
          this.updateLastKnownFiles(currentFiles);
        }

        // Reset error count on successful check
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors++;
        console.warn(`Error during file watch (${consecutiveErrors}/${MAX_ERRORS}):`, error);

        // Stop watching after too many consecutive errors
        if (consecutiveErrors >= MAX_ERRORS) {
          console.error("Too many consecutive errors, stopping watch");
          await this.unwatch();
          this.currentState = "error";
          this.error = "Watch failed due to consecutive errors";
          throw new SyncOperationError("Watch failed due to consecutive errors", "WATCH_FAILED");
        }
      }

      // Schedule next check if still watching
      if (this.watchCallback) {
        this.watchTimeout = globalThis.setTimeout(checkForChanges, 10000);
      }
    };

    // Start watching
    await checkForChanges();
  }

  override async unwatch(): Promise<void> {
    if (this.watchTimeout !== null) {
      globalThis.clearTimeout(this.watchTimeout);
      this.watchTimeout = null;
    }
    this.watchCallback = null;
  }
}
