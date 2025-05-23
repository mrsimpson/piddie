import type {
  FileChangeInfo,
  ResolutionType,
  SyncTarget,
  TargetState
} from "./files-sync-target";
import type { FileContentStream } from "./file-system";

/**
 * Target role in the sync process
 */
export type TargetRole = "primary" | "secondary";

/**
 * Registration options for a sync target
 */
export interface TargetRegistrationOptions {
  /**
   * Role of the target in sync process
   */
  role: TargetRole;
}

/**
 * Represents a pending sync operation for a specific target
 */
export interface PendingSyncForTarget {
  changes: FileChangeInfo[];
  timestamp: number;
  failedSync: boolean;
}

/**
 * Represents the state of pending sync operations
 */
export interface PendingSync {
  /**
   * Source target that originated the changes
   */
  sourceTargetId: string;

  /**
   * Map of target IDs to their pending changes
   */
  pendingByTarget: Map<string, PendingSyncForTarget>;
}

/**
 * Represents the current phase of synchronization
 */
export type SyncPhase =
  | "idle" // No sync in progress
  | "collecting" // Initial target collecting changes
  | "syncing" // Applying changes
  | "error"; // Error state

/**
 * Represents the current status of synchronization
 */
export interface SyncStatus {
  phase: SyncPhase;
  targets: Map<string, TargetState>;
  lastSyncTime?: number;
  currentFailure?: SyncFailure;
  failureHistory: SyncFailure[];
  pendingSync?: PendingSync;
}

/**
 * Represents a sync failure
 */
export interface SyncFailure {
  targetId: string;
  error: Error;
  phase: SyncPhase;
  affectedFiles: string[];
  retryCount: number;
  timestamp: number;
}

/**
 * Base interface for all sync progress events
 */
interface BaseSyncProgressEvent {
  /** Source target ID */
  sourceTargetId: string;
  /** Target ID being synced to */
  targetId: string;
  /** Timestamp of the event */
  timestamp: number;
}

/**
 * Progress event for file collection phase
 */
interface CollectingProgressEvent extends BaseSyncProgressEvent {
  type: "collecting";
  /** Total number of files to collect */
  totalFiles: number;
  /** Number of files collected so far */
  collectedFiles: number;
  /** Current file being processed */
  currentFile: string;
}

/**
 * Progress event for file sync phase
 */
interface SyncingProgressEvent extends BaseSyncProgressEvent {
  type: "syncing";
  /** Total number of files to sync */
  totalFiles: number;
  /** Number of files synced so far */
  syncedFiles: number;
  /** Current file being synced */
  currentFile: string;
}

/**
 * Progress event for file streaming
 */
interface StreamingProgressEvent extends BaseSyncProgressEvent {
  type: "streaming";
  /** Total size in bytes */
  totalBytes: number;
  /** Number of bytes transferred */
  processedBytes: number;
  /** File being streamed */
  currentFile: string;
}

/**
 * Progress event for sync completion
 */
interface CompletionProgressEvent extends BaseSyncProgressEvent {
  type: "completing";
  /** Total number of files processed */
  totalFiles: number;
  /** Number of files successfully synced */
  successfulFiles: number;
  /** Number of files that failed */
  failedFiles: number;
}

/**
 * Progress event for sync errors
 */
interface ErrorProgressEvent extends BaseSyncProgressEvent {
  type: "error";
  /** The file that caused the error */
  currentFile: string;
  /** The error that occurred */
  error: Error;
  /** Operation phase when error occurred */
  phase: "collecting" | "syncing" | "streaming";
}

/**
 * Union type of all possible progress events
 */
export type SyncProgressEvent =
  | CollectingProgressEvent
  | SyncingProgressEvent
  | StreamingProgressEvent
  | CompletionProgressEvent
  | ErrorProgressEvent;

/**
 * Progress event listener function type
 */
export type SyncProgressListener = (progress: SyncProgressEvent) => void;

/**
 * Possible states of the sync manager
 */
export type SyncManagerStateType =
  | "uninitialized"
  | "ready"
  | "syncing"
  | "resolving"
  | "conflict"
  | "error";

/**
 * Valid state transitions for the sync manager
 */
export type SyncManagerStateTransition =
  | { from: "uninitialized"; to: "ready"; via: "initialize" }
  | { from: "ready"; to: "syncing"; via: "changesDetected" }
  | { from: "syncing"; to: "ready"; via: "syncComplete" }
  | { from: "syncing"; to: "conflict"; via: "conflictDetected" }
  | { from: "conflict"; to: "resolving"; via: "confirmPrimarySync" }
  | { from: "resolving"; to: "ready"; via: "conflictResolved" }
  | { from: "resolving"; to: "ready"; via: "resolutionComplete" }
  | {
      from: "ready" | "syncing" | "conflict" | "resolving";
      to: "error";
      via: "error";
    }
  | { from: "error"; to: "ready"; via: "recovery" };

