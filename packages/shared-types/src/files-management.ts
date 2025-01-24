import type { FileSystem } from "./file-system";
import type { SyncManager } from "./files-sync-manager";
import type { FileConflict } from "./files-sync-target";

/**
 * Git operations interface
 */
export interface GitOperations {
  /**
   * Stage files for commit
   * @throws {GitError} if staging fails
   */
  stageFiles(paths: string[]): Promise<void>;

  /**
   * Create commit with staged changes
   * @param message Format: "<type>: <description>" where type is 'sync' or 'conflict'
   */
  createCommit(message: string): Promise<string>;

  /**
   * Create and switch to a conflict branch
   * @param options.targetId Target that had conflicts
   * @param options.timestamp Used in branch name as: conflict/<targetId>/<timestamp>
   */
  createConflictBranch(options: {
    targetId: string;
    timestamp: number;
  }): Promise<string>;

  /**
   * Save conflicting versions to the conflict branch
   */
  saveConflictVersions(options: {
    branch: string;
    conflicts: FileConflict[];
    message: string;
  }): Promise<void>;

  /**
   * Switch back to main branch
   */
  switchToMain(): Promise<void>;
}

/**
 * Configuration for the file management service
 */
export interface FileManagementConfig {
  paths?: {
    include: string[];
    ignore: string[];
  };
  sync?: {
    inactivityDelay: number;
    maxBatchSize: number;
  };
}

/**
 * Comprehensive file management service
 */
export interface FileManagementService {
  /**
   * File system management interface
   */
  fileSystem: FileSystem;

  /**
   * Synchronization management interface
   */
  syncManager: SyncManager;

  /**
   * Git operations interface
   */
  git: GitOperations;

  /**
   * Initialize the service with configuration
   */
  initialize(config?: FileManagementConfig): Promise<void>;

  /**
   * Clean up resources and stop watchers
   */
  dispose(): Promise<void>;
}

export class GitError extends Error {
  constructor(
    message: string,
    public code:
      | "STAGE_FAILED"
      | "COMMIT_FAILED"
      | "BRANCH_FAILED"
      | "SWITCH_FAILED"
  ) {
    super(message);
    this.name = "GitError";
  }
}
