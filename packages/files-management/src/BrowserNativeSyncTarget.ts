import type {
  FileSystem,
  SyncTarget,
  TargetState,
  FileMetadata,
  FileContentStream,
  FileConflict,
  FileChangeInfo,
  FileSystemItem
} from "@piddie/shared-types";
import { BrowserNativeFileSystem } from "./BrowserNativeFileSystem";
import { SyncOperationError } from "@piddie/shared-types";

declare const globalThis: {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
};

export class BrowserNativeSyncTarget implements SyncTarget {
  readonly type = "browser";
  readonly id: string;

  private fileSystem?: FileSystem;
  private state: TargetState;
  private watchTimeout: ReturnType<typeof setTimeout> | null = null;
  private isCheckingForChanges = false;
  private watchCallback: ((changes: FileChangeInfo[]) => void) | null = null;
  private lastKnownFiles = new Map<string, { lastModified: number }>();
  private isInitialSync = false;
  private isPrimaryTarget = true;

  constructor(targetId: string) {
    this.id = targetId;
    this.state = {
      id: this.id,
      type: this.type,
      status: "error",
      error: "Not initialized",
      lockState: { isLocked: false },
      pendingChanges: 0
    };
  }

  async initialize(fileSystem: FileSystem, isPrimary: boolean): Promise<void> {
    if (!(fileSystem instanceof BrowserNativeFileSystem)) {
      throw new Error(
        "BrowserNativeSyncTarget requires BrowserNativeFileSystem"
      );
    }
    this.fileSystem = fileSystem;
    await this.fileSystem.initialize();
    this.isPrimaryTarget = isPrimary;
    this.isInitialSync = !isPrimary;
    this.state = {
      id: this.id,
      type: this.type,
      status: "idle",
      lockState: { isLocked: false },
      pendingChanges: 0
    };
  }

  async notifyIncomingChanges(paths?: string[]): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    // Lock for sync operations, allowing sync writes but blocking external writes
    await this.fileSystem.lock(30000, "Sync in progress", "sync");
    this.state.status = "syncing";
    this.state.lockState = this.fileSystem.getState().lockState;
  }

  async syncComplete(): Promise<boolean> {
    if (!this.fileSystem) throw new Error("Not initialized");

    // Unlock the file system
    await this.fileSystem.forceUnlock();
    this.state = {
      ...this.state,
      status: "idle",
      pendingChanges: 0
    };

    // After initial sync, capture current state as baseline
    if (this.isInitialSync) {
      const items = await this.fileSystem.listDirectory("/");
      const currentFiles = new Map<string, { lastModified: number }>();

      for (const item of items) {
        if (item.type === "file") {
          const metadata = await this.fileSystem.getMetadata(item.path);
          currentFiles.set(item.path, { lastModified: metadata.lastModified });
        }
      }

      this.lastKnownFiles = currentFiles;
    }

    // Mark initial sync as complete
    this.isInitialSync = false;
    return true;
  }

  async getMetadata(paths: string[]): Promise<FileMetadata[]> {
    if (!this.fileSystem) throw new Error("Not initialized");

    return Promise.all(paths.map((path) => this.fileSystem!.getMetadata(path)));
  }

  async getFileContent(path: string): Promise<FileContentStream> {
    if (!this.fileSystem) throw new Error("Not initialized");

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
  }

  async listDirectory(path: string): Promise<FileSystemItem[]> {
    if (!this.fileSystem) throw new Error("Not initialized");
    return this.fileSystem.listDirectory(path);
  }

  async applyFileChange(
    metadata: FileMetadata,
    contentStream: FileContentStream
  ): Promise<FileConflict | null> {
    if (!this.fileSystem) throw new Error("Not initialized");

    this.state = {
      ...this.state,
      status: "syncing"
    };

    // Handle deletion
    if (metadata.size === 0 && metadata.hash === "") {
      // This is a deletion
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

  async watch(callback: (changes: FileChangeInfo[]) => void): Promise<void> {
    if (!this.fileSystem) throw new Error("Not initialized");

    this.watchCallback = callback;
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
        const changes: FileChangeInfo[] = [];
        const currentFiles = new Map<string, { lastModified: number }>();

        // List all files in root directory
        const items = await this.fileSystem!.listDirectory("/");
        for (const item of items) {
          if (item.type === "file") {
            const metadata = await this.fileSystem!.getMetadata(item.path);
            currentFiles.set(item.path, {
              lastModified: metadata.lastModified
            });

            const lastKnown = this.lastKnownFiles.get(item.path);
            if (!lastKnown) {
              // New file
              changes.push({
                path: item.path,
                type: "create",
                hash: metadata.hash,
                size: metadata.size,
                lastModified: metadata.lastModified,
                sourceTarget: this.id
              });
            } else if (lastKnown.lastModified !== metadata.lastModified) {
              // Modified file
              changes.push({
                path: item.path,
                type: "modify",
                hash: metadata.hash,
                size: metadata.size,
                lastModified: metadata.lastModified,
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

        this.lastKnownFiles = currentFiles;
        if (changes.length > 0 && this.watchCallback) {
          // First notify sync manager
          await this.watchCallback(changes);
          // Update state with pending changes
          this.state = {
            ...this.state,
            pendingChanges: this.state.pendingChanges + changes.length
          };
        }
      } catch (error) {
        console.error("Error watching for changes:", error);
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
    this.isCheckingForChanges = false;
  }

  getState(): TargetState {
    return this.state;
  }
}
