/**
 * Utility functions for working with IndexedDB
 */

// Use DOM lib types
/// <reference lib="dom" />

// Declare global window type for environments that don't have it
declare const window: {
  indexedDB: IDBFactory;
} & typeof globalThis;

/**
 * Deletes an IndexedDB database by name
 * @param dbName The name of the database to delete
 * @returns A promise that resolves when the database is deleted
 */
export function deleteIndexedDB(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if IndexedDB is available in browser environment
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }

    try {
      // Request to delete the database
      const request = window.indexedDB.deleteDatabase(dbName);

      // Handle success
      request.onsuccess = () => {
        console.log(`Successfully deleted IndexedDB database: ${dbName}`);
        resolve();
      };

      // Handle error
      request.onerror = (event: Event) => {
        const error = new Error(
          `Failed to delete IndexedDB database: ${dbName}`
        );
        console.error(error, event);
        reject(error);
      };

      // Handle blocking (when the database is still in use)
      request.onblocked = () => {
        const error = new Error(
          `IndexedDB deletion was blocked for database: ${dbName}`
        );
        console.error(error);
        // Still resolve as we've initiated the deletion
        resolve();
      };
    } catch (error) {
      console.error(
        `Error attempting to delete IndexedDB database: ${dbName}`,
        error
      );
      reject(error);
    }
  });
}
