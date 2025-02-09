import { watch } from "fs/promises";
import type {
  FileSystem,
  FileChangeInfo,
  SyncTargetType
} from "@piddie/shared-types";
import { NodeFileSystem } from "./NodeFileSystem";
import { SyncOperationError } from "@piddie/shared-types";
import { BaseSyncTarget } from "./BaseSyncTarget";

/**
 * Node.js implementation of the SyncTarget interface using native Node.js file watching
 */
export class NodeSyncTarget extends BaseSyncTarget {
  override readonly type: SyncTargetType = "node-fs";
  private watchAbortController: AbortController | null = null;
  private rootDir: string;

  constructor(targetId: string, rootDir: string) {
    super(targetId);
    this.rootDir = rootDir;
  }

  protected validateFileSystem(fileSystem: FileSystem): void {
    if (!(fileSystem instanceof NodeFileSystem)) {
      throw new SyncOperationError(
        "NodeSyncTarget requires NodeFileSystem",
        "INITIALIZATION_FAILED"
      );
    }
  }

  override async initialize(
    fileSystem: FileSystem,
    isPrimary: boolean
  ): Promise<void> {
    if (!(fileSystem instanceof NodeFileSystem)) {
      throw new SyncOperationError(
        "NodeSyncTarget requires NodeFileSystem",
        "INITIALIZATION_FAILED"
      );
    }
    this.fileSystem = fileSystem;
    this.isPrimaryTarget = isPrimary;
    await this.fileSystem.initialize();
    this.transitionTo("idle", "initialize");
  }

  override async watch(
    callback: (changes: FileChangeInfo[]) => void,
    options: {
      priority?: number;
      metadata?: {
        registeredBy: string;
        type?: string;
        [key: string]: unknown;
      };
      filter?: (change: FileChangeInfo) => boolean;
    }
  ): Promise<void> {
    // First register the watcher with the base class
    await super.watch(callback, options);

    if (!this.fileSystem) {
      throw new SyncOperationError(
        "FileSystem not initialized",
        "INITIALIZATION_FAILED"
      );
    }

    this.watchAbortController = new AbortController();

    try {
      const watcher = await watch(this.rootDir, {
        recursive: true,
        signal: this.watchAbortController.signal
      });

      for await (const event of watcher) {
        if (event.filename) {
          const filePath = event.filename;
          const exists = await this.fileSystem.exists(filePath);

          let change: FileChangeInfo;

          if (exists) {
            const metadata = await this.fileSystem.getMetadata(filePath);
            change = {
              path: filePath,
              type: event.eventType === "rename" ? "delete" : "modify",
              sourceTarget: this.id,
              lastModified: metadata.lastModified,
              hash: metadata.hash,
              size: metadata.size
            };
          } else if (event.eventType === "rename") {
            change = {
              path: filePath,
              type: "delete",
              sourceTarget: this.id,
              lastModified: Date.now(),
              hash: "",
              size: 0
            };
          } else {
            const metadata = await this.fileSystem.getMetadata(filePath);
            change = {
              path: filePath,
              type: "create",
              sourceTarget: this.id,
              lastModified: metadata.lastModified,
              hash: metadata.hash,
              size: metadata.size
            };
          }

          // Notify watchers through the base class mechanism
          await this.notifyWatchers([change]);
        }
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

  override async unwatch(): Promise<void> {
    this.watchAbortController?.abort();
    this.watchAbortController = null;
    await super.unwatch();
  }
}
