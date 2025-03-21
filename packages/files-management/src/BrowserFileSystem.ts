import FS from "@isomorphic-git/lightning-fs";
import { FsPromisesAdapter, MinimalFsPromises } from "./FsPromisesAdapter";
import type { MKDirOptions } from "@isomorphic-git/lightning-fs";
import type {
  FileSystem,
  FileSystemState,
  FileSystemStateType
} from "@piddie/shared-types";
import { FileSystemError } from "@piddie/shared-types";

/**
 * Browser-compatible path utilities
 */
const browserPath = {
  normalize(path: string): string {
    // Remove leading and trailing slashes, collapse multiple slashes
    return path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  },

  dirname(path: string): string {
    const normalized = browserPath.normalize(path);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash === -1) return "/";
    return normalized.slice(0, lastSlash) || "/";
  },

  basename(path: string): string {
    const normalized = browserPath.normalize(path);
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  },

  join(...parts: string[]): string {
    return (
      "/" +
      parts
        .map((part) => browserPath.normalize(part))
        .filter(Boolean)
        .join("/")
    );
  }
};

/**
 * Browser implementation of the FileSystem interface using LightningFS.
 * This implementation uses LightningFS for browser-based file system operations.
 */
export class BrowserFileSystem extends FsPromisesAdapter implements FileSystem {
  protected override currentState: FileSystemStateType = "uninitialized";
  protected override lockState: FileSystemState["lockState"] = {
    isLocked: false
  };
  protected override pendingOperations = 0;
  declare protected lastOperation?: FileSystemState["lastOperation"];

  /**
   * The name of the file system, used as the IndexedDB database name
   */
  private fsName: string;

  /**
   * Creates a new instance of BrowserFileSystem
   * @param options Configuration options for the file system
   */
  constructor(options: {
    /**
     * The name of the file system. This is used as a key for IndexedDB storage.
     */
    name: string;
    /**
     * The root directory for all operations
     */
    rootDir: string;
  }) {
    // Initialize LightningFS
    const fs = new FS(options.name);

    // Create a wrapper that adds missing methods
    const fsWrapper: MinimalFsPromises = {
      mkdir: async (path: string, options?: { recursive?: boolean }) => {
        try {
          // First check if directory exists
          const stats = await fs.promises.stat(path);
          if (stats.isDirectory()) {
            if (!options?.recursive) {
              throw new FileSystemError(
                `Directory already exists: ${path}`,
                "ALREADY_EXISTS"
              );
            }
            // With recursive=true, silently succeed
            return;
          }
          throw new FileSystemError(
            `Path exists but is not a directory: ${path}`,
            "INVALID_OPERATION"
          );
        } catch (error) {
          // If error is ENOENT (not found), proceed with creation
          if (error instanceof Error && error.message.includes("ENOENT")) {
            if (!options?.recursive) {
              // For non-recursive, verify parent exists
              const parentPath = this.getAbsolutePath(
                browserPath.dirname(path)
              );
              try {
                const parentStats = await fs.promises.stat(parentPath);
                if (!parentStats.isDirectory()) {
                  throw new FileSystemError(
                    `Parent path exists but is not a directory: ${parentPath}`,
                    "INVALID_OPERATION"
                  );
                }
              } catch (parentError) {
                if (
                  parentError instanceof Error &&
                  parentError.message.includes("ENOENT")
                ) {
                  throw new FileSystemError(
                    `Parent directory does not exist: ${parentPath}`,
                    "NOT_FOUND"
                  );
                }
                throw parentError;
              }
            }
            // Create the directory
            return fs.promises.mkdir(path, {
              mode: 0o777,
              ...options
            } as MKDirOptions);
          }
          // If it's our error type, rethrow it
          if (error instanceof FileSystemError) {
            throw error;
          }
          // Otherwise wrap in a FileSystemError
          throw new FileSystemError(
            `Failed to create directory: ${path}`,
            "INVALID_OPERATION"
          );
        }
      },
      readdir: async (path: string) => {
        const entries = await fs.promises.readdir(path);
        const results = await Promise.all(
          entries.map(async (name) => {
            const stats = await fs.promises.stat(browserPath.join(path, name));
            return {
              name,
              isDirectory: () => stats.isDirectory(),
              isFile: () => stats.isFile()
            };
          })
        );
        return results;
      },
      stat: async (path: string) => {
        const stats = await fs.promises.stat(path);
        return {
          isDirectory: () => stats.isDirectory(),
          isFile: () => stats.isFile(),
          mtimeMs: stats.mtimeMs,
          size: stats.size
        };
      },
      readFile: (path: string) =>
        fs.promises.readFile(path, { encoding: "utf8" }) as Promise<string>,
      writeFile: async (
        path: string,
        data: string,
        options?: { encoding?: string; isSyncOperation?: boolean }
      ) => {
        if (this.lockState.isLocked && !options?.isSyncOperation) {
          throw new FileSystemError("File system is locked", "LOCKED");
        }
        await fs.promises.writeFile(path, data, {
          mode: 0o666,
          encoding: "utf8"
        });
        this.lastOperation = {
          type: "write",
          path,
          timestamp: Date.now()
        };
      },
      unlink: fs.promises.unlink,
      rm: async (path: string, options?: { recursive?: boolean }) => {
        const stats = await fs.promises.stat(path);
        if (stats.isDirectory()) {
          const entries = await fs.promises.readdir(path);
          if (entries.length > 0 && !options?.recursive) {
            throw new FileSystemError(
              `Directory not empty: ${path}. Use recursive option to delete non-empty directories.`,
              "INVALID_OPERATION"
            );
          }
          if (options?.recursive && entries.length > 0) {
            // First recursively delete all entries
            for (const entry of entries) {
              const entryPath = browserPath.join(path, entry);
              const entryStats = await fs.promises.stat(entryPath);
              if (entryStats.isDirectory()) {
                await fs.promises.rmdir(entryPath);
              } else {
                await fs.promises.unlink(entryPath);
              }
            }
          }
          // Then remove the empty directory
          await fs.promises.rmdir(path);
        } else {
          await fs.promises.unlink(path);
        }
      },
      access: async (path: string) => {
        await fs.promises.stat(path);
      }
    };

    super({
      rootDir: options.rootDir,
      fs: fsWrapper
    });

    // Store the file system name for later use in dispose
    this.fsName = options.name;
  }

