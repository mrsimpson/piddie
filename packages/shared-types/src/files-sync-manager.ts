import type { FileChange, FileChangeInfo, SyncTarget, TargetState } from "./files-sync-target";

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
 * Represents the state of a pending sync operation that failed to apply to primary
 */
export interface PendingSync {
  sourceTargetId: string;
  changes: FileChangeInfo[];
  timestamp: number;
  failedPrimarySync: boolean;
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
  | "idle"      // No sync in progress
  | "collecting" // Initial target collecting changes
  | "syncing"   // Applying changes
  | "error";    // Error state

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
 * Core sync manager interface
 */
export interface SyncManager {
  /**
   * Register a new sync target
   * @param target The target to register
   * @param options Registration options including target role
   * @throws {SyncError} with code:
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
   * Get pending changes content
   * @throws {Error} if no pending changes or source target not available
   */
  getPendingChanges(): Promise<Map<string, string>>;

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
   * Handle changes reported from a target
   */
  handleTargetChanges(sourceId: string, changes: FileChangeInfo[]): Promise<void>;

  /**
   * Initialize the sync manager
   */
  initialize(config: SyncManagerConfig): Promise<void>;

  /**
   * Dispose the sync manager, cleaning up resources
   */
  dispose(): Promise<void>;
}

export class SyncError extends Error {
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
    this.name = "SyncError";
  }
}
