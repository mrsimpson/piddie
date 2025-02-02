import type {
  FileWatcher,
  WatcherOptions,
  FileChangeInfo
} from "@piddie/shared-types";

/**
 * Registry for managing file watchers with priority-based execution
 */
export class WatcherRegistry {
  private watchers = new Map<string, FileWatcher>();
  private nextWatcherId = 0;

  /**
   * Register a new watcher
   * @param options - Options for the watcher registration
   * @param callback - Callback function to be called when changes occur
   * @returns Promise resolving to the watcher ID
   */
  async register(
    options: WatcherOptions,
    callback: (changes: FileChangeInfo[]) => void
  ): Promise<string> {
    const id = `watcher_${this.nextWatcherId++}`;

    if (!options.metadata?.registeredBy) {
      throw new Error("Watcher registration requires metadata.registeredBy");
    }

    const watcher: FileWatcher = {
      id,
      callback,
      priority: options.priority,
      ...(options.filter && { filter: options.filter }),
      metadata: {
        registeredAt: Date.now(),
        executionCount: 0,
        ...options.metadata
      }
    };

    this.watchers.set(id, watcher);
    return id;
  }

  /**
   * Unregister a watcher by its ID
   * @param id - ID of the watcher to unregister
   * @returns Promise resolving to true if the watcher was found and removed
   */
  async unregister(id: string): Promise<boolean> {
    return this.watchers.delete(id);
  }

  /**
   * Notify all registered watchers of changes
   * @param changes - Array of file changes to notify about
   */
  async notify(changes: FileChangeInfo[]): Promise<void> {
    const sortedWatchers = Array.from(this.watchers.values()).sort(
      (a, b) => b.priority - a.priority
    );

    for (const watcher of sortedWatchers) {
      try {
        // Apply filter if exists
        const filteredChanges = watcher.filter
          ? changes.filter(watcher.filter)
          : changes;

        if (filteredChanges.length > 0) {
          await watcher.callback(filteredChanges);

          // Update metadata
          if (watcher.metadata) {
            watcher.metadata.lastExecuted = Date.now();
            watcher.metadata.executionCount++;
          }
        }
      } catch (error) {
        console.error(`Error in watcher ${watcher.id}:`, error);
        // We don't throw here to ensure other watchers still run
      }
    }
  }

  /**
   * Check if there are any watchers registered
   * @returns true if there are watchers, false otherwise
   */
  hasWatchers(): boolean {
    return this.watchers.size > 0;
  }

  /**
   * Get information about all registered watchers
   * @returns Array of watcher information
   */
  getWatcherInfo(): Array<{ id: string; metadata: any }> {
    return Array.from(this.watchers.values()).map(({ id, metadata }) => ({
      id,
      metadata
    }));
  }

  /**
   * Clear all registered watchers
   */
  clear(): void {
    this.watchers.clear();
  }
}
