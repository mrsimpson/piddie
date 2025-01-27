import { watch } from "fs/promises";
import type {
  SyncTarget,
  FileSystem,
  FileChangeInfo,
  FileChange,
  FileConflict,
  TargetState,
  FileMetadata,
  FileContentStream
} from "@piddie/shared-types";
import { NodeFileSystem } from "./NodeFileSystem";
import { SyncOperationError } from "@piddie/shared-types";

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
      throw new SyncOperationError(
        "NodeSyncTarget requires NodeFileSystem",
        "INITIALIZATION_FAILED"
      );
    }
    this.fileSystem = fileSystem;
    await this.fileSystem.initialize();
  }

  async notifyIncomingChanges(paths: string[]): Promise<void> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    // Lock the file system during sync
    await this.fileSystem.lock(30000, "Sync in progress");
    this.status = "notifying";

    // Verify all paths exist
    for (const path of paths) {
      if (!(await this.fileSystem.exists(path))) {
        throw new SyncOperationError(
          `Path not found: ${path}`,
          "FILE_NOT_FOUND"
        );
      }
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
        // Convert FileSystemItem to FileMetadata
        metadata.push({
          path: fileMetadata.path,
          type: "file",
          hash: await this.fileSystem.getMetadata(path).then((m) => m.hash),
          size: await this.fileSystem.getMetadata(path).then((m) => m.size),
          lastModified: fileMetadata.lastModified
        });
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
      const fileMetadata = await this.fileSystem.getMetadata(path);
      const content = await this.fileSystem.readFile(path);

      // For now, we'll implement a simple single-chunk stream
      // In a real implementation, we'd chunk the content based on size
      let hasBeenRead = false;

      return {
        metadata: fileMetadata,
        async readNextChunk() {
          if (hasBeenRead) {
            return null;
          }
          hasBeenRead = true;
          return {
            content,
            chunkIndex: 0,
            totalChunks: 1,
            chunkHash: fileMetadata.hash
          };
        },
        async close() {
          // Nothing to clean up in this simple implementation
        }
      };
    } catch (error) {
      throw new SyncOperationError(
        `Failed to get content stream for ${path}: ${error}`,
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

      // Read all chunks and concatenate
      let fullContent = "";
      while (true) {
        const chunk = await contentStream.readNextChunk();
        if (!chunk) {
          break;
        }
        fullContent += chunk.content;
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

  async applyChanges(changes: FileChange[]): Promise<FileConflict[]> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
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

  async syncComplete(): Promise<boolean> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
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
      throw new SyncOperationError(
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

          if (exists) {
            // Get metadata for the changed file
            const metadata = await this.fileSystem.getMetadata(filePath);
            const change: FileChangeInfo = {
              path: filePath,
              type: event.eventType === "rename" ? "delete" : "modify",
              sourceTarget: this.id,
              lastModified: metadata.lastModified,
              hash: metadata.hash,
              size: metadata.size
            };
            this.pendingChanges.push(change);
          } else if (event.eventType === "rename") {
            // File was deleted - use empty hash and size 0
            const change: FileChangeInfo = {
              path: filePath,
              type: "delete",
              sourceTarget: this.id,
              lastModified: Date.now(),
              hash: "",
              size: 0
            };
            this.pendingChanges.push(change);
          } else {
            // New file created
            const metadata = await this.fileSystem.getMetadata(filePath);
            const change: FileChangeInfo = {
              path: filePath,
              type: "create",
              sourceTarget: this.id,
              lastModified: metadata.lastModified,
              hash: metadata.hash,
              size: metadata.size
            };
            this.pendingChanges.push(change);
          }
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
      throw new SyncOperationError(
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
