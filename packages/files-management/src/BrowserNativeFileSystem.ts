import { FileSystemError } from "@piddie/shared-types";
import { FsPromisesAdapter } from "./FsPromisesAdapter";
import {
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
  FileSystemHandle
} from "native-file-system-adapter";

/**
 * Implementation of the FileSystem interface using the Browser's File System Access API.
 * Extends FsPromisesAdapter to provide a consistent interface while using browser-native file handles.
 */
export class BrowserNativeFileSystem extends FsPromisesAdapter {
  private rootHandle: FileSystemDirectoryHandle;

  constructor(options: { rootHandle: FileSystemDirectoryHandle }) {
    super({
      rootDir: "/",
      fs: {
        mkdir: async (dirPath: string, options = {}) => {
          const components = this.normalizePath(dirPath)
            .split("/")
            .filter(Boolean);
          let currentHandle = this.rootHandle;

          // For recursive creation, create each directory in the path
          if (options.recursive) {
            for (const component of components) {
              try {
                currentHandle = await currentHandle.getDirectoryHandle(
                  component,
                  { create: true }
                );
              } catch (error) {
                if ((error as Error)?.name === "NotFoundError") {
                  throw new FileSystemError(
                    `Parent directory not found: ${dirPath}`,
                    "NOT_FOUND"
                  );
                }
                throw new FileSystemError(
                  `Failed to create directory ${component} in ${dirPath}: ${error}`,
                  "INVALID_OPERATION"
                );
              }
            }
            return;
          }

          // Non-recursive: parent must exist and target must not exist
          const parentPath = this.getDirname(dirPath);
          const dirName = this.getBasename(dirPath);

          // Step 1: Get parent directory handle
          let parentHandle: FileSystemDirectoryHandle;
          try {
            parentHandle = await this.traverseToDirectory(parentPath);
          } catch (error: unknown) {
            if (
              (error as Error)?.name === "NotFoundError" ||
              (error instanceof FileSystemError &&
                (error as FileSystemError).code === "NOT_FOUND")
            ) {
              throw new FileSystemError(
                `Parent directory not found: ${parentPath}`,
                "NOT_FOUND"
              );
            }
            throw error;
          }

          // Step 2: Check if directory exists
          let exists = false;
          try {
            await parentHandle.getDirectoryHandle(dirName, { create: false });
            exists = true;
          } catch {
            // Any error means directory doesn't exist, which is what we want
          }

          if (exists) {
            throw new FileSystemError(
              `Directory already exists: ${dirPath}`,
              "ALREADY_EXISTS"
            );
          }

          // Step 3: Create the directory
          try {
            await parentHandle.getDirectoryHandle(dirName, { create: true });
          } catch (error) {
            throw new FileSystemError(
              `Failed to create directory ${dirPath}: ${error}`,
              "INVALID_OPERATION"
            );
          }
        },

        readdir: async (dirPath: string) => {
          const dirHandle = await this.traverseToDirectory(dirPath);
          const entries = [];

          for await (const [name, handle] of dirHandle.entries()) {
            entries.push({
              name,
              isDirectory: () => handle.kind === "directory",
              isFile: () => handle.kind === "file"
            });
          }

          return entries;
        },

        stat: async (path: string) => {
          const { handle } = await this.traverseToHandle(path);

          if (handle.kind === "file") {
            const file = await (handle as FileSystemFileHandle).getFile();
            return {
              isDirectory: () => false,
              isFile: () => true,
              mtimeMs: file.lastModified,
              size: file.size
            };
          } else {
            return {
              isDirectory: () => true,
              isFile: () => false,
              mtimeMs: Date.now(), // Directories don't have modification time in browser API
              size: 0 // Directories don't have size in browser API
            };
          }
        },

        readFile: async (path: string) => {
          const { handle } = await this.traverseToHandle(path);

          if (handle.kind !== "file") {
            throw new FileSystemError(`Not a file: ${path}`, "INVALID_TYPE");
          }

          const file = await (handle as FileSystemFileHandle).getFile();
          return await file.text();
        },

        writeFile: async (path: string, data: string) => {
          const parentPath = this.getDirname(path);
          const fileName = this.getBasename(path);
          const parentHandle = await this.traverseToDirectory(parentPath);

          const fileHandle = await parentHandle.getFileHandle(fileName, {
            create: true
          });
          const writable = await fileHandle.createWritable();
          await writable.write(data);
          await writable.close();
        },

        rm: async (path: string, options = {}) => {
          const parentPath = this.getDirname(path);
          const itemName = this.getBasename(path);

          // Step 1: Get parent directory handle
          let parentHandle: FileSystemDirectoryHandle;
          try {
            parentHandle = await this.traverseToDirectory(parentPath);
          } catch (error) {
            if (
              (error as Error)?.name === "NotFoundError" ||
              (error instanceof FileSystemError &&
                (error as FileSystemError).code === "NOT_FOUND")
            ) {
              throw new FileSystemError(
                `Parent directory not found: ${parentPath}`,
                "NOT_FOUND"
              );
            }
            throw error;
          }

          // Step 2: Check if target exists and get its handle
          let targetHandle: FileSystemHandle;
          try {
            try {
              targetHandle = await parentHandle.getDirectoryHandle(itemName, {
                create: false
              });
            } catch {
              targetHandle = await parentHandle.getFileHandle(itemName, {
                create: false
              });
            }
          } catch (error) {
            if ((error as Error)?.name === "NotFoundError") {
              throw new FileSystemError(`Item not found: ${path}`, "NOT_FOUND");
            }
            throw new FileSystemError(
              `Failed to access item ${path}: ${error}`,
              "INVALID_OPERATION"
            );
          }

          // Step 3: If it's a directory and not recursive, check if it's empty
          if (targetHandle.kind === "directory" && !options.recursive) {
            const dirHandle = targetHandle as FileSystemDirectoryHandle;
            // eslint-disable-next-line
            for await (const [_] of dirHandle.entries()) {
              throw new FileSystemError(
                `Directory not empty: ${path}`,
                "INVALID_OPERATION"
              );
            }
          }

          // Step 4: Remove the item
          try {
            await parentHandle.removeEntry(itemName, {
              recursive: options?.recursive ?? false
            });
          } catch (error) {
            throw new FileSystemError(
              `Failed to remove item ${path}: ${error}`,
              "INVALID_OPERATION"
            );
          }
        },

        unlink: async (path: string) => {
          await this.options.fs.rm!(path);
        },

        access: async (path: string) => {
          await this.traverseToHandle(path);
        }
      }
    });

    this.rootHandle = options.rootHandle;
  }

