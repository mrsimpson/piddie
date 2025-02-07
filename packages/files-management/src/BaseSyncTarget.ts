import type {
  FileSystem,
  SyncTarget,
  TargetState,
  FileMetadata,
  FileContentStream,
  FileConflict,
  FileChangeInfo,
  FileSystemItem,
  TargetStateType,
  WatcherOptions
} from "@piddie/shared-types";
import { SyncOperationError } from "@piddie/shared-types";
import { VALID_TARGET_STATE_TRANSITIONS } from "@piddie/shared-types";
import { WatcherRegistry } from "./WatcherRegistry";
import { WATCHER_PRIORITIES } from "@piddie/shared-types";

interface KnownFileState {
  lastModified: number;
  hash: string;
}

/**
 * Base class for sync targets implementing common functionality
 */
export abstract class BaseSyncTarget implements SyncTarget {
  readonly id: string;
  abstract readonly type: "browser-native" | "browser-fs" | "local" | "container";

  protected fileSystem?: FileSystem;
  protected currentState: TargetStateType = "uninitialized";
  protected error: string | null = null;
  protected lastKnownFiles = new Map<string, KnownFileState>();
  protected isInitialSync = false;
  protected isPrimaryTarget = true;
  protected pendingChanges: FileChangeInfo[] = [];
  protected watcherRegistry = new WatcherRegistry();

