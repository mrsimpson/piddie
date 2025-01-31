import type { FileSystem, FileChangeInfo } from "@piddie/shared-types";
import { BrowserNativeFileSystem } from "./BrowserNativeFileSystem";
import { SyncOperationError } from "@piddie/shared-types";
import { BaseSyncTarget } from "./BaseSyncTarget";

declare const globalThis: {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
};

/**
 * Browser implementation of the SyncTarget interface using the Native File System API
 */
export class BrowserNativeSyncTarget extends BaseSyncTarget {
  override readonly type = "browser";
  private changeBuffer: FileChangeInfo[] = [];
  private changeTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(targetId: string) {
    super(targetId);
  }

  override async initialize(
    fileSystem: FileSystem,
    isPrimary: boolean
  ): Promise<void> {
    if (!(fileSystem instanceof BrowserNativeFileSystem)) {
      this.transitionTo("error", "initialize");
      throw new SyncOperationError(
        "Invalid file system type",
        "INITIALIZATION_FAILED"
      );
    }

    this.fileSystem = fileSystem;
    this.isPrimaryTarget = isPrimary;
    this.transitionTo("idle", "initialize");

    // Start watching for changes if initialized successfully
    if (this.getCurrentState() === "idle") {
      await this.startWatching();
    }
  }

  private async startWatching(): Promise<void> {
    if (
      !this.fileSystem ||
      !(this.fileSystem instanceof BrowserNativeFileSystem)
    ) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    const checkForChanges = async () => {
      try {
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
              hash: "",
              size: 0,
              lastModified: Date.now(),
              sourceTarget: this.id
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
              hash: metadata.hash,
              size: metadata.size,
              lastModified: currentState.lastModified,
              sourceTarget: this.id
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
              hash: metadata.hash,
              size: metadata.size,
              lastModified: currentState.lastModified,
              sourceTarget: this.id
            });
          }
        }

        // Only update lastKnownFiles after we've detected all changes
        if (changes.length > 0) {
          await this.handleFileChanges(changes);
          this.updateLastKnownFiles(currentFiles);
        }

        // Schedule next check only after current check is complete
        this.watchTimeout = globalThis.setTimeout(checkForChanges, 1000);
      } catch (error) {
        console.warn("Error during file watch:", error);
        // Even on error, try to schedule next check
        this.watchTimeout = globalThis.setTimeout(checkForChanges, 1000);
      }
    };

    // Start with immediate check
    await checkForChanges();
  }

  protected async handleFileChanges(changes: FileChangeInfo[]): Promise<void> {
    for (const change of changes) {
      this.changeBuffer.push(change);
    }

    // Clear existing timeout if any
    if (this.changeTimeout !== null) {
      globalThis.clearTimeout(this.changeTimeout);
    }

    // Set new timeout to process changes
    this.changeTimeout = globalThis.setTimeout(async () => {
      const bufferedChanges = [...this.changeBuffer];
      this.changeBuffer = [];
      this.changeTimeout = null;

      // Notify watchers of the changes
      await this.notifyWatchers(bufferedChanges);
    }, 100); // 100ms debounce
  }

  override async unwatch(): Promise<void> {
    if (this.watchTimeout !== null) {
      globalThis.clearTimeout(this.watchTimeout);
      this.watchTimeout = null;
    }
    await super.unwatch();
  }
}
