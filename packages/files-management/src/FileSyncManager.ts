import { SyncManagerError } from "@piddie/shared-types";
import type {
  SyncTarget,
  SyncManager,
  TargetRegistrationOptions,
  SyncManagerConfig,
  FileChangeInfo,
  FileContentStream,
  SyncStatus,
  PendingSync,
  FileMetadata
} from "@piddie/shared-types";

/**
 * Result of applying changes to a target
 */
interface ApplyChangesResult {
  targetId: string;
  success: boolean;
  error?: Error;
  appliedChanges: FileChangeInfo[];
}

/**
 * State of a sync operation
 */
interface SyncOperationState {
  sourceTarget: SyncTarget;
  changes: FileChangeInfo[];
  results: ApplyChangesResult[];
}

export class FileSyncManager implements SyncManager {
  private primaryTarget: SyncTarget | null = null;
  private secondaryTargets: Map<string, SyncTarget> = new Map();
  private config?: SyncManagerConfig;
  private currentPhase: SyncStatus["phase"] = "idle";
  private pendingSync: PendingSync | null = null;
  private activeWatchers: Map<string, () => Promise<void>> = new Map();

  private validateTarget(target: SyncTarget, options: TargetRegistrationOptions): void {
    // Synchronous validations first
    if (options.role !== "primary" && options.role !== "secondary") {
      throw new SyncManagerError("Invalid target role", "TARGET_NOT_FOUND");
    }

    // Verify target is initialized
    if (target.getState().status === "error") {
      throw new SyncManagerError(
        `Target ${target.id} is not initialized`,
        "SOURCE_NOT_AVAILABLE"
      );
    }

    // Check for duplicate target ID
    if (
      this.primaryTarget?.id === target.id ||
      this.secondaryTargets.has(target.id)
    ) {
      throw new SyncManagerError(
        `Target with ID ${target.id} already exists`,
        "TARGET_ALREADY_EXISTS"
      );
    }

    // Check for primary target existence
    if (options.role === "primary" && this.primaryTarget) {
      throw new SyncManagerError(
        "Primary target already exists",
        "PRIMARY_TARGET_EXISTS"
      );
    }
  }

  private async startWatching(target: SyncTarget): Promise<void> {
    // Don't start watching if already watching
    if (this.activeWatchers.has(target.id)) {
      return;
    }

    // Start watching the target
    await target.watch((changes) => this.handleTargetChanges(target.id, changes));

    // Store unwatch function
    this.activeWatchers.set(target.id, () => target.unwatch());
  }

  private async stopWatching(targetId: string): Promise<void> {
    const unwatch = this.activeWatchers.get(targetId);
    if (unwatch) {
      await unwatch();
      this.activeWatchers.delete(targetId);
    }
  }

  private async applyChangesToTarget(
    target: SyncTarget,
    sourceTarget: SyncTarget,
    changes: FileChangeInfo[],
    bypassLock: boolean = false
  ): Promise<ApplyChangesResult> {
    const result: ApplyChangesResult = {
      targetId: target.id,
      success: true,
      appliedChanges: []
    };

    try {
      // Only notify and lock if we're not bypassing the lock
      if (!bypassLock) {
        await target.notifyIncomingChanges(changes.map((c) => c.path));
      }

      // Split changes into batches
      const batchSize = this.config?.maxBatchSize ?? 10;
      const batches = Array.from(
        { length: Math.ceil(changes.length / batchSize) },
        (_, i) => changes.slice(i * batchSize, (i + 1) * batchSize)
      );

      // Process each batch sequentially
      for (const batch of batches) {
        // Process all changes in the batch concurrently
        const batchResults = await Promise.allSettled(
          batch.map(async (change) => {
            const content = await sourceTarget.getFileContent(change.path);
            await target.applyFileChange(content.metadata, content);
            return change;
          })
        );

        // Check for failures in the batch
        const failedResults = batchResults.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected'
        );

        if (failedResults.length > 0) {
          // At least one change in the batch failed
          result.success = false;
          result.error = failedResults[0]!.reason;
          target.getState().status = "error";
          return result;
        }

        // Add successfully applied changes
        const succeededChanges = batchResults
          .filter((r): r is PromiseFulfilledResult<FileChangeInfo> => r.status === 'fulfilled')
          .map(r => r.value);
        result.appliedChanges.push(...succeededChanges);
      }

      // Only complete sync if we're not bypassing the lock
      if (!bypassLock) {
        await target.syncComplete();
      }
    } catch (error) {
      result.success = false;
      result.error = error as Error;
      target.getState().status = "error";
    }

