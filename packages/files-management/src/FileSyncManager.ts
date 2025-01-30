import { SyncManagerError } from "@piddie/shared-types";
import { SyncOperationError } from "@piddie/shared-types";
import type {
  SyncTarget,
  SyncManager,
  TargetRegistrationOptions,
  SyncManagerConfig,
  FileChangeInfo,
  FileContentStream,
  SyncStatus,
  PendingSync,
  FileMetadata,
  FileConflict,
  SyncManagerStateType
} from "@piddie/shared-types";
import { VALID_SYNC_MANAGER_TRANSITIONS } from "@piddie/shared-types";

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
  private currentState: SyncManagerStateType = "uninitialized";

  validateStateTransition(from: SyncManagerStateType, to: SyncManagerStateType, via: string): boolean {
    return VALID_SYNC_MANAGER_TRANSITIONS.some(
      t => t.from === from && t.to === to && t.via === via
    );
  }

  getCurrentState(): SyncManagerStateType {
    return this.currentState;
  }

  transitionTo(newState: SyncManagerStateType, via: string): void {
    if (!this.validateStateTransition(this.currentState, newState, via)) {
      this.currentState = "error";
      throw new SyncManagerError(
        `Invalid state transition from ${this.currentState} to ${newState} via ${via}`,
        "SYNC_IN_PROGRESS"
      );
    }
    this.currentState = newState;
  }

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
    try {
      // Don't start watching if already watching
      if (this.activeWatchers.has(target.id)) {
        return;
      }

      // Start watching the target
      await target.watch((changes) => this.handleTargetChanges(target.id, changes));

      // Store unwatch function
      this.activeWatchers.set(target.id, () => target.unwatch());
    } catch (error) {
      this.transitionTo("error", "error");
      throw error;
    }
  }

  private async stopWatching(targetId: string): Promise<void> {
    try {
      const unwatch = this.activeWatchers.get(targetId);
      if (unwatch) {
        await unwatch();
        this.activeWatchers.delete(targetId);
      }
    } catch (error) {
      this.transitionTo("error", "error");
      throw error;
    }
  }

  private async applyChangeToTarget(
    change: FileChangeInfo,
    sourceTarget: SyncTarget,
    target: SyncTarget
  ): Promise<FileChangeInfo | FileConflict> {
    try {
      // For deletions, we don't need to get file content
      if (change.type === "delete") {
        const metadata: FileMetadata = {
          path: change.path,
          hash: "",
          size: 0,
          lastModified: change.lastModified,
          type: "file"
        };
        const conflict = await target.applyFileChange(metadata, {
          metadata,
          getReader: () => {
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue({
                  content: "",
                  chunkIndex: 0,
                  totalChunks: 1,
                  chunkHash: ""
                });
                controller.close();
              }
            });
            return stream.getReader();
          },
          close: async () => { /* No cleanup needed */ }
        });
        if (conflict) return conflict;
        return change;
      }

      // For creates and modifications, get the file content
      const content = await sourceTarget.getFileContent(change.path);
      const conflict = await target.applyFileChange(content.metadata, content);
      if (conflict) return conflict;
      return change;
    } catch (error) {
      throw new SyncOperationError(
        `Failed to apply change to target ${target.id}: ${error}`,
        "APPLY_FAILED"
      );
    }
  }

  private async applyChangesToTarget(
    target: SyncTarget,
    sourceTarget: SyncTarget,
    changes: FileChangeInfo[]
  ): Promise<ApplyChangesResult> {
    const result: ApplyChangesResult = {
      targetId: target.id,
      success: true,
      appliedChanges: []
    };

    try {
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
            const result = await this.applyChangeToTarget(change, sourceTarget, target);
            if ('targetId' in result) {
              // This is a FileConflict
              return result;
            }
            return result as FileChangeInfo;
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
    } catch (error) {
      result.success = false;
      result.error = error as Error;
      target.getState().status = "error";
    }

    return result;
  }

  private async fullSyncFromPrimaryToTarget(target: SyncTarget): Promise<void> {
    if (!this.primaryTarget) return;

    try {
      // Get all paths from primary first to know what changes are coming
      const allPaths = await this.getAllPaths(this.primaryTarget);

      // Notify target about incoming changes
      await target.notifyIncomingChanges(allPaths);

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

        // Apply delete changes first
        await this.applyChangesToTarget(target, this.primaryTarget, deleteChanges);
      }

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

      // Apply changes to target
      await this.applyChangesToTarget(target, this.primaryTarget, changes);

      // Complete the sync
      await target.syncComplete();
    } catch (error) {
      target.getState().status = "error";
      throw error;
    }
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
    this.transitionTo("syncing", "changesDetected");

    const sourceTarget =
      sourceId === this.primaryTarget?.id
        ? this.primaryTarget
        : this.secondaryTargets.get(sourceId);

    if (!sourceTarget) {
      this.transitionTo("error", "error");
      throw new SyncManagerError("Source target not found", "TARGET_NOT_FOUND");
    }

    if (!this.primaryTarget) {
      this.transitionTo("error", "error");
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

    try {
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
        } else {
          // Primary sync failed - transition to conflict state
          this.transitionTo("conflict", "conflictDetected");
        }
      }

      // Update pending syncs based on results
      this.updatePendingSyncs(state);

      // If we're not in conflict state, transition back to ready
      if (this.getCurrentState() === "syncing") {
        this.transitionTo("ready", "syncComplete");
      }
    } catch (error) {
      this.transitionTo("error", "error");
      throw error;
    }
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
      this.transitionTo("error", "error");
      throw new SyncManagerError("Source target not found", "TARGET_NOT_FOUND");
    }

    if (!this.primaryTarget) {
      this.transitionTo("error", "error");
      throw new SyncManagerError("No primary target", "NO_PRIMARY_TARGET");
    }

    try {
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
      this.transitionTo("ready", "conflictResolved");
    } catch (error) {
      this.transitionTo("error", "error");
      throw error;
    }
  }

  async rejectPendingSync(): Promise<void> {
    if (!this.pendingSync) {
      throw new SyncManagerError("No pending changes", "NO_PENDING_SYNC");
    }

    this.pendingSync = null;
    this.transitionTo("ready", "conflictResolved");
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
      this.transitionTo("error", "error");
      throw new SyncManagerError("No primary target", "NO_PRIMARY_TARGET");
    }

    try {
      // Get all paths from primary first to know what changes are coming
      const allPaths = await this.getAllPaths(this.primaryTarget);

      // Notify target about incoming changes
      await target.notifyIncomingChanges(allPaths);

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

        // Apply delete changes first
        await this.applyChangesToTarget(target, this.primaryTarget, deleteChanges);
      }

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

      // Apply only existing files - treat all as new creations
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
        }))
      );

      // Complete the sync
      await target.syncComplete();
      target.getState().status = "idle";
    } catch (error) {
      target.getState().status = "error";
      this.transitionTo("error", "error");
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

    this.transitionTo("ready", "initialize");
  }

  async dispose(): Promise<void> {
    try {
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

      // Reset state
      this.currentState = "uninitialized";
    } catch (error) {
      this.transitionTo("error", "error");
      throw error;
    }
  }
}
