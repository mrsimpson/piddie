import type {
  FileSystem,
  LockState,
  FileMetadata,
  FileContentStream
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
  status: "idle" | "collecting" | "notifying" | "syncing" | "error";
  error?: string;
}

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
  initialize(fileSystem: FileSystem): Promise<void>;

  /**
   * Prepare target for incoming changes and lock operations
   * @throws {Error} if target cannot be locked
   */
  notifyIncomingChanges(paths: string[]): Promise<void>;

  /**
   * Get metadata for specified paths from this target
   * @throws {Error} if metadata cannot be retrieved
   */
  getMetadata(paths: string[]): Promise<FileMetadata[]>;

  /**
   * Get content stream for a specific file
   * @throws {Error} if file not found or cannot be read
   */
  getFileContent(path: string): Promise<FileContentStream>;

  /**
   * Apply a single file change using streaming
   * @returns Conflict if content differs from incoming changes
   * @throws {Error} if stream operations fail
   */
  applyFileChange(
    metadata: FileMetadata,
    contentStream: FileContentStream
  ): Promise<FileConflict | null>;

  /**
   * Called when sync is complete
   * @returns true if target can be unlocked (no pending changes)
   */
  syncComplete(): Promise<boolean>;

  /**
   * Start watching for changes
   * @throws {Error} if watching cannot be started
   */
  watch(callback: (changes: FileChangeInfo[]) => void): Promise<void>;
  unwatch(): Promise<void>;

  /**
   * Get current target state
   */
  getState(): TargetState;
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
