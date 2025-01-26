import { watch } from "fs/promises";
import type {
  SyncTarget,
  FileSystem,
  FileChangeInfo,
  FileChange,
  FileConflict,
  TargetState
} from "@piddie/shared-types";
import { NodeFileSystem } from "./NodeFileSystem";
import { SyncError } from "@piddie/shared-types";

/**
 * Node.js implementation of the SyncTarget interface
 */
export class NodeSyncTarget implements SyncTarget {
  public readonly type = "local" as const;
  private fileSystem?: NodeFileSystem;
  private watchAbortController: AbortController | null = null;
  private watchCallback: ((changes: FileChangeInfo[]) => void) | null = null;
  private pendingChanges: FileChangeInfo[] = [];
  private status: TargetState["status"] = "idle";

  constructor(
    public readonly id: string,
    private rootDir: string
  ) {}

  async initialize(fileSystem: FileSystem): Promise<void> {
    if (!(fileSystem instanceof NodeFileSystem)) {
      throw new SyncError(
        "NodeSyncTarget requires NodeFileSystem",
        "INITIALIZATION_FAILED"
      );
    }
    this.fileSystem = fileSystem;
    await this.fileSystem.initialize();
  }

  async notifyIncomingChanges(): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    // Lock the file system during sync
    await this.fileSystem.lock(30000, "Sync in progress");
    this.status = "notifying";
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

  async applyChanges(changes: FileChange[]): Promise<FileConflict[]> {
    if (!this.fileSystem) {
      throw new SyncError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    const conflicts: FileConflict[] = [];
    this.status = "syncing"; // Set status to syncing when we start applying changes

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
        // Handle other errors that might occur during file operations
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

  async syncComplete(): Promise<boolean> {
    if (!this.fileSystem) {
      throw new SyncError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    await this.fileSystem.forceUnlock();
    this.status = "idle";

    // Return true if no pending changes
    return this.pendingChanges.length === 0;
  }

  async watch(callback: (changes: FileChangeInfo[]) => void): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    this.watchCallback = callback;
    this.watchAbortController = new AbortController();

    try {
      const watcher = await watch(this.rootDir, {
        recursive: true,
        signal: this.watchAbortController.signal
      });

      for await (const event of watcher) {
        if (event.filename) {
          // Ensure we have a valid filename
          const filePath = event.filename; // Use the filename directly since it's already relative to the watched directory
          const exists = await this.fileSystem.exists(filePath);

          const change: FileChangeInfo = {
            path: filePath,
            // Node's fs.watch doesn't reliably distinguish between create/modify
            // We'll need to check if file exists to determine the type
            type: exists ? "modify" : "create",
            sourceTarget: this.id,
            timestamp: Date.now()
          };

          this.pendingChanges.push(change);
        }
      }
      // Call the callback once with all changes
      if (this.pendingChanges.length > 0) {
        this.watchCallback(this.pendingChanges);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Normal abort during unwatch, ignore
        return;
      }
      throw new SyncError(
        `Failed to watch directory: ${error}`,
        "WATCH_FAILED"
      );
    }
  }

  async unwatch(): Promise<void> {
    this.watchAbortController?.abort();
    this.watchCallback = null;
    this.watchAbortController = null;
  }

  getState(): TargetState {
    if (!this.fileSystem) {
      return {
        id: this.id,
        type: this.type,
        lockState: { isLocked: false },
        pendingChanges: 0,
        status: "error",
        error: "Not initialized"
      };
    }

    return {
      id: this.id,
      type: this.type,
      lockState: this.fileSystem.getState().lockState,
      pendingChanges: this.pendingChanges.length,
      status: this.status
    };
  }
}