  protected override normalizePath(filePath: string): string {
    return browserPath.normalize(filePath);
  }

  protected override getDirname(filePath: string): string {
    return browserPath.dirname(filePath);
  }

  protected override getBasename(filePath: string): string {
    return browserPath.basename(filePath);
  }

  protected override joinPaths(...paths: string[]): string {
    return browserPath.join(...paths);
  }

  override async initialize(): Promise<void> {
    // If already in error state, don't try to initialize
    if (this.currentState === "error") {
      throw new FileSystemError(
        "File system is in error state",
        "INVALID_OPERATION"
      );
    }

    // If already initialized, don't initialize again
    if (this.currentState !== "uninitialized") {
      return;
    }

    try {
      // First try to access the root directory
      try {
        await this.options.fs.access!(this.options.rootDir);
      } catch {
        // If access fails, try to create the directory
        try {
          await this.options.fs.mkdir(this.options.rootDir, {
            recursive: true
          });
        } catch (mkdirError) {
          // If mkdir fails with EEXIST, that's fine - the directory exists
          if (
            mkdirError instanceof Error &&
            !mkdirError.message.includes("EEXIST")
          ) {
            throw mkdirError;
          }
        }
      }

      // Initialize parent class (which will handle state transition)
      await super.initialize();
    } catch (error) {
      this.transitionTo("error", "initialize");
      if (error instanceof Error) {
        throw new FileSystemError(
          `Failed to initialize browser file system: ${error.message}`,
          "INVALID_OPERATION"
        );
      }
      throw error;
    }
  }

