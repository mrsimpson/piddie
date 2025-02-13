import { SyncManagerError } from "@piddie/shared-types";
import { SyncOperationError } from "@piddie/shared-types";
import type {
  SyncTarget,
  SyncManager,
  TargetRegistrationOptions,
  FileChangeInfo,
  FileContentStream,
  SyncStatus,
  PendingSync,
  FileConflict,
  SyncManagerStateType,
  SyncProgressEvent,
  SyncProgressListener,
  IgnoreService
} from "@piddie/shared-types";
import { VALID_SYNC_MANAGER_TRANSITIONS } from "@piddie/shared-types";
import { WATCHER_PRIORITIES } from "@piddie/shared-types";
import { DefaultIgnoreService } from "./DefaultIgnoreService";

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
  private currentPhase: SyncStatus["phase"] = "idle";
  private pendingSync: PendingSync | null = null;
  private activeWatchers: Map<string, () => Promise<void>> = new Map();
  private currentState: SyncManagerStateType = "uninitialized";
  private progressListeners: Set<SyncProgressListener> = new Set();
  private ignoreService: IgnoreService;

  validateStateTransition(
    from: SyncManagerStateType,
    to: SyncManagerStateType,
    via: string
  ): boolean {
    return VALID_SYNC_MANAGER_TRANSITIONS.some(
      (t) => t.from === from && t.to === to && t.via === via
    );
  }

  getCurrentState(): SyncManagerStateType {
    return this.currentState;
  }

  transitionTo(newState: SyncManagerStateType, via: string): void {
    const fromState = this.currentState;

    // allow to transition to error from all states
    if (newState === "error") {
      console.error(`Transitioning to error state via ${via}`);
      this.currentState = "error";
      return;
    }

    if (!this.validateStateTransition(this.currentState, newState, via)) {
      console.error(
        "Invalid state transition from",
        fromState,
        "to",
        newState,
        "via",
        via
      );
      this.currentState = "error";
      throw new SyncManagerError(
        `Invalid state transition from ${fromState} to ${newState} via ${via}`,
        "SYNC_FAILED"
      );
    }
    this.currentState = newState;
  }

  private validateTarget(
    target: SyncTarget,
    options: TargetRegistrationOptions
  ): void {
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
    console.info(`[FileSyncManager] Starting to watch target: ${target.id}`);

    try {
      // First check if we're already watching this target
      if (this.activeWatchers.has(target.id)) {
        console.debug(
          `[FileSyncManager] Already watching target: ${target.id}`
        );
        return;
      }

      // Start watching the target with high priority for sync operations
      await target.watch(
        (changes) => this.handleTargetChanges(target.id, changes),
        {
          priority: WATCHER_PRIORITIES.SYNC_MANAGER,
          metadata: {
            registeredBy: "FileSyncManager",
            type: "sync-watcher"
          }
        }
      );

      // Store unwatch function
      this.activeWatchers.set(target.id, () => target.unwatch());
    } catch (error) {
      this.transitionTo("error", "error");
      console.error(
        `[FileSyncManager] Failed to set up watcher for ${target.id}:`,
        error
      );
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

  private emitProgress(progress: SyncProgressEvent): void {
    for (const listener of this.progressListeners) {
      try {
        listener(progress);
      } catch (error) {
        console.error("Error in progress listener:", error);
      }
    }
  }

  addProgressListener(listener: SyncProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  removeProgressListener(listener: SyncProgressListener): void {
    this.progressListeners.delete(listener);
  }

  private async applyChangeToTarget(
    change: FileChangeInfo,
    sourceTarget: SyncTarget,
    target: SyncTarget
  ): Promise<FileChangeInfo | FileConflict> {
    try {
      // For deletions, we don't need to get file content
      if (change.type === "delete") {
        try {
          const conflict = await target.applyFileChange(change);
          if (conflict) return conflict;
          return change;
        } catch {
          const deletionConflict: FileConflict = {
            targetId: target.id,
            path: change.path,
            sourceTarget: sourceTarget.id,
            timestamp: Date.now()
          };
          return deletionConflict;
        }
      }

      // For creates and modifications, get the file content and metadata
      const content = await sourceTarget.getFileContent(change.path);

      // Track streaming progress if content has size information
      if (content.metadata.size) {
        let bytesTransferred = 0;
        const reader = content.stream.getReader();
        const syncManager = this; //eslint-disable-line @typescript-eslint/no-this-alias

        const newStream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytesTransferred += value.length;
                controller.enqueue(value);

                // Emit streaming progress
                syncManager.emitProgress({
                  type: "streaming",
                  sourceTargetId: sourceTarget.id,
                  targetId: target.id,
                  totalBytes: content.metadata.size,
                  processedBytes: bytesTransferred,
                  currentFile: change.path,
                  timestamp: Date.now()
                });
              }
              controller.close();
            } catch (error) {
              controller.error(error);
              throw error;
            }
          }
        });

        // Create wrapped content with progress tracking
        const streamContent: FileContentStream = {
          stream: newStream,
          metadata: content.metadata,
          getReader: () => newStream.getReader()
        };

        const conflict = await target.applyFileChange(change, streamContent);
        if (conflict) return conflict;
      } else {
        const conflict = await target.applyFileChange(change, content);
        if (conflict) return conflict;
      }

      return change;
    } catch (error) {
      // Emit error progress
      this.emitProgress({
        type: "error",
        sourceTargetId: sourceTarget.id,
        targetId: target.id,
        currentFile: change.path,
        error: error as Error,
        phase: "streaming",
        timestamp: Date.now()
      });

      throw new SyncOperationError(
        `Failed to apply change to target ${target.id}: ${error}`,
        "APPLY_FAILED"
      );
    }
  }

  /**
   * Prepare changes for hierarchical operations
   * Orders changes so that:
   * - For creations: Parent directories are created before children
   * - For deletions: Children are deleted before parents
   * - Mixed operations: Deletions are processed before creations/modifications
   */
  private prepareChangesForHierarchy(
    changes: FileChangeInfo[]
  ): FileChangeInfo[] {
    // First separate deletions and creations/modifications
    const deletions = changes.filter((c) => c.type === "delete");
    const creations = changes.filter((c) => c.type !== "delete");

    // Sort deletions by path depth (deepest first)
    const sortedDeletions = [...deletions].sort((a, b) => {
      const depthA = a.path.split("/").length;
      const depthB = b.path.split("/").length;
      return depthB - depthA; // Deepest first
    });

    // Sort creations by path depth (shallowest first) and ensure directories come before files
    const sortedCreations = [...creations].sort((a, b) => {
      const depthA = a.path.split("/").length;
      const depthB = b.path.split("/").length;
      if (depthA !== depthB) {
        return depthA - depthB; // Shallowest first
      }
      // At same depth, directories before files
      const aIsDir = a.metadata.type === "directory";
      const bIsDir = b.metadata.type === "directory";
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.path.localeCompare(b.path);
    });

    // Return deletions first, then creations
    return [...sortedDeletions, ...sortedCreations];
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
      // Order changes for hierarchical operations
      const orderedChanges = this.prepareChangesForHierarchy(changes);

      // Emit initial syncing progress
      this.emitProgress({
        type: "syncing",
        sourceTargetId: sourceTarget.id,
        targetId: target.id,
        totalFiles: orderedChanges.length,
        syncedFiles: 0,
        currentFile: "",
        timestamp: Date.now()
      });

      // Process changes sequentially to maintain hierarchy
      for (const change of orderedChanges) {
        try {
          // Skip ignored files
          try {
            if (this.ignoreService.isIgnored(change.path)) {
              console.debug(`Skipping ignored file: ${change.path}`);
              continue;
            }
          } catch (error) {
            // Log error but don't block operations if ignore check fails
            console.error(
              `Error checking ignore pattern for ${change.path}:`,
              error
            );
          }

          // Emit progress for current file
          this.emitProgress({
            type: "syncing",
            sourceTargetId: sourceTarget.id,
            targetId: target.id,
            totalFiles: orderedChanges.length,
            syncedFiles: result.appliedChanges.length,
            currentFile: change.path,
            timestamp: Date.now()
          });

          const changeResult = await this.applyChangeToTarget(
            change,
            sourceTarget,
            target
          );

          if ("targetId" in changeResult) {
            // This is a FileConflict
            result.success = false;
            result.error = new Error(`Conflict detected for ${change.path}`);
            target.getState().status = "error";

            // Emit error progress
            this.emitProgress({
              type: "error",
              sourceTargetId: sourceTarget.id,
              targetId: target.id,
              currentFile: change.path,
              error: result.error,
              phase: "syncing",
              timestamp: Date.now()
            });

            return result;
          }
          result.appliedChanges.push(changeResult);
        } catch (error) {
          result.success = false;
          result.error = error as Error;
          target.getState().status = "error";

          // Emit error progress
          this.emitProgress({
            type: "error",
            sourceTargetId: sourceTarget.id,
            targetId: target.id,
            currentFile: change.path,
            error: error as Error,
            phase: "syncing",
            timestamp: Date.now()
          });

          return result;
        }
      }

      // Emit completion progress
      this.emitProgress({
        type: "completing",
        sourceTargetId: sourceTarget.id,
        targetId: target.id,
        totalFiles: orderedChanges.length,
        successfulFiles: result.appliedChanges.length,
        failedFiles: orderedChanges.length - result.appliedChanges.length,
        timestamp: Date.now()
      });
    } catch (error) {
      result.success = false;
      result.error = error as Error;
      target.getState().status = "error";

      // Emit error progress
      this.emitProgress({
        type: "error",
        sourceTargetId: sourceTarget.id,
        targetId: target.id,
        currentFile: "",
        error: error as Error,
        phase: "syncing",
        timestamp: Date.now()
      });
    }

    return result;
  }

  async fullSyncFromPrimaryToTarget(target: SyncTarget): Promise<void> {
    // Skip sync if not initialized or no primary target
    if (this.currentState === "uninitialized" || !this.primaryTarget) {
      return;
    }

    try {
      const primary = this.primaryTarget; // Store reference to avoid null checks
      // Get all paths from primary first to know what changes are coming
      const allPaths = await this.getAllPaths(primary);

      // Filter out ignored paths
      const filesInPrimary = allPaths.filter((path) => {
        try {
          return !this.ignoreService.isIgnored(path);
        } catch (error) {
          // Log error but don't block operations if ignore check fails
          console.error(`Error checking ignore pattern for ${path}:`, error);
          return true; // Include file if ignore check fails
        }
      });

      // First, get all existing files in the target and delete them
      const allExistingPaths = await this.getAllPaths(target);

      // Filter out ignored paths from existing files
      const existingFilesInTarget = allExistingPaths.filter((path) => {
        try {
          return !this.ignoreService.isIgnored(path);
        } catch (error) {
          // Log error but don't block operations if ignore check fails
          console.error(`Error checking ignore pattern for ${path}:`, error);
          return true; // Include file if ignore check fails
        }
      });

      // Notify target about incoming changes
      if (filesInPrimary.length === 0 && existingFilesInTarget.length === 0) {
        return; // nothing to do: Source and target are empty directories
      }

      await target.notifyIncomingChanges(filesInPrimary);
      if (existingFilesInTarget.length > 0) {
        // Create delete changes for all existing files
        const deleteChanges: FileChangeInfo[] = existingFilesInTarget.map(
          (path) => ({
            path,
            type: "delete",
            sourceTarget: primary.id,
            metadata: {
              path,
              type: "file",
              hash: "",
              size: 0,
              lastModified: Date.now()
            }
          })
        );

        // Apply delete changes first
        await this.applyChangesToTarget(target, primary, deleteChanges);
      }

      // Get metadata for all paths
      const allFiles = await primary.getMetadata(filesInPrimary);

      // Create change info for each item - handle directories and files differently
      const changes: FileChangeInfo[] = allFiles.map((file) => ({
        path: file.path,
        type: "create" as const, // Always treat as create for initialization
        sourceTarget: primary.id,
        metadata: file
      }));

      // Apply changes to target
      await this.applyChangesToTarget(target, primary, changes);

      // Complete the sync
      await target.syncComplete();
    } catch (error) {
      this.transitionTo("error", "fullSyncFromPrimaryToTarget");
      throw new SyncOperationError(
        `Full sync failed: ${error instanceof Error ? error.message : String(error)}`,
        "APPLY_FAILED"
      );
    }
  }

  async registerTarget(
    target: SyncTarget,
    options: TargetRegistrationOptions
  ): Promise<void> {
    console.info(`[FileSyncManager] Registering target:`, {
      id: target.id,
      type: target.type,
      role: options.role
    });

    // Run synchronous validations first
    this.validateTarget(target, options);

    // Set ignore service if already initialized
    if (this.currentState !== "uninitialized" && this.ignoreService) {
      target.setIgnoreService(this.ignoreService);
    }

    if (options.role === "primary") {
      // Set primary target first
      this.primaryTarget = target;
      console.info(`[FileSyncManager] Set primary target: ${target.id}`);

      // Start watching primary
      await this.startWatching(target);

      // Only sync if manager is initialized
      if (this.currentState !== "uninitialized") {
        // Sync primary contents to all existing secondaries
        for (const secondary of this.secondaryTargets.values()) {
          await this.fullSyncFromPrimaryToTarget(secondary);
        }
      }
    } else {
      // Register secondary target
      this.secondaryTargets.set(target.id, target);
      console.info(`[FileSyncManager] Added secondary target: ${target.id}`);

      // Only sync if manager is initialized and primary exists
      if (this.currentState !== "uninitialized" && this.primaryTarget) {
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
    const primaryPending = this.pendingSync.pendingByTarget.get(
      this.primaryTarget?.id || ""
    );
    if (primaryPending) {
      return {
        ...this.pendingSync
      };
    }

    return this.pendingSync;
  }

  private updatePendingSyncs(state: SyncOperationState): void {
    const failedResults = state.results.filter((r) => !r.success);
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
    console.debug(
      `[FileSyncManager] Handling changes from ${sourceId}:`,
      changes
    );
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

    // Filter out ignored files
    const filteredChanges = changes.filter((change) => {
      try {
        return !this.ignoreService.isIgnored(change.path);
      } catch (error) {
        // Log error but don't block operations if ignore check fails
        console.error(
          `Error checking ignore pattern for ${change.path}:`,
          error
        );
        return true; // Include file if ignore check fails
      }
    });

    // If all changes are ignored, return early
    if (filteredChanges.length === 0) {
      this.transitionTo("ready", "syncComplete");
      return;
    }

    const state: SyncOperationState = {
      sourceTarget,
      changes: filteredChanges,
      results: []
    };

    try {
      if (sourceTarget === this.primaryTarget) {
        // Changes from primary - propagate to all secondaries
        for (const target of this.secondaryTargets.values()) {
          // Notify target about incoming changes
          await target.notifyIncomingChanges(
            filteredChanges.map((c) => c.path)
          );
          const result = await this.applyChangesToTarget(
            target,
            sourceTarget,
            filteredChanges
          );
          if (result.success) {
            await target.syncComplete();
          }
          state.results.push(result);
        }
      } else {
        // Changes from secondary - sync to primary first
        await this.primaryTarget.notifyIncomingChanges(
          filteredChanges.map((c) => c.path)
        );
        const primaryResult = await this.applyChangesToTarget(
          this.primaryTarget,
          sourceTarget,
          filteredChanges
        );
        if (primaryResult.success) {
          await this.primaryTarget.syncComplete();
        }
        state.results.push(primaryResult);

        // Only propagate to other secondaries if primary sync succeeded
        if (primaryResult.success) {
          for (const target of this.secondaryTargets.values()) {
            if (target !== sourceTarget) {
              await target.notifyIncomingChanges(
                filteredChanges.map((c) => c.path)
              );
              const result = await this.applyChangesToTarget(
                target,
                this.primaryTarget,
                filteredChanges
              );
              if (result.success) {
                await target.syncComplete();
              }
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

    const sourceTarget = this.secondaryTargets.get(
      this.pendingSync.sourceTargetId
    );
    if (!sourceTarget) {
      throw new SyncManagerError("Source target not found", "TARGET_NOT_FOUND");
    }

    if (!this.primaryTarget) {
      throw new SyncManagerError("No primary target", "NO_PRIMARY_TARGET");
    }

    try {
      // Transition to resolving state before starting the operation
      this.transitionTo("resolving", "confirmPrimarySync");

      // Get all unique changes
      const changes = await this.getPendingChanges();

      // Apply changes to primary target
      const result = await this.applyChangesToTarget(
        this.primaryTarget,
        sourceTarget,
        changes
      );

      if (!result.success) {
        // If apply fails, transition to error state
        this.transitionTo("error", "error");
        throw new SyncManagerError(
          `Failed to apply changes to primary target: ${result.error?.message}`,
          "SYNC_FAILED"
        );
      }

      // Clear pending sync after successful application
      this.pendingSync = null;

      // Reinitialize all secondary targets
      for (const target of this.secondaryTargets.values()) {
        await this.reinitializeTarget(target.id);
      }

      // Transition back to ready state after successful completion
      this.transitionTo("ready", "resolutionComplete");
    } catch (error) {
      // On any error, transition to error state if not already there
      if (this.currentState !== "error") {
        this.transitionTo("error", "error");
      }
      throw error;
    }
  }

  protected async reinitializeTarget(targetId: string): Promise<void> {
    const target = this.secondaryTargets.get(targetId);
    if (!target) {
      throw new SyncManagerError("Target not found", "TARGET_NOT_FOUND");
    }

    try {
      await this.fullSyncFromPrimaryToTarget(target);
    } catch (error) {
      target.getState().status = "error";
      throw error;
    }
  }

  private async getAllPaths(target: SyncTarget): Promise<string[]> {
    const result: string[] = [];
    const seenPaths = new Set<string>();

    // Recursive function to process directories
    const processDirectory = async (dirPath: string) => {
      try {
        // Add the directory itself first (except root)
        if (dirPath !== "/") {
          if (!seenPaths.has(dirPath)) {
            result.push(dirPath);
            seenPaths.add(dirPath);
          }
        }

        const entries = await target.listDirectory(dirPath);
        for (const entry of entries) {
          if (!seenPaths.has(entry.path)) {
            if (entry.type === "file") {
              result.push(entry.path);
              seenPaths.add(entry.path);
            } else if (entry.type === "directory") {
              // Don't mark directory as seen yet - it will be handled at the start
              // of its own processDirectory call
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

  async initialize(
    ignoreService: IgnoreService = new DefaultIgnoreService()
  ): Promise<void> {
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

    this.ignoreService = ignoreService;

    // Propagate ignore service to all targets
    if (this.primaryTarget) {
      this.primaryTarget.setIgnoreService(this.ignoreService);
    }
    for (const target of this.secondaryTargets.values()) {
      target.setIgnoreService(this.ignoreService);
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
