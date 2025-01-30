import type {
  FileChangeInfo,
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
 * Configuration for the sync manager
 */
export interface SyncManagerConfig {
  /**
   * Delay in ms to wait for more changes before starting sync
   */
  inactivityDelay: number;

  /**
   * Maximum number of changes to process in one sync operation
   */
  maxBatchSize: number;

  /**
   * Maximum number of retries for failed sync operations
   */
  maxRetries: number;
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
 * Possible states of the sync manager
 */
export type SyncManagerStateType =
  | "uninitialized"
  | "ready"
  | "syncing"
  | "conflict"
  | "error";

/**
 * Valid state transitions for the sync manager
 */
type SyncManagerStateTransition =
  | { from: "uninitialized"; to: "ready"; via: "initialize" }
  | { from: "ready"; to: "syncing"; via: "changesDetected" }
  | { from: "syncing"; to: "ready"; via: "syncComplete" }
  | { from: "syncing"; to: "conflict"; via: "conflictDetected" }
  | { from: "conflict"; to: "ready"; via: "conflictResolved" }
  | { from: "ready" | "syncing" | "conflict"; to: "error"; via: "error" }
  | { from: "error"; to: "ready"; via: "recovery" };

export const VALID_SYNC_MANAGER_TRANSITIONS: SyncManagerStateTransition[] = [
  { from: "uninitialized", to: "ready", via: "initialize" },
  { from: "ready", to: "syncing", via: "changesDetected" },
  { from: "syncing", to: "ready", via: "syncComplete" },
  { from: "syncing", to: "conflict", via: "conflictDetected" },
  { from: "conflict", to: "ready", via: "conflictResolved" },
  { from: "ready", to: "error", via: "error" },
  { from: "syncing", to: "error", via: "error" },
  { from: "conflict", to: "error", via: "error" },
  { from: "error", to: "ready", via: "recovery" }
];

/**
 * Core sync manager interface
 */
export interface SyncManager {
  /**
   * Register a new sync target
   * @param target The target to register
   * @param options Registration options including target role
   * @throws {SyncManagerError} with code:
   *  - TARGET_ALREADY_EXISTS if target with same id already registered
   *  - PRIMARY_TARGET_EXISTS if trying to register primary when one exists
   */
  registerTarget(target: SyncTarget, options: TargetRegistrationOptions): void;

  /**
   * Unregister a sync target
   */
  unregisterTarget(targetId: string): void;

  /**
   * Get the primary target
   * @throws {Error} if no primary target registered
   */
  getPrimaryTarget(): SyncTarget;

  /**
   * Get all secondary targets
   */
  getSecondaryTargets(): SyncTarget[];

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus;

  /**
   * Get current pending sync if any
   */
  getPendingSync(): PendingSync | null;

  /**
   * Get content stream for a file
   * @throws {SyncManagerError} if target not found or file not available
   */
  getFileContent(targetId: string, path: string): Promise<FileContentStream>;

  /**
   * Handle changes reported from a target
   * Changes only include metadata, content must be streamed separately
   */
  handleTargetChanges(
    sourceId: string,
    changes: FileChangeInfo[]
  ): Promise<void>;

  /**
   * Get pending changes metadata
   * @throws {Error} if no pending changes
   */
  getPendingChanges(): Promise<FileChangeInfo[]>;

  /**
   * Get content stream for a pending change
   * @throws {Error} if no such pending change or source not available
   */
  getPendingChangeContent(path: string): Promise<FileContentStream>;

  /**
   * Confirm pending sync to primary, will reinitialize all secondaries
   * @throws {Error} if no pending sync
   */
  confirmPrimarySync(): Promise<void>;

  /**
   * Reject pending sync, clearing pending changes
   * @throws {Error} if no pending sync
   */
  rejectPendingSync(): Promise<void>;

  /**
   * Reinitialize a dirty target from primary
   * @throws {Error} if target not found or not dirty
   */
  reinitializeTarget(targetId: string): Promise<void>;

  /**
   * Initialize the sync manager
   */
  initialize(config: SyncManagerConfig): Promise<void>;

  /**
   * Dispose the sync manager, cleaning up resources
   */
  dispose(): Promise<void>;

  /**
   * Validate if a state transition is allowed
   * @returns boolean indicating if the transition is valid
   */
  validateStateTransition(from: SyncManagerStateType, to: SyncManagerStateType, via: string): boolean;

  /**
   * Get current state type
   */
  getCurrentState(): SyncManagerStateType;

  /**
   * Transition to a new state
   * @throws {SyncManagerError} if transition is invalid
   */
  transitionTo(newState: SyncManagerStateType, via: string): void;
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
  ) {
    super(message);
    this.name = "SyncManagerError";
  }
}
