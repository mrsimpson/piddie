import type { SyncTarget, TargetState } from "./files-sync-target";

export type SyncPhase =
  | "idle"
  | "collecting" // waiting for inactivity
  | "notifying" // notifying targets
  | "syncing" // applying changes
  | "committing" // git operations
  | "error";

/**
 * Represents the state of a synchronization operation
 */
export interface SyncStatus {
  phase: SyncPhase;
  targets: Map<string, TargetState>;
  lastSyncTime?: number;
  error?: string;
}

/**
 * Core sync manager interface
 */
export interface SyncManager {
  registerTarget(target: SyncTarget): void;
  unregisterTarget(targetId: string): void;
  getStatus(): SyncStatus;
}
