import type {
  FileSystem,
  LockState,
  FileMetadata,
  FileContentStream,
  FileSystemItem
} from "./file-system";

/**
 * Information about a file change
 */
export interface FileChangeInfo {
  /**
   * Path relative to workspace root
   */
  path: string;

  /**
   * Type of change
   */
  type: "create" | "modify" | "delete";

  /**
   * Hash of the file content
   */
  hash: string;

  /**
   * Size in bytes
   */
  size: number;

  /**
   * Last modification time
   */
  lastModified: number;

  /**
   * Source target that detected the change
   */
  sourceTarget: string;
}

/**
 * Complete file change with content
 */
export interface FileChange extends FileChangeInfo {
  content: string;
}

/**
 * Represents a conflict during sync
 */
export interface FileConflict {
  path: string;
  sourceTarget: string;
  targetId: string;
  timestamp: number;
}

/**
 * Target state information
 */
export interface TargetState {
  id: string;
  type: "browser" | "local" | "container" | "browser-native";
  lockState: LockState;
  pendingChanges: number;
  lastSyncTime?: number;
  status: TargetStateType;
  error?: string | undefined;
}

/**
 * Possible states of the sync target
 */
export type TargetStateType =
  | "uninitialized"
  | "idle"
  | "collecting"
  | "syncing"
  | "error";

/**
 * Valid state transitions for the sync target
 */
type TargetStateTransition =
  | { from: "uninitialized"; to: "idle"; via: "initialize" }
  | { from: "idle"; to: "collecting"; via: "collect" }
  | { from: "collecting"; to: "syncing"; via: "sync" }
  | { from: "syncing"; to: "idle"; via: "finishSync" }
  | { from: "collecting" | "syncing"; to: "error"; via: "error" }
  | { from: "error"; to: "idle"; via: "recover" };

export const VALID_TARGET_STATE_TRANSITIONS: TargetStateTransition[] = [
  { from: "uninitialized", to: "idle", via: "initialize" },
  { from: "idle", to: "collecting", via: "collect" },
  { from: "collecting", to: "syncing", via: "sync" },
  { from: "syncing", to: "idle", via: "finishSync" },
  { from: "collecting", to: "error", via: "error" },
  { from: "syncing", to: "error", via: "error" },
  { from: "error", to: "idle", via: "recover" }
];

/**
 * Core sync target interface
 */
export interface SyncTarget {
  id: string;
  type: "browser" | "local" | "container";

  /**
   * Initialize target with file system
   * @throws {Error} if initialization fails
   */
  initialize(fileSystem: FileSystem, isPrimary: boolean): Promise<void>;

  /**
   * Prepare target for incoming changes and lock operations
   * @throws {Error} if target cannot be locked
   */
  notifyIncomingChanges(paths: string[]): Promise<void>;

  /**
   * Apply a file change to this target
   * @param changeInfo Information about the change to apply
   * @param contentStream Optional content stream for create/update operations
   * @returns FileConflict if there is a conflict, null otherwise
   * @throws {Error} if change cannot be applied
   */
  applyFileChange(
    changeInfo: FileChangeInfo,
    contentStream?: FileContentStream
  ): Promise<FileConflict | null>;

  /**
   * Complete sync operation and unlock target
   * @returns true if sync completed successfully
   * @throws {Error} if sync cannot be completed
   */
  syncComplete(): Promise<boolean>;

  /**
   * Get metadata for files
   * @throws {Error} if metadata cannot be retrieved
   */
  getMetadata(paths: string[]): Promise<FileMetadata[]>;

  /**
   * Get content stream for a file
   * @throws {Error} if file not found or cannot be read
   */
  getFileContent(path: string): Promise<FileContentStream>;

  /**
   * List contents of a directory
   * @throws {Error} if directory cannot be listed
   */
  listDirectory(path: string): Promise<FileSystemItem[]>;

  /**
   * Get current target state
   */
  getState(): TargetState;

  /**
   * Watch for changes
   * @param callback Function to call when changes are detected
   * @param options Options for the watcher
   */
  watch(
    callback: (changes: FileChangeInfo[]) => void,
    options: WatcherOptions
  ): Promise<void>;

  /**
   * Stop watching for changes
   */
  unwatch(): Promise<void>;

  /**
   * Recover from error state
   */
  recover(): Promise<void>;
}

export class SyncOperationError extends Error {
  constructor(
    message: string,
    public code:
      | "INITIALIZATION_FAILED"
      | "FILE_NOT_FOUND"
      | "CONTENT_MISMATCH"
      | "STREAM_ERROR"
      | "METADATA_RETRIEVAL_FAILED"
      | "CONTENT_RETRIEVAL_FAILED"
      | "APPLY_FAILED"
      | "WATCH_FAILED"
  ) {
    super(message);
    this.name = "SyncOperationError";
  }
}

/**
 * Interface for a file watcher registration
 */
export interface FileWatcher {
  /** Unique identifier for this watcher */
  id: string;
  /** Callback function to be called when changes occur */
  callback: (changes: FileChangeInfo[]) => void;
  /** Priority of the watcher. Higher priority watchers are called first */
  priority: number;
  /** Optional filter function to filter changes */
  filter?: (change: FileChangeInfo) => boolean;
  /** Metadata about the watcher */
  metadata?: {
    /** Component or module that registered the watcher */
    registeredBy: string;
    /** When the watcher was registered */
    registeredAt: number;
    /** Last time the watcher was executed */
    lastExecuted?: number;
    /** Number of times the watcher has been executed */
    executionCount: number;
    /** Additional metadata */
    [key: string]: any;
  };
}

/**
 * Options for file system watchers
 */
export interface WatcherOptions {
  /**
   * Priority level for this watcher
   * Higher priority watchers are notified first
   */
  priority: number;

  /**
   * Metadata about the watcher
   */
  metadata: {
    /**
     * Component that registered the watcher
     */
    registeredBy: string;

    /**
     * Type of watcher
     */
    type?: string;

    /**
     * Additional metadata
     */
    [key: string]: any;
  };

  /**
   * Optional filter function to only receive specific changes
   */
  filter?: (change: FileChangeInfo) => boolean;
}

/**
 * Constants for watcher priorities
 */
export const WATCHER_PRIORITIES = {
  /** Sync manager watchers run first */
  SYNC_MANAGER: 100,
  /** Error handlers run second */
  ERROR_HANDLER: 50,
  /** UI updates run last */
  UI_UPDATES: 0,
  /** Default priority for other watchers */
  OTHER: 0
} as const;
