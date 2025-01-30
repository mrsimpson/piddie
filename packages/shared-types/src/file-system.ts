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
  content?: string;
}

/**
 * Metadata about a file
 */
export interface FileMetadata {
  /**
   * Path relative to workspace root
   */
  path: string;

  /**
   * Type of the file
   */
  type: "file";

  /**
   * Hash of the file content
   */
  hash: string;

  /**
   * Size in bytes
   */
  size: number;

  /**
   * Last modification time
   */
  lastModified: number;
}

/**
 * Information about a chunk of file content
 */
export interface FileChunk {
  /**
   * Content of this chunk
   */
  content: string;

  /**
   * Index of this chunk (0-based)
   */
  chunkIndex: number;

  /**
   * Total number of chunks for this file
   */
  totalChunks: number;

  /**
   * Hash of this chunk for verification
   */
  chunkHash: string;
}

/**
 * Stream interface for reading file contents using Web Streams API
 */
export interface FileContentStream {
  /**
   * File metadata
   */
  metadata: FileMetadata;

  /**
   * Get a Web Streams reader for the file content
   * Returns chunks of file content
   */
  getReader(): ReadableStreamDefaultReader<FileChunk>;

  /**
   * Close the stream and free resources
   */
  close(): Promise<void>;
}

/**
 * Lock mode for file system operations
 */
export type LockMode = "sync" | "external";

/**
 * Lock state of file system operations
 */
export interface LockState {
  isLocked: boolean;
  lockedSince?: number;
  lockTimeout?: number;
  lockReason?: string;
  lockMode?: LockMode;
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
export interface FileSystem {
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
  getMetadata(path: string): Promise<FileMetadata>;

  /**
   * Lock with timeout
   * @param timeoutMs Timeout in milliseconds
   * @param reason Reason for locking
   * @param mode Lock mode - 'sync' allows sync operations, 'external' blocks all writes
   */
  lock(timeoutMs: number, reason: string, mode?: LockMode): Promise<void>;

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
