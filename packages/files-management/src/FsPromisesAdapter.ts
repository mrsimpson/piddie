import {
  FileSystem,
  FileSystemState,
  FileSystemError,
  FileMetadata,
  FileSystemItem,
  LockMode
} from "@piddie/shared-types";
import type { FileSystemStateType } from "@piddie/shared-types";
import { VALID_FILE_SYSTEM_STATE_TRANSITIONS } from "@piddie/shared-types";

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
 * Minimum required subset of fs.promises API that we need
 */
export interface MinimalFsPromises {
  mkdir(
    path: string,
    options?: { recursive?: boolean; isSyncOperation?: boolean }
  ): Promise<void | string | undefined>;
  readdir(
    path: string,
    options: { withFileTypes: true }
  ): Promise<{ name: string; isDirectory(): boolean; isFile(): boolean }[]>;
  stat(path: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
    mtimeMs: number;
    size: number;
  }>;
  readFile(path: string, encoding: string): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: string; isSyncOperation?: boolean }
  ): Promise<void>;
  rm?(
    path: string,
    options?: { recursive?: boolean; isSyncOperation?: boolean }
  ): Promise<void>;
  unlink(path: string, options?: { isSyncOperation?: boolean }): Promise<void>;
  access?(path: string): Promise<void>;
}

/**
 * Configuration options for the FsPromisesAdapter
 */
export interface FsPromisesAdapterOptions {
  /**
   * The root directory for all operations
   */
  rootDir: string;
  /**
   * The fs.promises-like implementation to use
   */
  fs: MinimalFsPromises;
}

/**
 * Adapts any fs.promises-like implementation to our FileSystem interface.
 * This serves as the base for both node's fs.promises and browser-based implementations like LightningFS.
 */
export class FsPromisesAdapter implements FileSystem {
  protected options: FsPromisesAdapterOptions;
  protected currentState: FileSystemStateType = "uninitialized";
  protected lockState: FileSystemState["lockState"] = { isLocked: false };
  protected pendingOperations = 0;
  protected lastOperation?: FileSystemState["lastOperation"];

  constructor(options: FsPromisesAdapterOptions) {
    this.options = options;
  }

  validateStateTransition(
    from: FileSystemStateType,
    to: FileSystemStateType,
    via: string
  ): boolean {
    return VALID_FILE_SYSTEM_STATE_TRANSITIONS.some(
      (t) => t.from === from && t.to === to && t.via === via
    );
  }

  getCurrentState(): FileSystemStateType {
    return this.currentState;
  }

  transitionTo(newState: FileSystemStateType, via: string): void {
    const fromState = this.currentState;

    // If we're already in error state, don't try to transition again
    if (this.currentState === "error" && via !== "recovery") {
      return;
    }

    if (!this.validateStateTransition(this.currentState, newState, via)) {
      // Special case: when transitioning to error state, just set it
      if (newState === "error") {
        this.currentState = "error";
        return;
      }

      this.currentState = "error";
      throw new FileSystemError(
        `Invalid state transition from ${fromState} to ${newState} via ${via}`,
        "INVALID_OPERATION"
      );
    }
    this.currentState = newState;
  }

  getState(): FileSystemState {
    return {
      lockState: this.lockState,
      pendingOperations: this.pendingOperations,
      lastOperation: this.lastOperation,
      currentState: this.currentState
    };
  }

  /**
   * Normalize a path according to the file system's rules
   * Can be overridden by implementations that can't use Node's path module
   */
  protected normalizePath(filePath: string): string {
    return browserPath.normalize(filePath);
  }

  /**
   * Get the directory name from a path
   * Can be overridden by implementations that can't use Node's path module
   */
  protected getDirname(filePath: string): string {
    return browserPath.dirname(filePath);
  }

  /**
   * Get the base name from a path
   * Can be overridden by implementations that can't use Node's path module
   */
  protected getBasename(filePath: string): string {
    return browserPath.basename(filePath);
  }

  /**
   * Join path segments according to the file system's rules
   * Can be overridden by implementations that can't use Node's path module
   */
  protected joinPaths(...paths: string[]): string {
    return browserPath.join(...paths);
  }

  /**
   * Get the absolute path for a relative path
   */
  protected getAbsolutePath(relativePath: string): string {
    const normalizedPath = this.normalizePath(relativePath);
    return this.joinPaths(this.options.rootDir, normalizedPath);
  }

  async initialize(): Promise<void> {
    // If already in error state, don't try to initialize
    if (this.currentState === "error") {
      throw new FileSystemError(
        "File system is in error state",
        "INVALID_OPERATION"
      );
    }

    try {
      // Check if root directory exists first
      try {
        if (this.options.fs.access) {
          await this.options.fs.access(this.options.rootDir);
        } else {
          await this.options.fs.stat(this.options.rootDir);
        }
      } catch {
        // Directory doesn't exist, create it
        await this.options.fs.mkdir(this.options.rootDir, { recursive: true });
      }

      this.transitionTo("ready", "initialize");
    } catch (error) {
      this.transitionTo("error", "initialize");
      if (error instanceof Error) {
        throw new FileSystemError(
          `Failed to initialize file system: ${error.message}`,
          "INVALID_OPERATION"
        );
      }
      throw error;
    }
  }