  /**
   * Disposes of the file system by deleting the IndexedDB database
   * This should be called when the file system is no longer needed
   */
  override async dispose(): Promise<void> {
    try {
      // First, ensure we're not in the middle of any operations
      if (this.pendingOperations > 0) {
        console.warn(
          `Disposing file system with ${this.pendingOperations} pending operations`
        );
      }

      // Set state to error to prevent further operations
      this.currentState = "error";

      // Wait a bit to ensure all connections are closed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Delete the IndexedDB database
      await this.deleteIndexedDB(this.fsName);

      console.log(`Successfully disposed BrowserFileSystem: ${this.fsName}`);
    } catch (error) {
      console.error(`Error disposing BrowserFileSystem: ${this.fsName}`, error);
      // Don't rethrow the error, as we want to continue with cleanup even if disposal fails
    }
  }

  /**
   * Deletes the IndexedDB database used by this file system
   * @param dbName The name of the database to delete
   * @private
   */
  private async deleteIndexedDB(dbName: string): Promise<void> {
    // Check if IndexedDB is available in browser environment
    if (typeof window === "undefined" || !window.indexedDB) {
      console.warn("IndexedDB is not available in this environment");
      return;
    }

    try {
      // First check if the database exists
      const exists = await this.databaseExists(dbName);

      if (!exists) {
        console.log(
          `IndexedDB database ${dbName} does not exist, no need to delete`
        );
        return;
      }

      // Close any open connections to the database
      await this.closeOpenConnections(dbName);

      // Delete the database
      await new Promise<void>((resolve) => {
        // Request to delete the database
        const request = window.indexedDB.deleteDatabase(dbName);

        // Handle success
        request.onsuccess = () => {
          console.log(`Successfully deleted IndexedDB database: ${dbName}`);
          resolve();
        };

        // Handle error
        request.onerror = (event: Event) => {
          console.error(
            `Failed to delete IndexedDB database: ${dbName}`,
            event
          );
          // Resolve anyway to continue with cleanup
          resolve();
        };

        // Handle blocking (when the database is still in use)
        request.onblocked = () => {
          console.warn(
            `IndexedDB deletion was blocked for database: ${dbName}. This is expected if there are still open connections.`
          );
          // Resolve anyway to continue with cleanup
          resolve();
        };
      });
    } catch (error) {
      console.error(
        `Error attempting to delete IndexedDB database: ${dbName}`,
        error
      );
      // Don't throw, as we want to continue with cleanup even if disposal fails
    }
  }

  /**
   * Checks if an IndexedDB database exists
   * @param dbName The name of the database to check
   * @returns A promise that resolves to true if the database exists, false otherwise
   * @private
   */
  private async databaseExists(dbName: string): Promise<boolean> {
    try {
      // Check if the databases method is available
      if (
        window.indexedDB.databases &&
        typeof window.indexedDB.databases === "function"
      ) {
        // Get the list of all databases
        const databases = await window.indexedDB.databases();

        // Check if our database is in the list
        const exists = databases.some((db) => db.name === dbName);
        return exists;
      } else {
        // If databases() is not available (should not happen based on user's confirmation)
        console.warn(
          "indexedDB.databases() method is not available, assuming database exists for safety"
        );
        return true;
      }
    } catch (error) {
      console.warn(
        `Error checking if database ${dbName} exists, assuming it does for safety`,
        error
      );
      // Assume it exists to be safe
      return true;
    }
  }

  /**
   * Attempts to close any open connections to the database
   * @param dbName The name of the database
   * @private
   */
  private async closeOpenConnections(dbName: string): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        // Try to open a connection to the database
        const openRequest = window.indexedDB.open(dbName);

        openRequest.onsuccess = (event: Event) => {
          // Get the database from the event
          const db = (event.target as IDBOpenDBRequest).result;

          // Close the connection
          db.close();

          console.log(`Closed open connection to database: ${dbName}`);
          resolve();
        };

        openRequest.onerror = () => {
          console.warn(
            `Could not open connection to database: ${dbName} to close it`
          );
          resolve();
        };
      } catch (error) {
        console.warn(`Error closing connections to database: ${dbName}`, error);
        resolve();
      }
    });
  }
}