export const VALID_SYNC_MANAGER_TRANSITIONS: SyncManagerStateTransition[] = [
  { from: "uninitialized", to: "ready", via: "initialize" },
  { from: "ready", to: "syncing", via: "changesDetected" },
  { from: "syncing", to: "ready", via: "syncComplete" },
  { from: "syncing", to: "conflict", via: "conflictDetected" },
  { from: "conflict", to: "resolving", via: "confirmPrimarySync" },
  { from: "resolving", to: "ready", via: "conflictResolved" },
  { from: "resolving", to: "ready", via: "resolutionComplete" },
  { from: "ready", to: "error", via: "error" },
  { from: "syncing", to: "error", via: "error" },
  { from: "conflict", to: "error", via: "error" },
  { from: "resolving", to: "error", via: "error" },
  { from: "error", to: "ready", via: "recovery" }
];

/**
 * Service for managing file ignore patterns
 */
export interface IgnoreService {
  /**
   * Check if a path should be ignored
   * @param path The path to check
   * @returns true if the path should be ignored
   */
  isIgnored(path: string): boolean;

  /**
   * Set ignore patterns
   * @param patterns Array of gitignore-style patterns
   */
  setPatterns(patterns: string[]): void;

  /**
   * Get current patterns
   * @returns Array of current patterns
   */
  getPatterns(): string[];
}

/**
 * Core sync manager interface
 */
export interface SyncManager {
  /**
   * Initialize the sync manager
   * @param config Configuration for the sync manager
   * @param ignoreService Service for managing ignored files
   */
  initialize(ignoreService?: IgnoreService): Promise<void>;

  /**
   * Register a new sync target
   * @param target The target to register
   * @param options Registration options including target role
   * @throws {SyncManagerError} with code:
   *  - TARGET_ALREADY_EXISTS if target with same id already registered
   *  - PRIMARY_TARGET_EXISTS if trying to register primary when one exists
   */
  registerTarget(
    target: SyncTarget,
    options: TargetRegistrationOptions
  ): Promise<void>;

  /**
   * Unregister a sync target
   * @param targetId ID of the target to unregister
   */
  unregisterTarget(targetId: string): Promise<void>;

  /**
   * Get the primary target
   * @throws {SyncManagerError} if no primary target registered
   */
  getPrimaryTarget(): SyncTarget;

  /**
   * Get all secondary targets
   * @returns Array of secondary targets
   */
  getSecondaryTargets(): SyncTarget[];

  /**
   * Get current sync status
   * @returns Current sync status including phase and target states
   */
  getStatus(): SyncStatus;

  /**
   * Get pending sync operation
   * @returns Current pending sync or null if none
   */
  getPendingSync(): PendingSync | null;

  /**
   * Get file content from a target
   * @param targetId ID of the target containing the file
   * @param path Path of the file to get content for
   * @returns Stream of file content
   * @throws {SyncManagerError} if target not found or file not available
   */
  getFileContent(targetId: string, path: string): Promise<FileContentStream>;

  /**
   * Get pending changes
   * @returns Array of pending changes
   * @throws {SyncManagerError} if no pending changes
   */
  getPendingChanges(): Promise<FileChangeInfo[]>;

  /**
   * Get content of a pending change
   * @param path Path of the file to get content for
   * @returns Stream of file content
   * @throws {SyncManagerError} if no such pending change or source not available
   */
  getPendingChangeContent(path: string): Promise<FileContentStream>;

  /**
   * Reinitialize a target
   * @param targetId ID of the target to reinitialize
   */
  reinitializeTarget(targetId: string): Promise<void>;

  /**
   * Recover a target using specified resolution type
   * @param targetId ID of the target to recover
   * @param resolutionType Type of resolution to apply
   */
  recoverTarget(
    targetId: string,
    resolutionType: ResolutionType
  ): Promise<void>;

  /**
   * Add a progress listener for sync operations
   * @param listener Function to call with progress updates
   * @returns Function to remove the listener
   */
  addProgressListener(listener: SyncProgressListener): () => void;

  /**
   * Remove a progress listener
   * @param listener The listener function to remove
   */
  removeProgressListener(listener: SyncProgressListener): void;

  /**
   * Dispose of the sync manager
   * Stops all watchers and clears target references
   */
  dispose(): Promise<void>;
}

export class SyncManagerError extends Error {
  constructor(
    message: string,
    public code:
      | "NO_PRIMARY_TARGET"
      | "TARGET_NOT_FOUND"
      | "TARGET_ALREADY_EXISTS"
      | "PRIMARY_TARGET_EXISTS"
      | "TARGET_NOT_DIRTY"
      | "NO_PENDING_SYNC"
      | "SOURCE_NOT_AVAILABLE"
      | "SYNC_IN_PROGRESS"
      | "INVALID_TARGET_ROLE"
      | "DUPLICATE_TARGET_ID"
      | "INVALID_TARGET_STATE"
      | "SYNC_FAILED"
  ) {
    super(message);
    this.name = "SyncManagerError";
  }
}
