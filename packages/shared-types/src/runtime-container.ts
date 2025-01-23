import { FileSystemTree } from "./file-system";

/**
 * Abstraction interface for a containerized runtime environment.
 * It is intentionally based upon the webcontainer abilities.
 * However, other implementations of such a container (e. g. a docker container)
 * can be imagined.
 */
export interface RuntimeContainer {
  /**
   * Mount a file system tree into the RuntimeContainer
   * @param files - File system tree to mount
   */
  mount(files: FileSystemTree): Promise<void>;

  /**
   * Read a file from the RuntimeContainer file system
   * @param path - Path to the file
   * @returns File contents as a string
   */
  readFile(path: string): Promise<string>;

  /**
   * Write a file to the RuntimeContainer file system
   * @param path - Path to write the file
   * @param contents - File contents
   */
  writeFile(path: string, contents: string): Promise<void>;

  /**
   * List contents of a directory in the RuntimeContainer file system
   * @param path - Path to the directory
   * @returns Array of file and directory names
   */
  listDirectory(path: string): Promise<string[]>;

  /**
   * Create a directory in the RuntimeContainer file system
   * @param path - Path for the new directory
   * @param options - Optional recursive directory creation
   */
  createDirectory(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void>;

  /**
   * Delete a file or directory from the RuntimeContainer file system
   * @param path - Path to the file or directory
   * @param options - Optional recursive deletion
   */
  deleteItem(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Start the RuntimeContainer instance
   * @returns Promise resolving when the container is ready
   */
  start(): Promise<void>;

  /**
   * Run a command in the RuntimeContainer
   * @param command - Command to run
   * @param options - Optional run configuration
   * @returns Promise with command execution result
   */
  run(
    command: string,
    options?: {
      env?: Record<string, string>;
      terminal?: boolean;
    }
  ): Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>;

  /**
   * Get the URL of the running RuntimeContainer instance
   * @returns URL of the running instance
   */
  getUrl(): URL;
}

/**
 * Factory for creating RuntimeContainer adapters
 */
export interface RuntimeContainerAdapterFactory {
  /**
   * Create a new RuntimeContainer adapter
   * @param initialFiles - Optional initial file system tree
   */
  create(initialFiles?: FileSystemTree): Promise<RuntimeContainer>;
}
