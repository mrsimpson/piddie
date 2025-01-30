import FS from "@isomorphic-git/lightning-fs";
import { FsPromisesAdapter, MinimalFsPromises } from "./FsPromisesAdapter";
import type {
  MKDirOptions,
  WriteFileOptions
} from "@isomorphic-git/lightning-fs";
import type {
  FileSystem,
  FileSystemState,
  FileSystemStateType,
  LockMode
} from "@piddie/shared-types";
import { FileSystemError, VALID_FILE_SYSTEM_STATE_TRANSITIONS } from "@piddie/shared-types";

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

/**
 * Browser implementation of the FileSystem interface using LightningFS.
 * This implementation uses LightningFS for browser-based file system operations.
 */
export class BrowserFileSystem extends FsPromisesAdapter implements FileSystem {
  protected override currentState: FileSystemStateType = "uninitialized";
  protected override lockState: FileSystemState["lockState"] = { isLocked: false };
  protected override pendingOperations = 0;
  protected declare lastOperation?: FileSystemState["lastOperation"];

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
      mkdir: (path: string, options?: { recursive?: boolean }) =>
        fs.promises.mkdir(path, { mode: 0o777, ...options } as MKDirOptions),
      stat: fs.promises.stat,
      readFile: (path: string) =>
        fs.promises.readFile(path, { encoding: "utf8" }) as Promise<string>,
      writeFile: (path: string, data: string) =>
        fs.promises.writeFile(path, data, {
          mode: 0o666,
          encoding: "utf8"
        } as WriteFileOptions),
      unlink: fs.promises.unlink,
      readdir: async (path: string) => {
        const entries = await fs.promises.readdir(path);
        const results = await Promise.all(
          entries.map(async (name) => {
            const stats = await fs.promises.stat(`${path}/${name}`);
            return {
              name,
              isDirectory: () => stats.isDirectory(),
              isFile: () => stats.isFile()
            };
          })
        );
        return results;
      },
      rm: async (path: string, options?: { recursive?: boolean }) => {
        const stats = await fs.promises.stat(path);
        if (stats.isDirectory()) {
          if (options?.recursive) {
            const entries = await fs.promises.readdir(path);
            await Promise.all(
              entries.map((entry) => {
                const fullPath = `${path}/${entry}`;
                return stats.isDirectory()
                  ? fsWrapper.rm!(fullPath, options)
                  : fs.promises.unlink(fullPath);
              })
            );
          }
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
  }

  override validateStateTransition(from: FileSystemStateType, to: FileSystemStateType, via: string): boolean {
    // If we're already in error state, only allow transitions from error to ready via initialize
    if (from === "error") {
      return to === "ready" && via === "initialize";
    }
    return VALID_FILE_SYSTEM_STATE_TRANSITIONS.some(
      t => t.from === from && t.to === to && t.via === via
    );
  }

  override getCurrentState(): FileSystemStateType {
    return this.currentState;
  }

  override transitionTo(newState: FileSystemStateType, via: string): void {
    // If we're already in error state, don't try to transition again unless it's to ready via initialize
    if (this.currentState === "error" && !(newState === "ready" && via === "initialize")) {
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

  override getState(): FileSystemState {
    return {
      lockState: this.lockState,
      pendingOperations: this.pendingOperations,
      lastOperation: this.lastOperation,
      currentState: this.currentState
    };
  }

  override async initialize(): Promise<void> {
    // If already in error state, don't try to initialize
    if (this.currentState === "error") {
      throw new FileSystemError("File system is in error state", "INVALID_OPERATION");
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
          await this.options.fs.mkdir(this.options.rootDir, { recursive: true });
        } catch (mkdirError) {
          // If mkdir fails with EEXIST, that's fine - the directory exists
          if (mkdirError instanceof Error && !mkdirError.message.includes('EEXIST')) {
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

  override async lock(timeoutMs: number, reason: string, mode: LockMode = "external"): Promise<void> {
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

  override async forceUnlock(): Promise<void> {
    if (!this.lockState.isLocked) {
      return;
    }

    this.transitionTo("ready", "unlock");
    this.lockState = { isLocked: false };
  }

  protected async handleOperation<T>(
    operation: () => Promise<T>,
    type: string,
    path: string
  ): Promise<T> {
    if (this.lockState.isLocked && this.lockState.lockMode === "external") {
      throw new FileSystemError("File system is locked", "LOCKED");
    }

    this.pendingOperations++;
    this.lastOperation = {
      type,
      path,
      timestamp: Date.now()
    };

    try {
      return await operation();
    } catch (error) {
      this.transitionTo("error", "error");
      throw error;
    } finally {
      this.pendingOperations--;
    }
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
