import type {
  FileSystem,
  SyncTarget,
  WatcherOptions
} from "@piddie/shared-types";

/**
 * Represents a synchronized file system with its associated sync target
 */
export interface SynchronizedFileSystem {
  /** The file system instance */
  fileSystem: FileSystem;
  /** The sync target initialized with this file system */
  syncTarget: SyncTarget;
  /** Display title for the UI */
  title: string;
  /** Unique identifier for this synchronized system */
  id: string;
  /** Options for the file watcher */
  watcherOptions?: Omit<WatcherOptions, "callback">;
}

/**
 * Creates a synchronized file system with the given configuration
 */
export async function createSynchronizedFileSystem(config: {
  id: string;
  title: string;
  fileSystem: FileSystem;
  syncTarget: SyncTarget;
  watcherOptions?: Omit<WatcherOptions, "callback">;
}): Promise<SynchronizedFileSystem> {
  return {
    id: config.id,
    title: config.title,
    fileSystem: config.fileSystem,
    syncTarget: config.syncTarget,
    watcherOptions: config.watcherOptions
  };
}