  constructor(targetId: string) {
    this.id = targetId;
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
      const fromState = this.currentState;
      this.currentState = "error";
      throw new SyncOperationError(
        `Invalid state transition from ${fromState} to ${newState} via ${via}`,
        "INITIALIZATION_FAILED"
      );
    }
    this.currentState = newState;
  }

  getState(): TargetState {
    return {
      id: this.id,
      type: this.type,
      status: this.currentState,
      lockState: this.fileSystem?.getState().lockState ?? { isLocked: false },
      pendingChanges: this.pendingChanges.length,
      error: this.error ?? undefined
    };
  }

  // Protected State Actions
  protected async doCollect(paths: string[]): Promise<void> {
    try {
      if (!this.fileSystem) {
        throw new SyncOperationError(
          "Not initialized",
          "INITIALIZATION_FAILED"
        );
      }

      // Lock in sync mode to allow modifications during sync
      await this.fileSystem.lock(30000, "Sync in progress", "sync");

      // Process files in batches to avoid memory issues with large file sets
      const BATCH_SIZE = 50;
      const currentFiles = new Map<
        string,
        { lastModified: number; hash: string }
      >();
      let batchError: Error | null = null;

      try {
        for (let i = 0; i < paths.length && !batchError; i += BATCH_SIZE) {
          const batch = paths.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map(async (path) => {
              try {
                if (await this.fileSystem!.exists(path)) {
                  const metadata = await this.fileSystem!.getMetadata(path);
                  const knownState = this.lastKnownFiles.get(path);
                  const lastModified =
                    knownState?.lastModified ?? metadata.lastModified;
                  currentFiles.set(path, {
                    lastModified,
                    hash: metadata.hash
                  });
                  return { path, metadata, exists: true };
                }
                return { path, exists: false };
              } catch (error) {
                return {
                  path,
                  error: new SyncOperationError(
                    `Failed to get metadata for ${path}: ${error instanceof Error ? error.message : "Unknown error"}`,
                    "METADATA_RETRIEVAL_FAILED"
                  )
                };
              }
            })
          );

          // Check for errors in the batch
          for (const result of batchResults) {
            if (
              result.status === "rejected" ||
              (result.status === "fulfilled" && "error" in result.value)
            ) {
              const error =
                result.status === "rejected"
                  ? result.reason
                  : result.value.error;
              batchError = error;
              break;
            }
          }
        }

        // If we encountered any error during processing, throw it after the loop
        if (batchError) {
          throw batchError;
        }

        // Update lastKnownFiles if we're primary or during initial sync
        if (this.isPrimaryTarget || this.isInitialSync) {
          this.lastKnownFiles = currentFiles;
        }

        this.transitionTo("collecting", "collect");
      } catch (error) {
        // Ensure we unlock and transition to error state
        await this.fileSystem.forceUnlock();
        this.currentState = "error";
        this.error = error instanceof Error ? error.message : "Unknown error";
        throw error;
      }
    } catch (error) {
      // Ensure we're in error state and need recovery
      this.currentState = "error";
      this.error = error instanceof Error ? error.message : "Unknown error";
      throw error;
    }
  }

  protected async doSync(
    changeInfo: FileChangeInfo,
    contentStream?: FileContentStream
  ): Promise<FileConflict | null> {
    if (!this.fileSystem) {
      throw new SyncOperationError("Not initialized", "INITIALIZATION_FAILED");
    }

    try {
      // Only transition to syncing if we're in collecting state
      if (this.currentState === "collecting") {
        this.transitionTo("syncing", "sync");
      } else if (this.currentState !== "syncing") {
        throw new SyncOperationError(
          `Cannot sync in state ${this.currentState}`,
          "INITIALIZATION_FAILED"
        );
      }

      // Handle file deletion
      if (changeInfo.type === "delete") {
        if (await this.fileSystem.exists(changeInfo.path)) {
          await this.fileSystem.deleteItem(changeInfo.path, {}, true);
          this.lastKnownFiles.delete(changeInfo.path);
        }
        return null;
      }

      // For creates/updates, we need a content stream
      if (!contentStream) {
        throw new SyncOperationError(
          "Content stream required for create/update operations",
          "APPLY_FAILED"
        );
      }

      const metadata = contentStream.metadata;

      // Handle directory creation
      if (metadata.type === "directory") {
        try {
          if (!(await this.fileSystem.exists(metadata.path))) {
            await this.fileSystem.createDirectory(metadata.path, {}, true);
            // Store the original timestamp for the directory
            this.lastKnownFiles.set(metadata.path, {
              lastModified: metadata.lastModified,
              hash: "" // Directories don't have a hash
            });
          } else {
            // Update timestamp if directory exists
            const existingMetadata = await this.fileSystem.getMetadata(
              metadata.path
            );
            if (existingMetadata.lastModified !== metadata.lastModified) {
              this.lastKnownFiles.set(metadata.path, {
                lastModified: metadata.lastModified,
                hash: "" // Directories don't have a hash
              });
            }
          }
          return null;
        } catch (error) {
          this.currentState = "error";
          this.error = `Failed to create directory ${metadata.path}: ${error instanceof Error ? error.message : "Unknown error"}`;
          throw new SyncOperationError(this.error, "APPLY_FAILED");
        }
      }

      // Ensure parent directory exists for files
      const parentDir = metadata.path.split("/").slice(0, -1).join("/") || "/";
      if (!(await this.fileSystem.exists(parentDir))) {
        await this.fileSystem.createDirectory(parentDir, {}, true);
        // Get parent directory metadata from source if available
        try {
          const parentMetadata = await this.fileSystem.getMetadata(parentDir);
          this.lastKnownFiles.set(parentDir, {
            lastModified: parentMetadata.lastModified,
            hash: "" // Directories don't have a hash
          });
        } catch (error) {
          console.warn(
            `Failed to get metadata for parent directory ${parentDir}:`,
            error
          );
        }
      }

      // Read and apply content for files
      try {
        const reader = contentStream.getReader();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += value.content;
        }

        await this.fileSystem.writeFile(metadata.path, content, true);
        this.lastKnownFiles.set(metadata.path, {
          lastModified: metadata.lastModified,
          hash: metadata.hash
        });
        return null;
      } catch (error) {
        // Ensure we transition to error state on content application failure
        this.currentState = "error";
        this.error = `Failed to apply content for ${metadata.path}: ${error instanceof Error ? error.message : "Unknown error"}`;
        throw new SyncOperationError(this.error, "APPLY_FAILED");
      }
    } catch (error) {
      // Ensure we're in error state and need recovery
      this.currentState = "error";
      this.error = error instanceof Error ? error.message : "Unknown error";
      throw error;
    }
  }

  protected async doFinishSync(): Promise<boolean> {
    try {
      if (!this.fileSystem) {
        throw new SyncOperationError(
          "Not initialized",
          "INITIALIZATION_FAILED"
        );
      }

      await this.fileSystem.forceUnlock();

      // Update lastKnownFiles after sync is complete
      if (this.isPrimaryTarget || this.isInitialSync) {
        this.lastKnownFiles = await this.getCurrentFilesState();
      }

      this.isInitialSync = false;
      this.transitionTo("idle", "finishSync");
      return true;
    } catch (error) {
      this.currentState = "error";
      this.error = error instanceof Error ? error.message : "Unknown error";
      throw error;
    }
  }

  protected async doRecover(): Promise<void> {
    try {
      this.error = null;
      if (this.fileSystem) {
        await this.fileSystem.forceUnlock();
      }
      this.transitionTo("idle", "recover");
    } catch (error) {
      this.currentState = "error";
      this.error = error instanceof Error ? error.message : "Unknown error";
      throw error;
    }
  }

  // Public Interface Methods
  abstract initialize(
    fileSystem: FileSystem,
    isPrimary: boolean
  ): Promise<void>;

  async notifyIncomingChanges(paths: string[]): Promise<void> {
    await this.doCollect(paths);
  }

  async applyFileChange(
    changeInfo: FileChangeInfo,
    contentStream?: FileContentStream
  ): Promise<FileConflict | null> {
    console.debug(`[BaseSyncTarget] Applying change:`, changeInfo);
    return this.doSync(changeInfo, contentStream);
  }

  async syncComplete(): Promise<boolean> {
    return this.doFinishSync();
  }

  async recover(): Promise<void> {
    await this.doRecover();
  }

  async getMetadata(paths: string[]): Promise<FileMetadata[]> {
    if (!this.fileSystem) throw new Error("Not initialized");

    // Get unique directory paths from file paths
    const dirPaths = new Set<string>();
    paths.forEach((path) => {
      // Split path into segments and build directory paths
      const segments = path.split("/").filter(Boolean);
      let currentPath = "";
      for (let i = 0; i < segments.length - 1; i++) {
        currentPath = currentPath
          ? `${currentPath}/${segments[i]}`
          : `/${segments[i]}`;
        dirPaths.add(currentPath);
      }
    });

    // Combine file paths and directory paths
    const allPaths = [...paths, ...dirPaths];

    return Promise.all(
      allPaths.map(async (path) => {
        const metadata = await this.fileSystem!.getMetadata(path);
        const knownState = this.lastKnownFiles.get(path);
        return {
          ...metadata,
          lastModified: knownState?.lastModified ?? metadata.lastModified
        };
      })
    );
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

  async watch(
    callback: (changes: FileChangeInfo[]) => void,
    options: {
      priority?: number;
      metadata?: {
        registeredBy: string;
        type?: string;
        [key: string]: unknown;
      };
      filter?: (change: FileChangeInfo) => boolean;
    } = {
        priority: WATCHER_PRIORITIES.OTHER,
        metadata: {
          registeredBy: "external",
          type: "other-watcher"
        }
      }
  ): Promise<void> {
    const watcherOptions: WatcherOptions = {
      priority: options.priority ?? WATCHER_PRIORITIES.OTHER,
      metadata: {
        registeredBy: options.metadata?.registeredBy ?? "external",
        type: options.metadata?.type ?? "other-watcher",
        ...options.metadata
      }
    };

    if (options.filter) {
      watcherOptions.filter = options.filter;
    }

    // Register the watcher with both options and callback
    await this.watcherRegistry.register(watcherOptions, callback);
  }

  async unwatch(): Promise<void> {
    this.watcherRegistry.clear();
  }

  protected async notifyWatchers(changes: FileChangeInfo[]): Promise<void> {
    if (this.watcherRegistry.hasWatchers()) {
      await this.watcherRegistry.notify(changes);
    }
  }

  protected async getCurrentFilesState(): Promise<Map<string, KnownFileState>> {
    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    const currentFiles = new Map<string, KnownFileState>();

    const scanDirectory = async (path: string): Promise<void> => {
      try {
        // First get metadata for the directory itself (except for root)
        if (path !== "/") {
          try {
            const dirMetadata = await this.fileSystem!.getMetadata(path);
            const knownState = this.lastKnownFiles.get(path);
            currentFiles.set(path, {
              lastModified:
                knownState?.lastModified ?? dirMetadata.lastModified,
              hash: "" // Directories don't have a hash
            });
          } catch (error) {
            console.warn(
              `Failed to get metadata for directory ${path}:`,
              error
            );
          }
        }

        const items = await this.fileSystem!.listDirectory(path);

        for (const item of items) {
          const fullPath = item.path;

          try {
            const metadata = await this.fileSystem!.getMetadata(fullPath);
            const knownState = this.lastKnownFiles.get(fullPath);

            // we need to forward the lastModified only if the file actually has got a new contents.
            // some filesystems (like S3) do not allow to update the lastModified timestamp, so we need to keep this a separate information
            const lastModified =
              knownState?.lastModified && knownState?.hash === metadata.hash
                ? knownState.lastModified
                : metadata.lastModified;
            currentFiles.set(fullPath, {
              lastModified,
              hash: metadata.hash
            });

            if (item.type === "directory") {
              await scanDirectory(fullPath);
            }
          } catch (error) {
            console.warn(`Failed to get metadata for ${fullPath}:`, error);
            continue;
          }
        }
      } catch (error) {
        throw new SyncOperationError(
          `Failed to scan directory ${path}: ${error instanceof Error ? error.message : "Unknown error"}`,
          "METADATA_RETRIEVAL_FAILED"
        );
      }
    };

    await scanDirectory("/");
    return currentFiles;
  }

  protected updateLastKnownFiles(
    currentFiles: Map<string, KnownFileState>
  ): void {
    // Create a new map with the correct type
    const newKnownFiles = new Map<string, KnownFileState>();
    for (const [path, state] of currentFiles) {
      newKnownFiles.set(path, {
        lastModified: state.lastModified,
        hash: state.hash
      });
    }
    this.lastKnownFiles = newKnownFiles;
  }
}
