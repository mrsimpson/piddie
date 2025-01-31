import type { FileMetadata, FileSystem, SyncTarget, WatcherOptions } from '@piddie/shared-types'

/**
 * View model for a file or directory in the explorer
 */
export interface FileViewModel {
  /** Path of the file or directory */
  path: string
  /** Name to display in the UI */
  name: string
  /** Whether this is a directory */
  isDirectory: boolean
  /** File size in bytes */
  size: number
  /** Last modified timestamp */
  lastModified: number
  /** Whether the item is currently selected */
  selected?: boolean
  /** Original file metadata */
  metadata: FileMetadata
}

/**
 * Configuration for a file system panel
 */
export interface FileSystemPanelConfig {
  /** Title to show in the panel header */
  title: string
  /** Type of file system */
  type: 'browser' | 'native'
  /** Current directory path */
  currentPath: string
}

/**
 * Represents a synchronized file system with its associated sync target
 */
export interface SynchronizedFileSystem {
  /** The file system instance */
  fileSystem: FileSystem
  /** The sync target initialized with this file system */
  syncTarget: SyncTarget
  /** Display title for the UI */
  title: string
  /** Unique identifier for this synchronized system */
  id: string
  /** Options for the file watcher */
  watcherOptions?: Omit<WatcherOptions, 'callback'>
}

/**
 * Factory function to create a synchronized file system
 * This ensures the sync target is properly initialized with its file system
 */
export async function createSynchronizedFileSystem(params: {
  fileSystem: FileSystem
  syncTarget: SyncTarget
  title: string
  id: string
  watcherOptions?: Omit<WatcherOptions, 'callback'>
}): Promise<SynchronizedFileSystem> {
  return {
    ...params,
    // Freeze the object to prevent accidental modifications
    // that could break the relationship
  } as const
}
