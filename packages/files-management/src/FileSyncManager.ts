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

export class FileSyncManager implements SyncManager {
  private primaryTarget: SyncTarget | null = null;
  private secondaryTargets: Map<string, SyncTarget> = new Map();
  private config?: SyncManagerConfig;
  private currentPhase: SyncStatus["phase"] = "idle";
  private pendingSync: PendingSync | null = null;

  registerTarget(target: SyncTarget, options: TargetRegistrationOptions): void {
    // Validate role
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

    // Handle primary target registration
    if (options.role === "primary") {
      if (this.primaryTarget) {
        throw new SyncManagerError(
          "Primary target already exists",
          "PRIMARY_TARGET_EXISTS"
        );
      }
      this.primaryTarget = target;
    } else {
      // Register secondary target
      this.secondaryTargets.set(target.id, target);
    }
  }

  unregisterTarget(targetId: string): void {
    if (this.primaryTarget?.id === targetId) {
      this.primaryTarget = null;
      return;
    }
    this.secondaryTargets.delete(targetId);
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
    return this.pendingSync;
  }

  private async applyChangesToTarget(
    target: SyncTarget,
    sourceTarget: SyncTarget,
    changes: FileChangeInfo[]
  ): Promise<void> {
    // Notify target about incoming changes
    await target.notifyIncomingChanges(changes.map((c) => c.path));

    // Process changes in batches
    const batchSize = this.config?.maxBatchSize ?? 10;
    for (let i = 0; i < changes.length; i += batchSize) {
      const batch = changes.slice(i, i + batchSize);

      for (const change of batch) {
        try {
          // Get content from source
          const content = await sourceTarget.getFileContent(change.path);

          // Apply to target
          await target.applyFileChange(content.metadata, content);
        } catch (error) {
          // Mark the current target as error and propagate
          target.getState().status = "error";
          throw error; // Propagate error to handle pending sync state
        }
      }
    }

    // Only mark as complete if all changes were successful
    await target.syncComplete();
    target.getState().status = "idle";
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

    if (sourceTarget === this.primaryTarget) {
      // Changes from primary - propagate to all secondaries
      this.currentPhase = "syncing";

      // Track successful syncs
      const successfulTargets = new Set<string>();

      for (const target of this.secondaryTargets.values()) {
        try {
          await this.applyChangesToTarget(target, sourceTarget, changes);
          if (target.getState().status === "idle") {
            successfulTargets.add(target.id);
          }
        } catch {
          // Target is already marked as error in applyChangesToTarget
          // Continue with other targets
        }
      }

      // Reset status for successful targets
      for (const targetId of successfulTargets) {
        const target = this.secondaryTargets.get(targetId);
        if (target) {
          target.getState().status = "idle";
        }
      }
    } else {
      // Changes from secondary - store pending changes first
      this.pendingSync = {
        sourceTargetId: sourceId,
        changes,
        timestamp: Date.now(),
        failedPrimarySync: false
      };

      // Then try to sync to primary
      this.currentPhase = "syncing";
      try {
        await this.applyChangesToTarget(
          this.primaryTarget,
          sourceTarget,
          changes
        );

        // If primary sync succeeds, propagate to other secondaries
        for (const target of this.secondaryTargets.values()) {
          if (target !== sourceTarget) {
            try {
              await this.applyChangesToTarget(
                target,
                this.primaryTarget,
                changes
              );
            } catch {
              // Target is already marked as error in applyChangesToTarget
              // Continue with other targets
            }
          }
        }

        // Clear pending sync on success
        this.pendingSync = null;
      } catch {
        // Primary sync failed - update pending sync state
        if (this.pendingSync) {
          this.pendingSync.failedPrimarySync = true;
        }
        this.primaryTarget.getState().status = "error";
      }
    }

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
    return this.pendingSync?.changes ?? [];
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

    const sourceTarget = this.secondaryTargets.get(
      this.pendingSync.sourceTargetId
    );
    if (!sourceTarget) {
      throw new SyncManagerError("Source target not found", "TARGET_NOT_FOUND");
    }

    if (!this.primaryTarget) {
      throw new SyncManagerError("No primary target", "NO_PRIMARY_TARGET");
    }

    // First verify source files exist
    for (const change of this.pendingSync.changes) {
      await sourceTarget.getFileContent(change.path);
    }

    // Then apply to primary
    await this.applyChangesToTarget(
      this.primaryTarget,
      sourceTarget,
      this.pendingSync.changes
    );

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

    // Get metadata for root directory first
    const rootFiles = await target.getMetadata(["."]);
    for (const file of rootFiles) {
      if (!seenPaths.has(file.path)) {
        seenPaths.add(file.path);
        result.push(file.path);
      }
    }

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
      // First get all paths from primary
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

      // Apply only existing files
      await this.applyChangesToTarget(
        target,
        this.primaryTarget,
        existingFiles.map((file) => ({
          path: file.path,
          type: "modify",
          hash: file.hash,
          size: file.size,
          lastModified: file.lastModified,
          sourceTarget: this.primaryTarget!.id
        }))
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
    // Cleanup resources
    this.primaryTarget = null;
    this.secondaryTargets.clear();
    this.pendingSync = null;
    this.currentPhase = "idle";
  }
}
