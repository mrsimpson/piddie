import type {
  FileSystem,
  SyncTarget,
  TargetState,
  FileMetadata,
  FileContentStream,
  FileConflict,
  FileChangeInfo,
  FileSystemItem,
  TargetStateType
} from "@piddie/shared-types";
import { BrowserNativeFileSystem } from "./BrowserNativeFileSystem";
import { SyncOperationError } from "@piddie/shared-types";
import { VALID_TARGET_STATE_TRANSITIONS } from "@piddie/shared-types";

declare const globalThis: {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
};

export class BrowserNativeSyncTarget implements SyncTarget {
  readonly type = "browser";
  readonly id: string;

  private fileSystem?: FileSystem;
  private currentState: TargetStateType = "uninitialized";
  private error: string | null = null;
  private watchTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchCallback: ((changes: FileChangeInfo[]) => void) | null = null;
  private lastKnownFiles = new Map<string, { lastModified: number }>();
  private isInitialSync = false;
  private isPrimaryTarget = true;
  private pendingChanges: FileChangeInfo[] = [];
  private originalLastModified = new Map<string, number>();

  constructor(targetId: string) {
    this.id = targetId;
  }

  validateStateTransition(from: TargetStateType, to: TargetStateType, via: string): boolean {
    // If we're already in error state, only allow transitions from error to idle via initialize
    if (from === "error") {
      return to === "idle" && via === "initialize";
    }
    return VALID_TARGET_STATE_TRANSITIONS.some(
      t => t.from === from && t.to === to && t.via === via
    );
  }

  getCurrentState(): TargetStateType {
    return this.currentState;
  }

  transitionTo(newState: TargetStateType, via: string): void {
    // If we're already in error state, don't try to transition again unless it's to idle via initialize
    if (this.currentState === "error" && !(newState === "idle" && via === "initialize")) {
      return;
    }

    if (!this.validateStateTransition(this.currentState, newState, via)) {
      // Special case: when transitioning to error state, just set it
      if (newState === "error") {
        this.currentState = "error";
        debugger;
        return;
      }

      debugger;
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
      status: this.currentState,
      lockState: this.fileSystem?.getState().lockState ?? { isLocked: false },
      pendingChanges: this.pendingChanges.length,
      error: this.error ?? undefined
    };
  }

  private async getCurrentFilesState(): Promise<Map<string, { lastModified: number }>> {
    if (!this.fileSystem) {
      throw new SyncOperationError("FileSystem not initialized", "INITIALIZATION_FAILED");
    }

    const currentFiles = new Map<string, { lastModified: number }>();
    const items = await this.fileSystem.listDirectory("/");

    for (const item of items) {
      if (item.type === "file") {
        const metadata = await this.fileSystem.getMetadata(item.path);
        const lastModified = this.originalLastModified.get(item.path) ?? metadata.lastModified;
        currentFiles.set(item.path, { lastModified });
      }
    }

    return currentFiles;
  }

  async initialize(fileSystem: FileSystem, isPrimary: boolean): Promise<void> {
    // If already initialized in a non-error state, don't initialize again
    if (this.currentState !== "uninitialized" && this.currentState !== "error") {
      return;
    }

    if (!(fileSystem instanceof BrowserNativeFileSystem)) {
      this.transitionTo("error", "initialize");
      throw new SyncOperationError(
        "BrowserNativeSyncTarget requires BrowserNativeFileSystem",
        "INITIALIZATION_FAILED"
      );
    }

    try {
      // Start with clean state
      this.lastKnownFiles.clear();
      this.pendingChanges = [];
      if (this.watchTimeout) {
        globalThis.clearTimeout(this.watchTimeout);
        this.watchTimeout = null;
      }

      this.fileSystem = fileSystem;
      this.isPrimaryTarget = isPrimary;
      this.isInitialSync = !isPrimary;

      // Initialize the file system first
      await this.fileSystem.initialize();

      // Only transition to idle after successful initialization
      this.transitionTo("idle", "initialize");
      this.error = null;

      // Initialize baseline file state for primary target
      if (isPrimary) {
        this.lastKnownFiles = await this.getCurrentFilesState();
      }

    } catch (error) {
      this.transitionTo("error", "initialize");
      if (error instanceof Error) {
        this.error = error.message;
        throw new SyncOperationError(
          `Failed to initialize browser native sync target: ${error.message}`,
          "INITIALIZATION_FAILED"
        );
      }
      throw error;
    }
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
    this.transitionTo("collecting", "notifyIncomingChanges");
  }

  async syncComplete(): Promise<boolean> {
    if (!this.fileSystem) {
      this.transitionTo("error", "syncComplete");
      throw new SyncOperationError("Not initialized", "INITIALIZATION_FAILED");
    }

    try {
      // Unlock the file system
      await this.fileSystem.forceUnlock();

      // Only transition if we're not in error state
      if (this.currentState !== "error") {
        this.transitionTo("idle", "syncComplete");
      }

      // After initial sync, capture current state as baseline
      if (this.isInitialSync) {
        this.lastKnownFiles = await this.getCurrentFilesState();
      }

      // Mark initial sync as complete
      this.isInitialSync = false;
      return true;
    } catch (error) {
      this.transitionTo("error", "syncComplete");
      if (error instanceof Error) {
        this.error = error.message;
        throw new SyncOperationError(
          `Failed to complete sync: ${error.message}`,
          "INITIALIZATION_FAILED"
        );
      }
      throw error;
    }
  }

