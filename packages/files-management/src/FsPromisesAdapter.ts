import {
  FileSystem,
  FileSystemState,
  FileSystemError,
  FileMetadata,
  FileSystemItem,
  LockMode
} from "@piddie/shared-types";
import path from "path";
import type {
  FileSystemStateType
} from "@piddie/shared-types";
import { VALID_FILE_SYSTEM_STATE_TRANSITIONS } from "@piddie/shared-types";

/**
 * Minimum required subset of fs.promises API that we need
 */
export interface MinimalFsPromises {
  mkdir(
    path: string,
    options?: { recursive?: boolean }
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
  writeFile(path: string, data: string, encoding: string): Promise<void>;
  rm?(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
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

  validateStateTransition(from: FileSystemStateType, to: FileSystemStateType, via: string): boolean {
    return VALID_FILE_SYSTEM_STATE_TRANSITIONS.some(
      t => t.from === from && t.to === to && t.via === via
    );
  }

  getCurrentState(): FileSystemStateType {
    return this.currentState;
  }

  transitionTo(newState: FileSystemStateType, via: string): void {
    // If we're already in error state, don't try to transition again
    if (this.currentState === "error") {
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
        `Invalid state transition from ${this.currentState} to ${newState} via ${via}`,
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
    return path.normalize(filePath).replace(/^\//, "");
  }

  /**
   * Get the directory name from a path
   * Can be overridden by implementations that can't use Node's path module
   */
  protected getDirname(filePath: string): string {
    return path.dirname(filePath);
  }

  /**
   * Get the base name from a path
   * Can be overridden by implementations that can't use Node's path module
   */
  protected getBasename(filePath: string): string {
    return path.basename(filePath);
  }

  /**
   * Join path segments according to the file system's rules
   * Can be overridden by implementations that can't use Node's path module
   */
  protected joinPaths(...paths: string[]): string {
    return path.join(...paths);
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
      throw new FileSystemError("File system is in error state", "INVALID_OPERATION");
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
      throw new FileSystemError("File system is in error state", "INVALID_OPERATION");
    }
  }

  private checkLock(operation: 'read' | 'write' = 'write') {
    if (this.lockState.isLocked) {
      // Allow read operations during sync mode
      if (operation === 'read') {
        return;
      }

      // Allow write operations during sync mode if they are part of the sync process
      if (this.lockState.lockMode === 'sync') {
        return; // Allow sync operations
      }

      throw new FileSystemError(
        `File system is locked: ${this.lockState.lockReason}`,
        "LOCKED"
      );
    }
  }

  async readFile(filePath: string): Promise<string> {
    this.ensureInitialized();
    this.checkLock('read');

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

  async writeFile(filePath: string, content: string): Promise<void> {
    this.ensureInitialized();
    this.checkLock('write');

    const absolutePath = this.getAbsolutePath(filePath);
    const parentDir = this.getDirname(absolutePath);

    try {
      // Check if parent directory exists
      const parentExists = await this.exists(parentDir);
      if (!parentExists) {
        throw new FileSystemError(
          `Parent directory does not exist: ${parentDir}`,
          "NOT_FOUND"
        );
      }

      await this.options.fs.writeFile(absolutePath, content, "utf-8");
    } catch (error: unknown) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new FileSystemError(message, "PERMISSION_DENIED");
    }
  }

  async exists(itemPath: string): Promise<boolean> {
    this.ensureInitialized();
    this.checkLock('read');

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

  async deleteItem(itemPath: string): Promise<void> {
    this.ensureInitialized();
    this.checkLock('write');

    const absolutePath = this.getAbsolutePath(itemPath);

    try {
      // First check if item exists
      const exists = await this.exists(absolutePath);
      if (!exists) {
        throw new FileSystemError(`Path not found: ${itemPath}`, "NOT_FOUND");
      }

      const stats = await this.options.fs.stat(absolutePath);
      if (stats.isDirectory()) {
        if (this.options.fs.rm) {
          await this.options.fs.rm(absolutePath, { recursive: true });
        } else {
          // Fallback implementation if rm is not available
          const entries = await this.options.fs.readdir(absolutePath, {
            withFileTypes: true
          });
          await Promise.all(
            entries.map((entry) => {
              const fullPath = this.joinPaths(absolutePath, entry.name);
              return entry.isDirectory()
                ? this.deleteItem(fullPath)
                : this.options.fs.unlink(fullPath);
            })
          );
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

  async createDirectory(dirPath: string): Promise<void> {
    this.ensureInitialized();
    this.checkLock('write');

    const absolutePath = this.getAbsolutePath(dirPath);

    try {
      await this.options.fs.mkdir(absolutePath, { recursive: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new FileSystemError(message, "PERMISSION_DENIED");
    }
  }

  async listDirectory(dirPath: string): Promise<FileSystemItem[]> {
    this.ensureInitialized();
    this.checkLock('read');

    const absolutePath = this.getAbsolutePath(dirPath);

    try {
      // First check if directory exists
      const exists = await this.exists(absolutePath);
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
    this.checkLock('read');

    const absolutePath = this.getAbsolutePath(itemPath);

    try {
      const stats = await this.options.fs.stat(absolutePath);

      if (stats.isDirectory()) {
        throw new FileSystemError(
          `Path is not a file: ${itemPath}`,
          "INVALID_OPERATION"
        );
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

  async lock(timeoutMs: number, reason: string, mode: LockMode = "external"): Promise<void> {
    if (this.lockState.isLocked) {
      throw new FileSystemError("File system already locked", "LOCKED");
    }

    this.transitionTo("locked", "lock");
    this.lockState = {
      isLocked: true,
      lockedSince: Date.now(),
      lockTimeout: timeoutMs,
      lockReason: reason,
      lockMode: mode
    };
  }

  async forceUnlock(): Promise<void> {
    if (!this.lockState.isLocked) {
      return;
    }

    this.transitionTo("ready", "unlock");
    this.lockState = { isLocked: false };
  }
}
