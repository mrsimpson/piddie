import type {
  FileSystem,
  SyncManager,
  GitOperations,
  FileManagementConfig,
  FileManagementService as IFileManagementService,
  SyncTarget
} from "@piddie/shared-types";

/**
 * Factory configuration for creating a FileManagementService
 */
export interface FileManagementFactoryConfig {
  /**
   * Primary sync target for file system operations
   */
  primaryTarget: SyncTarget;

  /**
   * Secondary sync targets
   */
  secondaryTargets: SyncTarget[];

  /**
   * Git operations implementation
   */
  git: GitOperations;

  /**
   * File system implementation for the primary target
   */
  fileSystem: FileSystem;
}

/**
 * Implementation of the FileManagementService
 */
export class FileManagementService implements IFileManagementService {
  private _fileSystem: FileSystem;
  private _syncManager: SyncManager;
  private _git: GitOperations;
  private _initialized = false;

  constructor(
    fileSystem: FileSystem,
    syncManager: SyncManager,
    git: GitOperations
  ) {
    this._fileSystem = fileSystem;
    this._syncManager = syncManager;
    this._git = git;
  }

  get fileSystem(): FileSystem {
    if (!this._initialized) {
      throw new Error("Service not initialized");
    }
    return this._fileSystem;
  }

  get syncManager(): SyncManager {
    if (!this._initialized) {
      throw new Error("Service not initialized");
    }
    return this._syncManager;
  }

  get git(): GitOperations {
    if (!this._initialized) {
      throw new Error("Service not initialized");
    }
    return this._git;
  }

  async initialize(config?: FileManagementConfig): Promise<void> {
    if (this._initialized) {
      throw new Error("Service already initialized");
    }

    // Initialize file system first
    await this._fileSystem.initialize();

    // Initialize primary target with file system
    const primaryTarget = this._syncManager.getPrimaryTarget();
    await primaryTarget.initialize(this._fileSystem);

    // Initialize sync manager with config
    await this._syncManager.initialize({
      inactivityDelay: config?.sync?.inactivityDelay ?? 1000,
      maxBatchSize: config?.sync?.maxBatchSize ?? 50,
      maxRetries: 3
    });

    this._initialized = true;
  }

  async dispose(): Promise<void> {
    if (!this._initialized) {
      return;
    }

    try {
      await this._syncManager.dispose();
    } catch (error) {
      // Log error but don't rethrow as we want to ensure clean shutdown
      console.error("Error during sync manager disposal:", error);
    }

    this._initialized = false;
  }
}

/**
 * Factory for creating FileManagementService instances
 */
export class FileManagementServiceFactory {
  /**
   * Create a new FileManagementService instance
   */
  static async create(
    config: FileManagementFactoryConfig
  ): Promise<FileManagementService> {
    // Create sync manager instance
    const syncManager = await createSyncManager(config);

    // Create service instance
    return new FileManagementService(
      config.fileSystem,
      syncManager,
      config.git
    );
  }
}

/**
 * Helper to create and configure the sync manager
 */
async function createSyncManager(
  config: FileManagementFactoryConfig
): Promise<SyncManager> {
  // Import dynamically to avoid circular dependencies
  const { FileSyncManager } = await import("./FileSyncManager");
  const syncManager = new FileSyncManager();

  // Register primary target
  syncManager.registerTarget(config.primaryTarget, { role: "primary" });

  // Register secondary targets
  for (const target of config.secondaryTargets) {
    syncManager.registerTarget(target, { role: "secondary" });
  }

  return syncManager;
}
