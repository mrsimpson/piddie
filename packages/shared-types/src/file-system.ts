import type { FileSystemTree } from "@webcontainer/api";

//TODO: Own type - use the webcontainer definition for the time being
export type { FileSystemTree };

/**
 * Represents a file or directory in the file system
 */
export interface FileSystemItem {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  lastModified: number;
  size?: number;
  content?: string;
}

/**
 * Configuration options for file system operations
 */
export interface FileSystemConfig {
  rootPath?: string;
  maxFileSize?: number;
  allowedFileTypes?: string[];
}

/**
 * Interface for file system operations
 */
export interface FileSystemManager {
  initialize(config?: FileSystemConfig): Promise<void>;
  listDirectory(path: string): Promise<FileSystemItem[]>;
  readFile(path: string): Promise<string>;
  writeFile(
    path: string,
    content: string,
    options?: {
      overwrite?: boolean;
      createParentDirs?: boolean;
    }
  ): Promise<void>;
  createDirectory(
    path: string,
    options?: {
      recursive?: boolean;
    }
  ): Promise<void>;
  deleteItem(
    path: string,
    options?: {
      recursive?: boolean;
    }
  ): Promise<void>;
  renameItem(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  getMetadata(path: string): Promise<FileSystemItem>;
}

/**
 * Error types for file system and sync operations
 */
export class FileSystemError extends Error {
  constructor(
    message: string,
    public code?:
      | "FILE_NOT_FOUND"
      | "PERMISSION_DENIED"
      | "SYNC_CONFLICT"
      | "NETWORK_ERROR"
  ) {
    super(message);
    this.name = "FileSystemError";
  }
}
