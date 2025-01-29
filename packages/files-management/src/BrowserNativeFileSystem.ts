import { FsPromisesAdapter, MinimalFsPromises } from "./FsPromisesAdapter";
import { FileSystemError } from "@piddie/shared-types";

/**
 * Browser-compatible path utilities
 */
const browserPath = {
  normalize(path: string): string {
    // Remove leading and trailing slashes, collapse multiple slashes
    return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  },

  dirname(path: string): string {
    const normalized = browserPath.normalize(path);
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return '/';
    return normalized.slice(0, lastSlash) || '/';
  },

  basename(path: string): string {
    const normalized = browserPath.normalize(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  },

  join(...parts: string[]): string {
    return '/' + parts
      .map(part => browserPath.normalize(part))
      .filter(Boolean)
      .join('/');
  }
};

// File System Access API types
type PermissionState = "granted" | "denied" | "prompt";

// BufferSource is a union of ArrayBuffer and ArrayBufferView
type BufferSource = ArrayBuffer | ArrayBufferView;

interface FileSystemHandle {
  kind: "file" | "directory";
  name: string;
  queryPermission(desc: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission(desc: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
}

interface FileSystemFileHandle extends FileSystemHandle {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  kind: "directory";
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
}

/**
 * Browser implementation of the FileSystem interface using the File System Access API.
 * This implementation provides direct access to the native file system through browser APIs.
 */
export class BrowserNativeFileSystem extends FsPromisesAdapter {
  private rootHandle: FileSystemDirectoryHandle;
  private handleCache = new Map<string, FileSystemHandle>();

  constructor(options: { rootHandle: FileSystemDirectoryHandle }) {
    // Create a wrapper that implements MinimalFsPromises using File System Access API
    const fsWrapper: MinimalFsPromises = {
      mkdir: async (dirPath: string) => {
        const parentPath = this.getDirname(dirPath);
        const dirName = this.getBasename(dirPath);
        const parentHandle = await this.getDirectoryHandle(parentPath);
        await parentHandle.getDirectoryHandle(dirName, { create: true });
      },
      readdir: async (dirPath: string) => {
        const dirHandle = await this.getDirectoryHandle(dirPath);
        const entries: {
          name: string;
          isDirectory(): boolean;
          isFile(): boolean;
        }[] = [];

        for await (const [name, handle] of dirHandle.entries()) {
          // Skip the root directory itself
          if (dirPath === "/" && name === "") continue;

          entries.push({
            name,
            isDirectory: () => handle.kind === "directory",
            isFile: () => handle.kind === "file"
          });
        }

        return entries;
      },
      stat: async (filePath: string) => {
        const handle = await this.getHandle(filePath);
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
            mtimeMs: Date.now(), // Directories don't have lastModified in File System Access API
            size: 0
          };
        }
      },
      readFile: async (filePath: string) => {
        const handle = await this.getHandle(filePath);
        if (handle.kind !== "file") {
          throw new FileSystemError(
            `Not a file: ${filePath}`,
            "INVALID_OPERATION"
          );
        }
        const file = await (handle as FileSystemFileHandle).getFile();
        return await file.text();
      },
      writeFile: async (filePath: string, content: string) => {
        const parentPath = this.getDirname(filePath);
        const fileName = this.getBasename(filePath);
        const parentHandle = await this.getDirectoryHandle(parentPath);
        const fileHandle = await parentHandle.getFileHandle(fileName, {
          create: true
        });

        let writable: FileSystemWritableFileStream | null = null;
        try {
          writable = await fileHandle.createWritable();
          // Truncate the file first to ensure we start fresh
          await writable.truncate(0);
          // Write the content
          await writable.write(content);
        } finally {
          // Ensure we always close the stream
          if (writable) {
            await writable.close();
          }
        }
      },
      rm: async (itemPath: string, options?: { recursive?: boolean }) => {
        const parentPath = this.getDirname(itemPath);
        const itemName = this.getBasename(itemPath);
        const parentHandle = await this.getDirectoryHandle(parentPath);
        await parentHandle.removeEntry(itemName, options);
        this.handleCache.delete(itemPath);
      },
      unlink: async (filePath: string) => {
        await fsWrapper.rm!(filePath);
      },
      access: async (itemPath: string) => {
        await this.getHandle(itemPath);
      }
    };

    super({
      rootDir: "/",
      fs: fsWrapper
    });

    this.rootHandle = options.rootHandle;
  }

  /**
   * Initialize the file system and verify permissions
   */
  override async initialize(): Promise<void> {
    if (this.initialized) return;

    // First verify we have the necessary permissions
    const permissionState = await this.rootHandle.queryPermission({
      mode: "readwrite"
    });

    if (permissionState === "prompt") {
      // Request permission from user
      const newState = await this.rootHandle.requestPermission({
        mode: "readwrite"
      });

      if (newState !== "granted") {
        throw new FileSystemError(
          "Permission denied for readwrite access to directory",
          "PERMISSION_DENIED"
        );
      }
    } else if (permissionState === "denied") {
      throw new FileSystemError(
        "Permission denied for readwrite access to directory",
        "PERMISSION_DENIED"
      );
    }

    // Initialize parent class
    await super.initialize();
  }

  /**
   * Get a handle for a path, optionally creating parent directories
   */
  private async getHandle(itemPath: string): Promise<FileSystemHandle> {
    // Normalize path
    const normalizedPath = this.normalizePath(itemPath);
    if (!normalizedPath) return this.rootHandle;

    // Check cache first
    if (this.handleCache.has(normalizedPath)) {
      return this.handleCache.get(normalizedPath)!;
    }

    // Split path into components and filter out empty segments
    const components = normalizedPath.split('/').filter(Boolean);
    let currentHandle: FileSystemDirectoryHandle = this.rootHandle;

    // Traverse path
    for (let i = 0; i < components.length; i++) {
      const component = components[i];
      if (!component) continue; // Skip empty components

      const isLast = i === components.length - 1;
      const fullPath = this.joinPaths(...components.slice(0, i + 1));

      try {
        if (isLast) {
          // Try file first, then directory
          try {
            const fileHandle = await currentHandle.getFileHandle(component);
            this.handleCache.set(fullPath, fileHandle);
            return fileHandle;
          } catch {
            const dirHandle = await currentHandle.getDirectoryHandle(component);
            this.handleCache.set(fullPath, dirHandle);
            return dirHandle;
          }
        } else {
          currentHandle = await currentHandle.getDirectoryHandle(component);
          this.handleCache.set(fullPath, currentHandle);
        }
      } catch {
        throw new FileSystemError(`Path not found: ${itemPath}`, "NOT_FOUND");
      }
    }

    throw new FileSystemError(`Invalid path: ${itemPath}`, "NOT_FOUND");
  }

  /**
   * Get a directory handle for a path, optionally creating it
   */
  private async getDirectoryHandle(
    dirPath: string
  ): Promise<FileSystemDirectoryHandle> {
    const handle = await this.getHandle(dirPath);
    if (handle.kind !== "directory") {
      throw new FileSystemError(
        `Not a directory: ${dirPath}`,
        "INVALID_OPERATION"
      );
    }
    return handle as FileSystemDirectoryHandle;
  }

  protected override async calculateHash(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Normalize a path according to the browser file system rules
   */
  protected override normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  }

  /**
   * Get the directory name from a path
   */
  protected override getDirname(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return '/';
    return normalized.slice(0, lastSlash) || '/';
  }

  /**
   * Get the base name from a path
   */
  protected override getBasename(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  }

  /**
   * Join path segments according to browser file system rules
   */
  protected override joinPaths(...paths: string[]): string {
    return '/' + paths
      .map(part => this.normalizePath(part))
      .filter(Boolean)
      .join('/');
  }
}
