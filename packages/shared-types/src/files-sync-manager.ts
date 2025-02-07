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
  | "resolving"
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
 * Interface for sync manager
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
   * Get pending sync information
   * @returns Current pending sync or null if none
   */
  getPendingSync(): PendingSync | null;

  /**
   * Get pending changes
   * @returns Array of pending changes
   * @throws {SyncManagerError} if no pending changes
   */
  getPendingChanges(): Promise<FileChangeInfo[]>;

  /**
   * Get content for a pending change
   * @param path Path of the file to get content for
   * @returns Stream of file content
   * @throws {SyncManagerError} if no such pending change or source not available
   */
  getPendingChangeContent(path: string): Promise<FileContentStream>;

  /**
   * Confirm pending sync to primary
   * This will apply pending changes to the primary target and reinitialize secondaries
   * @throws {SyncManagerError} if no pending sync or operation fails
   */
  confirmPrimarySync(): Promise<void>;

  /**
   * Initialize the sync manager
   * Verifies all targets are in valid state
   * @throws {SyncManagerError} if any target is in error state
   */
  initialize(): Promise<void>;

  /**
   * Clean up resources
   * Stops all watchers and clears target references
   */
  dispose(): Promise<void>;

  /**
   * Get content stream for a file
   * @param targetId ID of the target containing the file
   * @param path Path of the file to get content for
   * @returns Stream of file content
   * @throws {SyncManagerError} if target not found or file not available
   */
  getFileContent(targetId: string, path: string): Promise<FileContentStream>;

  /**
   * Handle changes reported from a target
   * Changes only include metadata, content must be streamed separately
   * @param sourceId ID of the target reporting changes
   * @param changes Array of file changes to process
   */
  handleTargetChanges(
    sourceId: string,
    changes: FileChangeInfo[]
  ): Promise<void>;

  /**
   * Validate if a state transition is allowed
   * @param from Current state
   * @param to Target state
   * @param via Action causing the transition
   * @returns boolean indicating if the transition is valid
   */
  validateStateTransition(
    from: SyncManagerStateType,
    to: SyncManagerStateType,
    via: string
  ): boolean;

  /**
   * Get current state type
   * @returns Current state of the sync manager
   */
  getCurrentState(): SyncManagerStateType;

  /**
   * Transition to a new state
   * @param newState State to transition to
   * @param via Action causing the transition
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
      | "INVALID_TARGET_ROLE"
      | "DUPLICATE_TARGET_ID"
      | "INVALID_TARGET_STATE"
      | "SYNC_FAILED"
  ) {
    super(message);
    this.name = "SyncManagerError";
  }
}
