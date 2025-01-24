import type { FileSystem, LockState } from "./file-system";

/**
 * Information about a file change (without content)
 */
export interface FileChangeInfo {
  path: string;
  type: "create" | "modify" | "delete";
  sourceTarget: string;
  timestamp: number;
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
  incomingContent: string;
  currentContent: string;
  sourceTarget: string;
  targetId: string;
  timestamp: number;
}

/**
 * Target state information
 */
export interface TargetState {
  id: string;
  type: "browser" | "local" | "container";
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
   * Get content for specified paths from this target
   * @throws {Error} if content cannot be retrieved
   */
  getContents(paths: string[]): Promise<Map<string, string>>;

  /**
   * Apply changes to this target
   * @returns Conflicts if content differs from incoming changes
   */
  applyChanges(changes: FileChange[]): Promise<FileConflict[]>;

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

export class SyncError extends Error {
  constructor(
    message: string,
    public code:
      | "INITIALIZATION_FAILED"
      | "LOCK_FAILED"
      | "CONTENT_RETRIEVAL_FAILED"
      | "APPLY_FAILED"
      | "WATCH_FAILED"
  ) {
    super(message);
    this.name = "SyncError";
  }
}