  async getMetadata(paths: string[]): Promise<FileMetadata[]> {
    if (!this.fileSystem) throw new Error("Not initialized");

    return Promise.all(paths.map(async (path) => {
      const metadata = await this.fileSystem!.getMetadata(path);
      // Use the original lastModified if available, otherwise use the file system's value
      const lastModified = this.originalLastModified.get(path) ?? metadata.lastModified;
      return {
        ...metadata,
        lastModified
      };
    }));
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
    if (!this.fileSystem) {
      this.transitionTo("error", "error");
      throw new SyncOperationError("Not initialized", "INITIALIZATION_FAILED");
    }

    try {
      // During initial sync or if we're in idle state, we need to transition through the proper states
      if (this.currentState === "idle") {
        // Lock for sync operations with sync mode to allow sync operations
        await this.fileSystem.lock(30000, "Sync in progress", "sync");
        // Transition through collecting to syncing
        this.transitionTo("collecting", "notifyIncomingChanges");
        this.transitionTo("syncing", "allChangesReceived");
      } else if (this.currentState !== "syncing") {
        throw new SyncOperationError(
          `Cannot apply changes in ${this.currentState} state`,
          "APPLY_FAILED"
        );
      }

      // Handle deletion
      if (metadata.size === 0 && metadata.hash === "") {
        // This is a deletion
        if (await this.fileSystem.exists(metadata.path)) {
          await this.fileSystem.deleteItem(metadata.path);
          // Remove from original lastModified map
          this.originalLastModified.delete(metadata.path);
        }
        return null;
      }

      // Check for conflicts only if file exists and is newer
      const exists = await this.fileSystem.exists(metadata.path);
      if (exists) {
        const existingMetadata = await this.fileSystem.getMetadata(metadata.path);
        const existingLastModified = this.originalLastModified.get(metadata.path) ?? existingMetadata.lastModified;
        if (existingLastModified > metadata.lastModified) {
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

      // Write content and store original lastModified
      await this.fileSystem.writeFile(metadata.path, content);
      this.originalLastModified.set(metadata.path, metadata.lastModified);
      return null;
    } catch (error) {
      this.transitionTo("error", "error");
      if (error instanceof SyncOperationError) {
        throw error;
      }
      throw new SyncOperationError(
        `Failed to apply change: ${error}`,
        "APPLY_FAILED"
      );
    }
  }

  async watch(callback: (changes: FileChangeInfo[]) => void): Promise<void> {
    if (!this.fileSystem) {
      this.transitionTo("error", "watch");
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    // Don't start watching if not in idle state
    if (this.currentState !== "idle") {
      throw new SyncOperationError(
        `Cannot start watching in ${this.currentState} state`,
        "INITIALIZATION_FAILED"
      );
    }

    try {
      // Just set up the watch callback without changing state
      this.watchCallback = callback;
      this.scheduleNextCheck();
    } catch (error) {
      this.transitionTo("error", "watch");
      if (error instanceof Error) {
        this.error = error.message;
        throw new SyncOperationError(
          `Failed to start watching: ${error.message}`,
          "WATCH_FAILED"
        );
      }
      throw error;
    }
  }

  private scheduleNextCheck(): void {
    if (this.watchCallback === null) return;

    this.watchTimeout = globalThis.setTimeout(async () => {
      // Don't check for changes if not in a valid state
      if (!["idle", "collecting", "syncing"].includes(this.currentState)) {
        this.scheduleNextCheck();
        return;
      }

      // Skip if already collecting changes
      if (this.currentState === "collecting") {
        this.scheduleNextCheck();
        return;
      }

      // Skip change detection only for secondary targets during initial sync
      if (this.isInitialSync && !this.isPrimaryTarget) {
        this.scheduleNextCheck();
        return;
      }

      try {
        // Lock filesystem and transition to collecting state
        await this.notifyIncomingChanges();

        const changes: FileChangeInfo[] = [];
        const currentFiles = await this.getCurrentFilesState();

        // Check for new or modified files
        for (const [path, current] of currentFiles) {
          const lastKnown = this.lastKnownFiles.get(path);
          if (!lastKnown) {
            // New file
            const metadata = await this.fileSystem!.getMetadata(path);
            changes.push({
              path,
              type: "create",
              hash: metadata.hash,
              size: metadata.size,
              lastModified: current.lastModified,
              sourceTarget: this.id
            });
          } else if (lastKnown.lastModified !== current.lastModified) {
            // Modified file
            const metadata = await this.fileSystem!.getMetadata(path);
            changes.push({
              path,
              type: "modify",
              hash: metadata.hash,
              size: metadata.size,
              lastModified: current.lastModified,
              sourceTarget: this.id
            });
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
            // Remove from original lastModified map
            this.originalLastModified.delete(path);
          }
        }

        this.transitionTo("syncing", "allChangesReceived");

        this.lastKnownFiles = currentFiles;
        if (changes.length > 0 && this.watchCallback) {
          try {
            // First notify sync manager
            await this.watchCallback(changes);
            // Update state with pending changes
            this.pendingChanges = [...this.pendingChanges, ...changes];
          } catch (callbackError) {
            // Log callback error but don't transition to error state
            console.error("Error in watch callback:", callbackError);
          }
        }
      } catch (error) {
        // Log error but don't transition to error state to allow recovery
        console.error("Error watching for changes:", error);
      } finally {
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

    // If we were in collecting state, transition back to idle
    if (this.currentState === "collecting") {
      this.transitionTo("idle", "unwatch");
    }
  }
}