  /**
   * Initialize the file system by verifying access to the root handle
   */
  override async initialize(): Promise<void> {
    // If already in error state, don't try to initialize
    if (this.getCurrentState() === "error") {
      throw new FileSystemError(
        "File system is in error state",
        "INVALID_OPERATION"
      );
    }

    // If already initialized, don't initialize again
    if (this.getCurrentState() === "ready") {
      return;
    }

    try {
      // Verify we can access the root handle by trying to list its contents
      const entries = this.rootHandle.entries();
      await entries[Symbol.asyncIterator]().next();

      // Call parent's initialize to properly set up the state
      await super.initialize();
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

  /**
   * Traverse the file system to find a directory handle at the given path
   */
  private async traverseToDirectory(
    path: string
  ): Promise<FileSystemDirectoryHandle> {
    const { handle } = await this.traverseToHandle(path);

    if (handle.kind !== "directory") {
      throw new FileSystemError(`Not a directory: ${path}`, "INVALID_TYPE");
    }

    return handle as FileSystemDirectoryHandle;
  }

  /**
   * Traverse the file system to find any handle at the given path
   */
  private async traverseToHandle(
    path: string
  ): Promise<{ handle: FileSystemHandle; name: string }> {
    const components = this.normalizePath(path).split("/").filter(Boolean);
    let currentHandle: FileSystemHandle = this.rootHandle;
    let currentPath = "";

    // Special case: root directory
    if (components.length === 0) {
      return { handle: currentHandle, name: "/" };
    }

    // Traverse the path components
    for (let i = 0; i < components.length - 1; i++) {
      const component = components[i];
      currentPath = `${currentPath}/${component}`;

      if (currentHandle.kind !== "directory") {
        throw new FileSystemError(
          `Cannot traverse through file: ${currentPath}`,
          "INVALID_TYPE"
        );
      }

      try {
        currentHandle = await (
          currentHandle as FileSystemDirectoryHandle
        ).getDirectoryHandle(component!);
      } catch {
        throw new FileSystemError(
          `Directory not found: ${currentPath}`,
          "NOT_FOUND"
        );
      }
    }

    // Handle the last component - could be file or directory
    const lastComponent = components[components.length - 1];
    if (currentHandle.kind !== "directory") {
      throw new FileSystemError(
        `Cannot access items in a file: ${currentPath}`,
        "INVALID_TYPE"
      );
    }

    try {
      // Try as file first
      try {
        currentHandle = await (
          currentHandle as FileSystemDirectoryHandle
        ).getFileHandle(lastComponent!);
      } catch {
        // If not a file, try as directory
        currentHandle = await (
          currentHandle as FileSystemDirectoryHandle
        ).getDirectoryHandle(lastComponent!);
      }
      return { handle: currentHandle, name: lastComponent! };
    } catch {
      throw new FileSystemError(`Item not found: ${path}`, "NOT_FOUND");
    }
  }

  override normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  }

  override getDirname(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === -1 ? "/" : normalized.slice(0, lastSlash) || "/";
  }

  override getBasename(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  }
}
