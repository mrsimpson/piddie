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

declare const globalThis: {
  setInterval(callback: () => void, ms: number): number;
  clearInterval(id: number): void;
};

export class BrowserNativeSyncTarget implements SyncTarget {
  readonly type = "browser";
  readonly id: string;

  private fileSystem?: FileSystem;
  private state: TargetState;
  private watchIntervalId: number | null = null;
  private lastKnownFiles = new Map<string, { lastModified: number }>();

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

  async initialize(fileSystem: FileSystem): Promise<void> {
    if (!(fileSystem instanceof BrowserNativeFileSystem)) {
      throw new Error(
        "BrowserNativeSyncTarget requires BrowserNativeFileSystem"
      );
    }
    this.fileSystem = fileSystem;
    await this.fileSystem.initialize();
    this.state = {
      id: this.id,
      type: this.type,
      status: "idle",
      lockState: { isLocked: false },
      pendingChanges: 0
    };
  }

  async notifyIncomingChanges(): Promise<void> {
    if (!this.fileSystem) throw new Error("Not initialized");

    // Lock the file system during sync
    await this.fileSystem.lock(30000, "Sync in progress");
    this.state = {
      ...this.state,
      status: "notifying"
    };
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

    // Check for conflicts
    const exists = await this.fileSystem.exists(metadata.path);
    if (exists) {
      const existingMetadata = await this.fileSystem.getMetadata(metadata.path);
      if (existingMetadata.hash !== metadata.hash) {
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

    // Setup interval to check for changes
    this.watchIntervalId = globalThis.setInterval(async () => {
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
        if (changes.length > 0) {
          callback(changes);
        }
      } catch (error) {
        console.error("Error watching for changes:", error);
      }
    }, 1000);
  }

  async unwatch(): Promise<void> {
    if (this.watchIntervalId !== null) {
      globalThis.clearInterval(this.watchIntervalId);
      this.watchIntervalId = null;
    }
  }

  getState(): TargetState {
    return this.state;
  }
}
