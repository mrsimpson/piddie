import { RuntimeContainer } from "./runtime-container";

/**
 * Represents different synchronization strategies
 */
export type SyncStrategy =
  | "auto-merge"
  | "manual-resolve"
  | "local-priority"
  | "remote-priority";

/**
 * Represents the state of a synchronization operation
 */
export interface SyncStatus {
  status: "idle" | "syncing" | "conflict" | "error";
  strategy: SyncStrategy;
  lastSyncTime?: number;
  conflicts?: SyncConflict[];
  error?: string;
}

/**
 * Represents a synchronization conflict
 */
export interface SyncConflict {
  path: string;
  localVersion: FileVersion;
  remoteVersion: FileVersion;
  resolveStrategy?: "local" | "remote" | "merge";
}

/**
 * Represents a specific version of a file
 */
export interface FileVersion {
  content: string;
  hash: string;
  timestamp: number;
}

/**
 * Interface for file synchronization
 */
export interface SyncManager {
  setSyncStrategy(strategy: SyncStrategy): void;
  sync(runtimeContainer?: RuntimeContainer): Promise<SyncStatus>;
  getStatus(): SyncStatus;
  resolveConflict(
    conflict: SyncConflict,
    strategy: "local" | "remote" | "merge"
  ): Promise<void>;
  on(
    event: "sync" | "conflict" | "error",
    callback: (status: SyncStatus) => void
  ): void;
  off(
    event: "sync" | "conflict" | "error",
    callback: (status: SyncStatus) => void
  ): void;
}
