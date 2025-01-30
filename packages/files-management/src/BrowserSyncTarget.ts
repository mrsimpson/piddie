import { SyncOperationError } from "@piddie/shared-types";
import type {
  SyncTarget,
  FileSystem,
  FileChangeInfo,
  FileChange,
  FileConflict,
  TargetState,
  FileMetadata,
  FileContentStream,
  FileSystemItem
} from "@piddie/shared-types";
import { BrowserFileSystem } from "./BrowserFileSystem";

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
  private watchTimeout: ReturnType<typeof setTimeout> | null = null;
  private isCheckingForChanges = false;
  private lockState: TargetState["lockState"] = { isLocked: false };
  readonly type = "browser";
  readonly id: string;
  lastWatchTimestamp: number;

  // Track the last known state of files
  private lastKnownFiles = new Map<string, { mtimeMs: number }>();

  constructor(id: string) {
    this.id = id;
  }
  getFileSystem(): FileSystem {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "Target not initialized",
        "INITIALIZATION_FAILED"
      );
    }
    return this.fileSystem;
  }

  async initialize(fileSystem: FileSystem): Promise<void> {
    if (!(fileSystem instanceof BrowserFileSystem)) {
      throw new SyncOperationError(
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
      throw new SyncOperationError(
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
          throw new SyncOperationError(
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
      throw new SyncOperationError(
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
        throw new SyncOperationError(
          `Failed to read file ${path}: ${error}`,
          "CONTENT_RETRIEVAL_FAILED"
        );
      }
    }
    return contents;
  }

  async notifyIncomingChanges(): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    this.status = "notifying";
    await this.fileSystem.lock(30000, "Sync in progress");
  }

  async syncComplete(): Promise<boolean> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
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
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    this.watchCallback = callback;
    this.lastWatchTimestamp = Date.now();

    // Schedule the first check
    this.scheduleNextCheck();
  }

  private scheduleNextCheck(): void {
    if (this.watchCallback === null) return; // Don't schedule if watching was stopped

    this.watchTimeout = globalThis.setTimeout(async () => {
      if (this.isCheckingForChanges) {
        // If a check is already in progress, schedule the next one
        this.scheduleNextCheck();
        return;
      }

      this.isCheckingForChanges = true;
      try {
        const changes = await this.checkForChanges();
        if (changes.length > 0 && this.watchCallback) {
          this.pendingChanges.push(...changes);
          this.watchCallback(changes);
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new SyncOperationError(
            `Failed to watch directory: ${error.message}`,
            "WATCH_FAILED"
          );
        }
        throw error;
      } finally {
        this.isCheckingForChanges = false;
        // Schedule the next check after this one completes
        this.scheduleNextCheck();
      }
    }, 1000);
  }

  async unwatch(): Promise<void> {
    if (this.watchTimeout !== null) {
      globalThis.clearTimeout(this.watchTimeout);
      this.watchTimeout = null;
    }
    this.watchCallback = null;
    this.pendingChanges = [];
    this.isCheckingForChanges = false;
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
            try {
              if (!this.fileSystem) continue;
              const metadata = await this.fileSystem.getMetadata(entry.path);
              changes.push({
                path: entry.path,
                type: "create",
                sourceTarget: this.id,
                lastModified: currentTimestamp,
                hash: metadata.hash,
                size: metadata.size
              });
            } catch {
              // If we can't get metadata, skip this file
              continue;
            }
          } else if (lastKnown.mtimeMs < stats.lastModified) {
            // Modified file
            try {
              if (!this.fileSystem) continue;
              const metadata = await this.fileSystem.getMetadata(entry.path);
              changes.push({
                path: entry.path,
                type: "modify",
                sourceTarget: this.id,
                lastModified: currentTimestamp,
                hash: metadata.hash,
                size: metadata.size
              });
            } catch {
              // If we can't get metadata, skip this file
              continue;
            }
          }
        }
      };

      // Start processing from root
      await processDirectory("/");

      // Check for deleted files
      for (const [path] of this.lastKnownFiles) {
        if (!currentFiles.has(path)) {
          changes.push({
            path,
            type: "delete",
            sourceTarget: this.id,
            lastModified: currentTimestamp,
            hash: "",
            size: 0
          });
        }
      }

      // Update last known state
      this.lastKnownFiles = currentFiles;
      this.lastWatchTimestamp = currentTimestamp;

      return changes;
    } catch (error) {
      if (error instanceof Error) {
        throw new SyncOperationError(
          `Failed to check for changes: ${error.message}`,
          "WATCH_FAILED"
        );
      }
      throw error;
    }
  }

  async getMetadata(paths: string[]): Promise<FileMetadata[]> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    const metadata: FileMetadata[] = [];
    for (const path of paths) {
      try {
        const fileMetadata = await this.fileSystem.getMetadata(path);
        metadata.push(fileMetadata);
      } catch (error) {
        throw new SyncOperationError(
          `Failed to get metadata for ${path}: ${error}`,
          "METADATA_RETRIEVAL_FAILED"
        );
      }
    }
    return metadata;
  }
  async getFileContent(path: string): Promise<FileContentStream> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    try {
      const metadata = await this.fileSystem.getMetadata(path);
      const content = await this.fileSystem.readFile(path);

      return {
        metadata,
        getReader: () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue({
                content,
                chunkIndex: 0,
                totalChunks: 1,
                chunkHash: metadata.hash
              });
              controller.close();
            }
          });
          return stream.getReader();
        },
        close: async () => {
          /* No cleanup needed */
        }
      };
    } catch (error) {
      throw new SyncOperationError(
        `Failed to get file content: ${error}`,
        "CONTENT_RETRIEVAL_FAILED"
      );
    }
  }

  async listDirectory(path: string): Promise<FileSystemItem[]> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    try {
      return await this.fileSystem.listDirectory(path);
    } catch (error) {
      throw new SyncOperationError(
        `Failed to list directory: ${error}`,
        "CONTENT_RETRIEVAL_FAILED"
      );
    }
  }

  async applyFileChange(
    metadata: FileMetadata,
    contentStream: FileContentStream
  ): Promise<FileConflict | null> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    this.status = "syncing";

    try {
      // Check for existence and potential conflicts
      const exists = await this.fileSystem.exists(metadata.path);
      if (exists) {
        const existingMetadata = await this.getMetadata([metadata.path]);
        const existingFile = existingMetadata[0];
        if (existingFile && existingFile.hash !== metadata.hash) {
          return {
            path: metadata.path,
            sourceTarget: this.id,
            targetId: this.id,
            timestamp: Date.now()
          };
        }
      }

      // Read all chunks using the Web Streams reader
      const reader = contentStream.getReader();
      let fullContent = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullContent += value.content;
        }
      } finally {
        reader.releaseLock();
      }

      // Apply the change
      await this.fileSystem.writeFile(metadata.path, fullContent);
      return null;
    } catch (error) {
      throw new SyncOperationError(
        `Failed to apply change to ${metadata.path}: ${error}`,
        "APPLY_FAILED"
      );
    }
  }
}
