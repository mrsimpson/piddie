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
  FileSystemItem,
  TargetStateType
} from "@piddie/shared-types";
import { VALID_TARGET_STATE_TRANSITIONS } from "@piddie/shared-types";
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
  private currentState: TargetStateType = "uninitialized";
  private error: string | null = "Not initialized";
  private pendingChanges: FileChangeInfo[] = [];
  private watchCallback: ((changes: FileChangeInfo[]) => void) | null = null;
  private watchTimeout: ReturnType<typeof setTimeout> | null = null;
  private isCheckingForChanges = false;
  private lockState: TargetState["lockState"] = { isLocked: false };
  private isInitialSync = false;
  private isPrimaryTarget = true;
  readonly type = "browser";
  readonly id: string;
  lastWatchTimestamp: number;

  // Track the last known state of files
  private lastKnownFiles = new Map<string, { lastModified: number }>();

  constructor(id: string) {
    this.id = id;
    this.lastWatchTimestamp = Date.now();
  }

  validateStateTransition(from: TargetStateType, to: TargetStateType, via: string): boolean {
    return VALID_TARGET_STATE_TRANSITIONS.some(
      t => t.from === from && t.to === to && t.via === via
    );
  }

  getCurrentState(): TargetStateType {
    return this.currentState;
  }

  transitionTo(newState: TargetStateType, via: string): void {
    if (!this.validateStateTransition(this.currentState, newState, via)) {
      this.currentState = "error";
      throw new SyncOperationError(
        `Invalid state transition from ${this.currentState} to ${newState} via ${via}`,
        "INITIALIZATION_FAILED"
      );
    }
    this.currentState = newState;
  }

  getState(): TargetState {
    return {
      id: this.id,
      type: this.type,
      lockState: this.fileSystem?.getState().lockState ?? this.lockState,
      pendingChanges: this.pendingChanges.length,
      status: this.currentState,
      error: this.error ?? undefined
    };
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

  async initialize(fileSystem: FileSystem, isPrimary: boolean): Promise<void> {
    if (!(fileSystem instanceof BrowserFileSystem)) {
      this.transitionTo("error", "initialize");
      throw new SyncOperationError(
        "BrowserSyncTarget requires BrowserFileSystem",
        "INITIALIZATION_FAILED"
      );
    }

    try {
      this.fileSystem = fileSystem;
      this.isPrimaryTarget = isPrimary;
      // Only set isInitialSync true for secondary targets
      this.isInitialSync = !isPrimary;

      // Initialize the file system first
      await this.fileSystem.initialize();

      // Only transition to idle after successful initialization
      this.transitionTo("idle", "initialize");

      // Capture initial file state as baseline
      const items = await this.fileSystem.listDirectory("/");
      const currentFiles = new Map<string, { lastModified: number }>();

      for (const item of items) {
        if (item.type === "file") {
          const stats = await this.fileSystem.getMetadata(item.path);
          currentFiles.set(item.path, { lastModified: stats.lastModified });
        }
      }

      this.lastKnownFiles = currentFiles;
      this.error = null;
    } catch (error) {
      this.transitionTo("error", "initialize");
      if (error instanceof Error) {
        this.error = error.message;
        throw new SyncOperationError(
          `Failed to initialize browser sync target: ${error.message}`,
          "INITIALIZATION_FAILED"
        );
      }
      throw error;
    }
  }

  async applyChanges(changes: FileChange[]): Promise<FileConflict[]> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    const conflicts: FileConflict[] = [];
    this.transitionTo("syncing", "APPLY_CHANGES_STARTED");

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

    // Lock for sync operations, allowing sync writes but blocking external writes
    await this.fileSystem.lock(30000, "Sync in progress", "sync");
    this.transitionTo("syncing", "SYNC_IN_PROGRESS");
    this.lockState = this.fileSystem.getState().lockState;

    // Clear all files if this is initial sync on secondary target
    if (this.isInitialSync && !this.isPrimaryTarget) {
      const items = await this.fileSystem.listDirectory("/");
      for (const item of items) {
        if (item.type === "file") {
          await this.fileSystem.deleteItem(item.path);
        }
      }
      // Clear the last known files state
      this.lastKnownFiles.clear();
    }
  }

  async syncComplete(): Promise<boolean> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    await this.fileSystem.forceUnlock();
    this.transitionTo("idle", "SYNC_COMPLETE");
    this.pendingChanges = [];

    // After initial sync, capture current state as baseline
    if (this.isInitialSync) {
      const items = await this.fileSystem.listDirectory("/");
      const currentFiles = new Map<string, { lastModified: number }>();

      for (const item of items) {
        if (item.type === "file") {
          const stats = await this.fileSystem.getMetadata(item.path);
          currentFiles.set(item.path, { lastModified: stats.lastModified });
        }
      }

      this.lastKnownFiles = currentFiles;
    }

    // Mark initial sync as complete
    this.isInitialSync = false;
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
    if (this.watchCallback === null) return;

    this.watchTimeout = globalThis.setTimeout(async () => {
      if (this.isCheckingForChanges) {
        this.scheduleNextCheck();
        return;
      }

      // Skip change detection only for secondary targets during initial sync
      if (this.isInitialSync && !this.isPrimaryTarget) {
        this.scheduleNextCheck();
        return;
      }

      this.isCheckingForChanges = true;
      try {
        const changes = await this.checkForChanges();
        if (changes.length > 0 && this.watchCallback) {
          // First notify sync manager
          await this.watchCallback(changes);
          // Only add to pending changes if callback succeeds
          this.pendingChanges.push(...changes);
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

  private async checkForChanges(): Promise<FileChangeInfo[]> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    const changes: FileChangeInfo[] = [];
    const currentFiles = new Map<string, { lastModified: number }>();

    // List all files in root directory
    const items = await this.fileSystem.listDirectory("/");
    for (const item of items) {
      if (item.type === "file") {
        const stats = await this.fileSystem.getMetadata(item.path);
        currentFiles.set(item.path, { lastModified: stats.lastModified });

        const lastKnown = this.lastKnownFiles.get(item.path);
        if (!lastKnown) {
          // New file
          changes.push({
            path: item.path,
            type: "create",
            hash: stats.hash,
            size: stats.size,
            lastModified: stats.lastModified,
            sourceTarget: this.id
          });
        } else if (lastKnown.lastModified !== stats.lastModified) {
          // Modified file
          changes.push({
            path: item.path,
            type: "modify",
            hash: stats.hash,
            size: stats.size,
            lastModified: stats.lastModified,
            sourceTarget: this.id
          });
        }
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

    // Update last known files
    this.lastKnownFiles = currentFiles;

    return changes;
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

    this.transitionTo("syncing", "APPLY_FILE_CHANGE_STARTED");

    // Handle deletion
    if (metadata.size === 0 && metadata.hash === "") {
      if (await this.fileSystem.exists(metadata.path)) {
        await this.fileSystem.deleteItem(metadata.path);
      }
      return null;
    }

    // Check for conflicts only if file exists and is newer
    const exists = await this.fileSystem.exists(metadata.path);
    if (exists) {
      const existingMetadata = await this.fileSystem.getMetadata(metadata.path);
      if (existingMetadata.lastModified > metadata.lastModified) {
        return {
          path: metadata.path,
          sourceTarget: this.id,
          targetId: this.id,
          timestamp: Date.now()
        };
      }
    }

    // Read content from stream
    const reader = contentStream.getReader();
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      content += value.content;
    }

    // Write content
    await this.fileSystem.writeFile(metadata.path, content);
    return null;
  }
}
