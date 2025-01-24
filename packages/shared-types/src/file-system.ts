import type { FileSystemTree } from "@webcontainer/api";

//TODO: Own type - use the webcontainer definition for the time being
export type { FileSystemTree };

/**
 * Represents a file or directory in the file system
 */
export interface FileSystemItem {
  path: string;
  type: "file" | "directory";
  lastModified: number;
  size?: number;
  content?: string;
}

/**
 * Lock state of file system operations
 */
export interface LockState {
  isLocked: boolean;
  lockedSince?: number;
  lockTimeout?: number;
  lockReason?: string;
}

/**
 * File system state information
 */
export interface FileSystemState {
  lockState: LockState;
  pendingOperations: number;
  lastOperation?: {
    type: string;
    path: string;
    timestamp: number;
  };
}

/**
 * Interface for file system operations
 */
export interface FileSystemManager {
  /**
   * Initialize the file system
   */
  initialize(): Promise<void>;

  /**
   * List contents of a directory
   */
  listDirectory(path: string): Promise<FileSystemItem[]>;

  /**
   * Read file content
   */
  readFile(path: string): Promise<string>;

  /**
   * Write file content
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Create directory
   */
  createDirectory(path: string): Promise<void>;

  /**
   * Delete file or directory
   */
  deleteItem(path: string): Promise<void>;

  /**
   * Check if path exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get metadata for a path
   */
  getMetadata(path: string): Promise<FileSystemItem>;

  /**
   * Lock with timeout
   */
  lock(timeoutMs: number, reason: string): Promise<void>;

  /**
   * Force unlock
   */
  forceUnlock(): Promise<void>;

  /**
   * Get current state
   */
  getState(): FileSystemState;
}

/**
 * Error types for file system operations
 */
export class FileSystemError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_FOUND"
      | "PERMISSION_DENIED"
      | "LOCKED"
      | "ALREADY_EXISTS"
      | "INVALID_OPERATION"
  ) {
    super(message);
    this.name = "FileSystemError";
  }
}