    return result;
  }

  private async fullSyncFromPrimaryToTarget(target: SyncTarget): Promise<void> {
    if (!this.primaryTarget) return;

    // First, get all existing files in the target and delete them
    const targetPaths = await this.getAllPaths(target);
    if (targetPaths.length > 0) {
      // Create delete changes for all existing files
      const deleteChanges: FileChangeInfo[] = targetPaths.map(path => ({
        path,
        type: "delete",
        hash: "",
        size: 0,
        lastModified: Date.now(),
        sourceTarget: this.primaryTarget!.id
      }));

      // Apply delete changes first, bypassing lock
      await this.applyChangesToTarget(target, this.primaryTarget, deleteChanges, true);
    }

    // Get all paths from primary
    const allPaths = await this.getAllPaths(this.primaryTarget);

    // Get metadata for all paths
    const allFiles = await this.primaryTarget.getMetadata(allPaths);

    // Create change info for each file - treat all as new creations
    const changes: FileChangeInfo[] = allFiles.map(file => ({
      path: file.path,
      type: "create", // Always treat as create for initialization
      hash: file.hash,
      size: file.size,
      lastModified: file.lastModified,
      sourceTarget: this.primaryTarget!.id
    }));

    // Apply changes to target, bypassing lock
    await this.applyChangesToTarget(target, this.primaryTarget, changes, true);
  }

  async registerTarget(target: SyncTarget, options: TargetRegistrationOptions): Promise<void> {
    // Run synchronous validations first
    this.validateTarget(target, options);

    if (options.role === "primary") {
      // Set primary target first
      this.primaryTarget = target;

      // Start watching primary
      await this.startWatching(target);

      // Sync primary contents to all existing secondaries
      for (const secondary of this.secondaryTargets.values()) {
        await this.fullSyncFromPrimaryToTarget(secondary);
      }
    } else {
      // Register secondary target
      this.secondaryTargets.set(target.id, target);

      // If primary exists, sync its contents to the new secondary
      if (this.primaryTarget) {
        await this.fullSyncFromPrimaryToTarget(target);
      }

      // Start watching secondary
      await this.startWatching(target);
    }
  }

  async unregisterTarget(targetId: string): Promise<void> {
    // Stop watching first
    await this.stopWatching(targetId);

    if (this.primaryTarget?.id === targetId) {
      this.primaryTarget = null;
    } else {
      this.secondaryTargets.delete(targetId);
    }
  }

  getPrimaryTarget(): SyncTarget {
    if (!this.primaryTarget) {
      throw new SyncManagerError(
        "No primary target registered",
        "NO_PRIMARY_TARGET"
      );
    }
    return this.primaryTarget;
  }

  getSecondaryTargets(): SyncTarget[] {
    return Array.from(this.secondaryTargets.values());
  }

  getStatus(): SyncStatus {
    const targets = new Map();
    if (this.primaryTarget) {
      targets.set(this.primaryTarget.id, this.primaryTarget.getState());
    }
    this.secondaryTargets.forEach((target) => {
      targets.set(target.id, target.getState());
    });

    return {
      phase: this.currentPhase,
      targets,
      lastSyncTime: Date.now(),
      failureHistory: []
    };
  }

  getPendingSync(): PendingSync | null {
    if (!this.pendingSync) {
      return null;
    }

    // For backward compatibility with tests, if there's a pending sync for primary,
    // expose its changes directly on the PendingSync object
    const primaryPending = this.pendingSync.pendingByTarget.get(this.primaryTarget?.id || '');
    if (primaryPending) {
      return {
        ...this.pendingSync,
        changes: primaryPending.changes,
        failedPrimarySync: primaryPending.failedSync,
        timestamp: primaryPending.timestamp
      } as any; // Use any to satisfy backward compatibility
    }

    return this.pendingSync;
  }

  private updatePendingSyncs(state: SyncOperationState): void {
    const failedResults = state.results.filter(r => !r.success);
    if (failedResults.length === 0) {
      // All succeeded, clear pending syncs
      this.pendingSync = null;
      return;
    }

    // Initialize pending sync if needed
    if (!this.pendingSync) {
      this.pendingSync = {
        sourceTargetId: state.sourceTarget.id,
        pendingByTarget: new Map()
      };
    }

    // Update pending syncs for failed targets
    for (const result of failedResults) {
      this.pendingSync.pendingByTarget.set(result.targetId, {
        changes: state.changes,
        timestamp: Date.now(),
        failedSync: true
      });
    }
  }

  async handleTargetChanges(
    sourceId: string,
    changes: FileChangeInfo[]
  ): Promise<void> {
    this.currentPhase = "collecting";

    const sourceTarget =
      sourceId === this.primaryTarget?.id
        ? this.primaryTarget
        : this.secondaryTargets.get(sourceId);

    if (!sourceTarget) {
      throw new SyncManagerError("Source target not found", "TARGET_NOT_FOUND");
    }

    if (!this.primaryTarget) {
      throw new SyncManagerError(
        "No primary target registered",
        "NO_PRIMARY_TARGET"
      );
    }

    const state: SyncOperationState = {
      sourceTarget,
      changes,
      results: []
    };

    this.currentPhase = "syncing";

    if (sourceTarget === this.primaryTarget) {
      // Changes from primary - propagate to all secondaries
      for (const target of this.secondaryTargets.values()) {
        const result = await this.applyChangesToTarget(target, sourceTarget, changes);
        state.results.push(result);
      }
    } else {
      // Changes from secondary - sync to primary first
      const primaryResult = await this.applyChangesToTarget(this.primaryTarget, sourceTarget, changes);
      state.results.push(primaryResult);

      // Only propagate to other secondaries if primary sync succeeded
      if (primaryResult.success) {
        for (const target of this.secondaryTargets.values()) {
          if (target !== sourceTarget) {
            const result = await this.applyChangesToTarget(target, this.primaryTarget, changes);
            state.results.push(result);
          }
        }
      }
    }

    // Update pending syncs based on results
    this.updatePendingSyncs(state);
    this.currentPhase = "idle";
  }

  async getFileContent(
    targetId: string,
    path: string
  ): Promise<FileContentStream> {
    const target =
      targetId === this.primaryTarget?.id
        ? this.primaryTarget
        : this.secondaryTargets.get(targetId);

    if (!target) {
      throw new SyncManagerError("Target not found", "TARGET_NOT_FOUND");
    }

    return target.getFileContent(path);
  }

  async getPendingChanges(): Promise<FileChangeInfo[]> {
    if (!this.pendingSync) {
      return [];
    }

    // Collect all unique changes from all pending targets
    const uniqueChanges = new Map<string, FileChangeInfo>();
    for (const targetSync of this.pendingSync.pendingByTarget.values()) {
      for (const change of targetSync.changes) {
        uniqueChanges.set(change.path, change);
      }
    }

    return Array.from(uniqueChanges.values());
  }

  async getPendingChangeContent(path: string): Promise<FileContentStream> {
    if (!this.pendingSync) {
      throw new SyncManagerError("No pending changes", "NO_PENDING_SYNC");
    }

    const sourceTarget = this.secondaryTargets.get(
      this.pendingSync.sourceTargetId
    );
    if (!sourceTarget) {
      throw new SyncManagerError("Source target not found", "TARGET_NOT_FOUND");
    }

    return sourceTarget.getFileContent(path);
  }

  async confirmPrimarySync(): Promise<void> {
    if (!this.pendingSync) {
      throw new SyncManagerError("No pending changes", "NO_PENDING_SYNC");
    }

    const sourceTarget = this.secondaryTargets.get(this.pendingSync.sourceTargetId);
    if (!sourceTarget) {
      throw new SyncManagerError("Source target not found", "TARGET_NOT_FOUND");
    }

    if (!this.primaryTarget) {
      throw new SyncManagerError("No primary target", "NO_PRIMARY_TARGET");
    }

    // Get all unique changes
    const changes = await this.getPendingChanges();

    // First verify source files exist
    for (const change of changes) {
      await sourceTarget.getFileContent(change.path);
    }

    // Then apply to primary
    await this.applyChangesToTarget(this.primaryTarget, sourceTarget, changes);

    // On success, reinitialize other secondaries
    const reinitPromises = Array.from(this.secondaryTargets.values())
      .filter((target) => target !== sourceTarget)
      .map((target) => this.reinitializeTarget(target.id));

    await Promise.all(reinitPromises);

    this.pendingSync = null;
  }

  async rejectPendingSync(): Promise<void> {
    this.pendingSync = null;
  }

  private async getAllPaths(target: SyncTarget): Promise<string[]> {
    const result: string[] = [];
    const seenPaths = new Set<string>();

    // Recursive function to process directories
    const processDirectory = async (dirPath: string) => {
      try {
        const entries = await target.listDirectory(dirPath);
        for (const entry of entries) {
          if (!seenPaths.has(entry.path)) {
            seenPaths.add(entry.path);
            if (entry.type === "file") {
              result.push(entry.path);
            } else if (entry.type === "directory") {
              await processDirectory(entry.path);
            }
          }
        }
      } catch (error) {
        // Skip directories that can't be listed
        console.warn(`Failed to list directory ${dirPath}:`, error);
      }
    };

    // Start from root
    await processDirectory("/");
    return result;
  }

  async reinitializeTarget(targetId: string): Promise<void> {
    const target = this.secondaryTargets.get(targetId);
    if (!target) {
      throw new SyncManagerError("Target not found", "TARGET_NOT_FOUND");
    }

    if (!this.primaryTarget) {
      throw new SyncManagerError("No primary target", "NO_PRIMARY_TARGET");
    }

    try {
      // First, get all existing files in the target and delete them
      const targetPaths = await this.getAllPaths(target);
      if (targetPaths.length > 0) {
        // Create delete changes for all existing files
        const deleteChanges: FileChangeInfo[] = targetPaths.map(path => ({
          path,
          type: "delete",
          hash: "",
          size: 0,
          lastModified: Date.now(),
          sourceTarget: this.primaryTarget!.id
        }));

        // Apply delete changes first, bypassing lock
        await this.applyChangesToTarget(target, this.primaryTarget, deleteChanges, true);
      }

      // Get all paths from primary
      const allPaths = await this.getAllPaths(this.primaryTarget);

      // Then get metadata for all paths
      const allFiles = await this.primaryTarget.getMetadata(allPaths);

      // Filter to only existing files
      const existingFiles: FileMetadata[] = [];
      for (const file of allFiles) {
        try {
          await this.primaryTarget.getFileContent(file.path);
          existingFiles.push(file);
        } catch {
          // Skip files that don't exist
          continue;
        }
      }

      // Apply only existing files - treat all as new creations, bypassing lock
      await this.applyChangesToTarget(
        target,
        this.primaryTarget,
        existingFiles.map((file) => ({
          path: file.path,
          type: "create", // Always treat as create for reinitialization
          hash: file.hash,
          size: file.size,
          lastModified: file.lastModified,
          sourceTarget: this.primaryTarget!.id
        })),
        true
      );

      target.getState().status = "idle";
    } catch (error) {
      target.getState().status = "error";
      throw error;
    }
  }

  async initialize(config: SyncManagerConfig): Promise<void> {
    this.config = config;

    // Verify all targets are initialized
    if (
      this.primaryTarget &&
      this.primaryTarget.getState().status === "error"
    ) {
      throw new SyncManagerError(
        "Primary target not initialized",
        "SOURCE_NOT_AVAILABLE"
      );
    }

    for (const target of this.secondaryTargets.values()) {
      if (target.getState().status === "error") {
        throw new SyncManagerError(
          `Secondary target ${target.id} not initialized`,
          "SOURCE_NOT_AVAILABLE"
        );
      }
    }
  }

  async dispose(): Promise<void> {
    // Unwatch all targets
    const unwatchPromises = [];
    if (this.primaryTarget) {
      unwatchPromises.push(this.primaryTarget.unwatch());
    }
    for (const target of this.secondaryTargets.values()) {
      unwatchPromises.push(target.unwatch());
    }
    await Promise.all(unwatchPromises);

    // Clear all references
    this.primaryTarget = null;
    this.secondaryTargets.clear();
    this.pendingSync = null;
  }
}