  private ensureInitialized() {
    if (this.currentState === "error") {
      throw new FileSystemError(
        "File system is in error state",
        "INVALID_OPERATION"
      );
    }
  }

  private checkLock(
    operation: "read" | "write" = "write",
    isSyncOperation: boolean = false
  ) {
    if (this.lockState.isLocked) {
      // Always allow read operations
      if (operation === "read") {
        return;
      }

      // Allow write operations during sync mode only for sync operations
      if (this.lockState.lockMode === "sync" && isSyncOperation) {
        return;
      }

      throw new FileSystemError(
        `File system is locked: ${this.lockState.lockReason}`,
        "LOCKED"
      );
    }
  }

  async readFile(filePath: string): Promise<string> {
    this.ensureInitialized();
    this.checkLock("read");

    const absolutePath = this.getAbsolutePath(filePath);

    try {
      const content = await this.options.fs.readFile(absolutePath, "utf-8");
      return content;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["NOT_FOUND", "ENOENT"].includes(error.code as string)
      ) {
        throw new FileSystemError(`File not found: ${filePath}`, "NOT_FOUND");
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new FileSystemError(message, "PERMISSION_DENIED");
    }
  }

  async writeFile(
    path: string,
    content: string,
    isSyncOperation: boolean = false
  ): Promise<void> {
    this.ensureInitialized();
    this.checkLock("write", isSyncOperation);

    const absolutePath = this.getAbsolutePath(path);

    try {
      await this.options.fs.writeFile(absolutePath, content, {
        encoding: "utf8",
        isSyncOperation
      });

      this.lastOperation = {
        type: "write",
        path,
        timestamp: Date.now()
      };
    } catch (error: unknown) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new FileSystemError(
        `Failed to write file ${path}: ${error instanceof Error ? error.message : "Unknown error"}`,
        "INVALID_OPERATION"
      );
    }
  }

  async exists(itemPath: string): Promise<boolean> {
    this.ensureInitialized();
    this.checkLock("read");

    try {
      const absolutePath = this.getAbsolutePath(itemPath);
      if (this.options.fs.access) {
        await this.options.fs.access(absolutePath);
      } else {
        await this.options.fs.stat(absolutePath);
      }
      return true;
    } catch {
      return false;
    }
  }

  async deleteItem(
    path: string,
    options?: { recursive?: boolean },
    isSyncOperation: boolean = false
  ): Promise<void> {
    this.ensureInitialized();
    this.checkLock("write", isSyncOperation);

    const absolutePath = this.getAbsolutePath(path);

    try {
      // First check if item exists
      const exists = await this.exists(absolutePath);
      if (!exists) {
        throw new FileSystemError(`Path not found: ${path}`, "NOT_FOUND");
      }

      const stats = await this.options.fs.stat(absolutePath);
      if (stats.isDirectory()) {
        if (this.options.fs.rm) {
          await this.options.fs.rm(absolutePath, {
            recursive: !!options?.recursive
          });
        } else {
          // Fallback implementation if rm is not available
          const entries = await this.options.fs.readdir(absolutePath, {
            withFileTypes: true
          });

          if (entries.length > 0 && !options?.recursive) {
            throw new FileSystemError(
              `Directory not empty: ${path}. Use recursive option to delete non-empty directories.`,
              "INVALID_OPERATION"
            );
          }

          if (options?.recursive && entries.length > 0) {
            await Promise.all(
              entries.map((entry) => {
                const fullPath = this.joinPaths(absolutePath, entry.name);
                return entry.isDirectory()
                  ? this.deleteItem(
                      fullPath,
                      { recursive: true },
                      isSyncOperation
                    )
                  : this.options.fs.unlink(fullPath);
              })
            );
          }
          await this.options.fs.unlink(absolutePath);
        }
      } else {
        await this.options.fs.unlink(absolutePath);
      }
    } catch (error: unknown) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new FileSystemError(message, "PERMISSION_DENIED");
    }
  }

  async createDirectory(
    path: string,
    options?: { recursive?: boolean },
    isSyncOperation: boolean = false
  ): Promise<void> {
    this.ensureInitialized();
    this.checkLock("write", isSyncOperation);

    const absolutePath = this.getAbsolutePath(path);

    try {
      await this.options.fs.mkdir(absolutePath, {
        recursive: !!options?.recursive
      });
    } catch (error: unknown) {
      // If it's already our error type, rethrow it
      if (error instanceof FileSystemError) {
        throw error;
      }
      // Handle native filesystem errors
      if (error instanceof Error) {
        if (error.message.includes("EEXIST")) {
          // Directory already exists - throw ALREADY_EXISTS if not recursive
          if (!options?.recursive) {
            throw new FileSystemError(
              `Directory already exists: ${path}`,
              "ALREADY_EXISTS"
            );
          }
          // With recursive=true, silently succeed
          return;
        }
        if (error.message.includes("ENOENT")) {
          // Parent directory doesn't exist and recursive is false
          throw new FileSystemError(
            `Cannot create directory '${path}': parent directory does not exist. Use recursive option to create parent directories.`,
            "NOT_FOUND"
          );
        }
      }
      // For any other error, wrap as INVALID_OPERATION
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new FileSystemError(
        `Failed to create directory: ${message}`,
        "INVALID_OPERATION"
      );
    }
  }

  async listDirectory(dirPath: string): Promise<FileSystemItem[]> {
    this.ensureInitialized();
    this.checkLock("read");

    const absolutePath = this.getAbsolutePath(dirPath);

    try {
      // First check if directory exists – it doesn't need the absolute path, exists() will absolute it itself
      const exists = await this.exists(dirPath);
      if (!exists) {
        throw new FileSystemError(
          `Directory not found: ${dirPath}`,
          "NOT_FOUND"
        );
      }

      // Then check if it's actually a directory
      const stats = await this.options.fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        throw new FileSystemError(
          `Path is not a directory: ${dirPath}`,
          "INVALID_OPERATION"
        );
      }

      const entries = await this.options.fs.readdir(absolutePath, {
        withFileTypes: true
      });
      const items = await Promise.all(
        entries.map(async (entry) => {
          const itemPath = this.joinPaths(dirPath, entry.name);
          const stats = await this.options.fs.stat(
            this.getAbsolutePath(itemPath)
          );

          const item: FileSystemItem = {
            path: itemPath,
            type: entry.isDirectory() ? "directory" : "file",
            lastModified: stats.mtimeMs,
            ...(entry.isFile() && { size: stats.size })
          };
          return item;
        })
      );

      return items;
    } catch (error: unknown) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new FileSystemError(message, "PERMISSION_DENIED");
    }
  }

  async getMetadata(itemPath: string): Promise<FileMetadata> {
    this.ensureInitialized();
    this.checkLock("read");

    const absolutePath = this.getAbsolutePath(itemPath);

    try {
      const stats = await this.options.fs.stat(absolutePath);

      if (stats.isDirectory()) {
        return {
          path: itemPath,
          type: "directory",
          hash: "", // Directories don't have a hash
          size: 0, // Directories don't have a size
          lastModified: stats.mtimeMs
        };
      }

      // For files, include hash and size
      let hash = "";
      try {
        const content = await this.options.fs.readFile(absolutePath, "utf-8");
        hash = await this.calculateHash(content);
      } catch (error) {
        // If we can't read the file, still return metadata but with empty hash
        console.warn(
          `Could not read file content for hash: ${itemPath}`,
          error
        );
      }

      return {
        path: itemPath,
        type: "file",
        hash,
        size: stats.size,
        lastModified: stats.mtimeMs
      };
    } catch (error: unknown) {
      // If it's already our error type, rethrow it
      if (error instanceof FileSystemError) {
        throw error;
      }
      // Convert filesystem errors to our error types
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new FileSystemError(`Path not found: ${itemPath}`, "NOT_FOUND");
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new FileSystemError(message, "PERMISSION_DENIED");
    }
  }

  /**
   * Calculate a hash for the given content
   * This is a simple implementation - in production you'd want a more robust hashing algorithm
   */
  protected async calculateHash(content: string): Promise<string> {
    // Simple hash function for demo purposes
    // In production, use a proper crypto hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  async lock(
    timeoutMs: number,
    reason: string,
    mode: LockMode = "external"
  ): Promise<void> {
    // If already locked, just update the timeout and reason if needed
    if (this.lockState.isLocked) {
      // Only update if the lock mode matches
      if (this.lockState.lockMode === mode) {
        this.lockState = {
          ...this.lockState,
          lockTimeout: timeoutMs,
          lockReason: reason
        };
        return;
      }
      // If modes don't match, throw error
      throw new FileSystemError(
        `File system already locked in ${this.lockState.lockMode} mode`,
        "LOCKED"
      );
    }

    const originalLockedSince = Date.now();
    // Just set the lock state without transitioning state
    this.lockState = {
      isLocked: true,
      lockedSince: originalLockedSince,
      lockTimeout: timeoutMs,
      lockReason: reason,
      lockMode: mode
    };

    // Set up timeout to automatically unlock
    setTimeout(() => {
      if (
        this.lockState.isLocked &&
        this.lockState.lockedSince === originalLockedSince
      ) {
        this.lockState = { isLocked: false };
      }
    }, timeoutMs);
  }

  async forceUnlock(): Promise<void> {
    if (!this.lockState.isLocked) {
      return;
    }

    // Just clear the lock state without transitioning state
    this.lockState = { isLocked: false };
  }
}
