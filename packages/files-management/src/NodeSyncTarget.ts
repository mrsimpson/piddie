import { watch } from "fs/promises";
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
import { NodeFileSystem } from "./NodeFileSystem";
import { SyncOperationError } from "@piddie/shared-types";
import { ReadableStream } from "node:stream/web";

/**
 * Node.js implementation of the SyncTarget interface
 */
export class NodeSyncTarget implements SyncTarget {
  public readonly type = "local" as const;
  private fileSystem?: NodeFileSystem;
  private watchAbortController: AbortController | null = null;
  private watchCallback: ((changes: FileChangeInfo[]) => void) | null = null;
  private pendingChanges: FileChangeInfo[] = [];
  private currentState: TargetStateType = "uninitialized";

  constructor(
    public readonly id: string,
    private rootDir: string
  ) {}
  recover(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  validateStateTransition(
    from: TargetStateType,
    to: TargetStateType,
    via: string
  ): boolean {
    return VALID_TARGET_STATE_TRANSITIONS.some(
      (t) => t.from === from && t.to === to && t.via === via
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
      lockState: this.fileSystem?.getState().lockState ?? { isLocked: false },
      pendingChanges: this.pendingChanges.length,
      status: this.currentState,
      error: this.currentState === "error" ? "Target in error state" : undefined
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

  async initialize(fileSystem: FileSystem): Promise<void> {
    if (!(fileSystem instanceof NodeFileSystem)) {
      this.transitionTo("error", "initialize");
      throw new SyncOperationError(
        "NodeSyncTarget requires NodeFileSystem",
        "INITIALIZATION_FAILED"
      );
    }

    try {
      this.fileSystem = fileSystem;
      await this.fileSystem.initialize();
      this.transitionTo("idle", "initialize");
    } catch (error) {
      this.transitionTo("error", "initialize");
      throw error;
    }
  }

  async notifyIncomingChanges(paths: string[]): Promise<void> {
    if (!this.fileSystem) {
      this.transitionTo("error", "notifyIncomingChanges");
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    try {
      // Lock the file system during sync
      await this.fileSystem.lock(30000, "Sync in progress");
      this.transitionTo("syncing", "notifyIncomingChanges");

      // Verify all paths exist
      for (const path of paths) {
        if (!(await this.fileSystem.exists(path))) {
          this.transitionTo("error", "notifyIncomingChanges");
          throw new SyncOperationError(
            `Path not found: ${path}`,
            "FILE_NOT_FOUND"
          );
        }
      }
    } catch (error) {
      this.transitionTo("error", "notifyIncomingChanges");
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
    metadata: FileChangeInfo,
    contentStream: FileContentStream
  ): Promise<FileConflict | null> {
    if (!this.fileSystem) {
      this.transitionTo("error", "applyFileChange");
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    try {
      this.transitionTo("syncing", "applyFileChange");

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
      this.transitionTo("error", "applyFileChange");
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
    this.currentState = "syncing"; // Set status to syncing when we start applying changes

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
      this.transitionTo("error", "syncComplete");
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    try {
      await this.fileSystem.forceUnlock();
      this.transitionTo("idle", "syncComplete");
      return true;
    } catch (error) {
      this.transitionTo("error", "syncComplete");
      throw error;
    }
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
}
