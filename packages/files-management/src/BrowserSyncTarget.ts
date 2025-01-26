import type {
  SyncTarget,
  FileSystem,
  FileChangeInfo,
  FileChange,
  FileConflict,
  TargetState
} from "@piddie/shared-types";
import { BrowserFileSystem } from "./BrowserFileSystem";
import { SyncError } from "@piddie/shared-types";

declare global {
  interface Window {
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
  }
}

/**
 * Browser implementation of the SyncTarget interface using lightning-fs
 */
export class BrowserSyncTarget implements SyncTarget {
  private fileSystem: BrowserFileSystem | null = null;
  private status: TargetState["status"] = "error";
  private error: string | null = "Not initialized";
  private pendingChanges: FileChangeInfo[] = [];
  private watchCallback: ((changes: FileChangeInfo[]) => void) | null = null;
  private watchInterval: ReturnType<typeof setInterval> | null = null;
  private lockState: TargetState["lockState"] = { isLocked: false };
  readonly type = "browser";
  readonly id: string;
  lastWatchTimestamp: number;

  // Track the last known state of files
  private lastKnownFiles = new Map<string, { mtimeMs: number }>();

  constructor(id: string) {
    this.id = id;
  }

  async initialize(fileSystem: FileSystem): Promise<void> {
    if (!(fileSystem instanceof BrowserFileSystem)) {
      throw new SyncError(
        "BrowserSyncTarget requires BrowserFileSystem",
        "INITIALIZATION_FAILED"
      );
    }

    this.fileSystem = fileSystem;
    this.status = "idle";
    this.error = null;
    await this.fileSystem.initialize();
  }

  async applyChanges(changes: FileChange[]): Promise<FileConflict[]> {
    if (!this.fileSystem) {
      throw new SyncError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    const conflicts: FileConflict[] = [];
    this.status = "syncing";

    for (const change of changes) {
      try {
        switch (change.type) {
          case "create":
            // Check for existence before attempting to write
            const exists = await this.fileSystem.exists(change.path); // eslint-disable-line no-case-declarations
            if (exists) {
              // File exists, check for conflict
              const existingContent = await this.fileSystem.readFile(
                change.path
              );
              if (existingContent !== change.content) {
                conflicts.push({
                  path: change.path,
                  incomingContent: change.content,
                  currentContent: existingContent,
                  sourceTarget: change.sourceTarget,
                  targetId: this.id,
                  timestamp: Date.now()
                });
                continue;
              }
            }
            await this.fileSystem.writeFile(change.path, change.content);
            break;
          case "modify":
            await this.fileSystem.writeFile(change.path, change.content);
            break;
          case "delete":
            await this.fileSystem.deleteItem(change.path);
            break;
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new SyncError(
            `Failed to apply change to ${change.path}: ${error.message}`,
            "APPLY_FAILED"
          );
        }
        throw error;
      }
    }

    return conflicts;
  }

  async getContents(paths: string[]): Promise<Map<string, string>> {
    if (!this.fileSystem) {
      throw new SyncError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    const contents = new Map<string, string>();
    for (const path of paths) {
      try {
        const content = await this.fileSystem.readFile(path);
        contents.set(path, content);
      } catch (error) {
        throw new SyncError(
          `Failed to read file ${path}: ${error}`,
          "CONTENT_RETRIEVAL_FAILED"
        );
      }
    }
    return contents;
  }

  async notifyIncomingChanges(): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    this.status = "notifying";
    await this.fileSystem.lock(30000, "Sync in progress");
  }

  async syncComplete(): Promise<boolean> {
    if (!this.fileSystem) {
      throw new SyncError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    await this.fileSystem.forceUnlock();
    this.status = "idle";
    this.pendingChanges = [];
    return true;
  }

  async watch(callback: (changes: FileChangeInfo[]) => void): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    this.watchCallback = callback;
    this.lastWatchTimestamp = Date.now();

    // In the browser, we'll poll for changes every second as there's no native file system watcher
    this.watchInterval = globalThis.setInterval(async () => {
      try {
        const changes = await this.checkForChanges();
        if (changes.length > 0 && this.watchCallback) {
          this.pendingChanges.push(...changes);
          this.watchCallback(changes);
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new SyncError(
            `Failed to watch directory: ${error.message}`,
            "WATCH_FAILED"
          );
        }
        throw error;
      }
    }, 1000);
  }

  async unwatch(): Promise<void> {
    if (this.watchInterval !== null) {
      globalThis.clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.watchCallback = null;
    this.pendingChanges = [];
  }

  getState(): TargetState {
    const state: TargetState = {
      id: this.id,
      type: this.type,
      status: this.status,
      pendingChanges: this.pendingChanges.length,
      lockState: this.lockState
    };

    if (this.error) {
      state.error = this.error;
    }

    return state;
  }

  private async checkForChanges(): Promise<FileChangeInfo[]> {
    if (!this.fileSystem) {
      return [];
    }

    const changes: FileChangeInfo[] = [];
    const currentTimestamp = Date.now();
    const currentFiles = new Map<string, { mtimeMs: number }>();

    try {
      // Recursive function to process directory contents
      const processDirectory = async (dirPath: string) => {
        const entries = await this.fileSystem!.listDirectory(dirPath);

        for (const entry of entries) {
          if (entry.type === "directory") {
            // Recursively process subdirectory
            await processDirectory(entry.path);
            continue;
          }

          // Process file
          const stats = await this.fileSystem!.getMetadata(entry.path);
          currentFiles.set(entry.path, { mtimeMs: stats.lastModified });

          const lastKnown = this.lastKnownFiles.get(entry.path);
          if (!lastKnown) {
            // New file
            changes.push({
              path: entry.path,
              type: "create",
              sourceTarget: this.id,
              timestamp: currentTimestamp
            });
          } else if (lastKnown.mtimeMs < stats.lastModified) {
            // Modified file
            changes.push({
              path: entry.path,
              type: "modify",
              sourceTarget: this.id,
              timestamp: currentTimestamp
            });
          }
        }
      };

      // Start processing from root directory
      await processDirectory("");

      // Check for deleted files
      for (const [path] of this.lastKnownFiles) {
        if (!currentFiles.has(path)) {
          changes.push({
            path,
            type: "delete",
            sourceTarget: this.id,
            timestamp: currentTimestamp
          });
        }
      }

      // Update last known state
      this.lastKnownFiles = currentFiles;
      this.lastWatchTimestamp = currentTimestamp;

      return changes;
    } catch {
      // If there's an error reading the directory, return no changes
      // The error will be handled by the watch method
      return [];
    }
  }
}
