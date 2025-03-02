import {
  FileSystem,
  FileSystemState,
  FileSystemStateType,
  FileMetadata,
  FileSystemItem,
  FileSystemError,
  VALID_FILE_SYSTEM_STATE_TRANSITIONS,
  LockState,
  LockMode
} from "@piddie/shared-types";
import type { WebContainer } from "@webcontainer/api";

/**
 * WebContainer implementation of the FileSystem interface.
 * This implementation uses WebContainer for file system operations.
 */
export class WebContainerFileSystem implements FileSystem {
  protected currentState: FileSystemStateType = "uninitialized";
  protected lockState: LockState = { isLocked: false };
  protected lastOperation?: FileSystemState["lastOperation"];
  protected pendingOperations = 0;
  protected lastModifiedMap = new Map<string, number>();

  constructor(private webcontainerInstance: WebContainer) {}

  validateStateTransition(
    from: FileSystemStateType,
    to: FileSystemStateType,
    via: string
  ): boolean {
    return VALID_FILE_SYSTEM_STATE_TRANSITIONS.some(
      (transition) =>
        transition.from === from &&
        transition.to === to &&
        transition.via === via
    );
  }

  getCurrentState(): FileSystemStateType {
    return this.currentState;
  }

  transitionTo(newState: FileSystemStateType, via: string): void {
    if (!this.validateStateTransition(this.currentState, newState, via)) {
      throw new FileSystemError(
        `Invalid state transition from ${this.currentState} to ${newState} via ${via}`,
        "INVALID_OPERATION"
      );
    }
    this.currentState = newState;
  }

  getLockState(): LockState {
    return this.lockState;
  }

  async initialize(): Promise<void> {
    this.transitionTo("ready", "initialize");
  }

  async readFile(path: string): Promise<string> {
    // Read operations should be allowed while locked
    try {
      const content = await this.webcontainerInstance.fs.readFile(
        path,
        "utf-8"
      );
      this.lastOperation = {
        type: "read",
        path,
        timestamp: Date.now()
      };
      return content.toString();
    } catch {
      throw new FileSystemError(`Failed to read file ${path}`, "NOT_FOUND");
    }
  }

  async writeFile(
    path: string,
    content: string,
    isSyncOperation?: boolean
  ): Promise<void> {
    this.validateNotLocked(isSyncOperation);
    try {
      // Ensure parent directory exists
      const parentPath = path.split("/").slice(0, -1).join("/") || "/";
      try {
        await this.webcontainerInstance.fs.readdir(parentPath);
      } catch {
        throw new FileSystemError(
          `Parent directory does not exist: ${parentPath}`,
          "NOT_FOUND"
        );
      }

      await this.webcontainerInstance.fs.writeFile(path, content);
      // Only update lastModified if it's not a sync operation
      if (!isSyncOperation) {
        this.lastModifiedMap.set(path, Date.now());
      }
      this.lastOperation = {
        type: "write",
        path,
        timestamp: Date.now()
      };
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new FileSystemError(
        `Failed to write file ${path}`,
        "PERMISSION_DENIED"
      );
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.webcontainerInstance.fs.readFile(path);
      return true;
    } catch {
      try {
        await this.webcontainerInstance.fs.readdir(path);
        return true;
      } catch {
        return false;
      }
    }
  }

  async createDirectory(
    path: string,
    options: { recursive?: boolean } = {},
    isSyncOperation?: boolean
  ): Promise<void> {
    this.validateNotLocked(isSyncOperation);

    // First check if directory exists
    try {
      await this.webcontainerInstance.fs.readdir(path);
      if (!options.recursive) {
        throw new FileSystemError(
          `Directory already exists: ${path}`,
          "ALREADY_EXISTS"
        );
      }
      return; // Directory exists and recursive is true
    } catch {
      // Directory doesn't exist, check parent
      const parentPath = path.split("/").slice(0, -1).join("/") || "/";
      if (parentPath !== "/") {
        try {
          await this.webcontainerInstance.fs.readdir(parentPath);
        } catch {
          if (!options.recursive) {
            throw new FileSystemError(
              `Parent directory does not exist: ${parentPath}`,
              "NOT_FOUND"
            );
          }
          // Create parent directory recursively
          await this.createDirectory(
            parentPath,
            { recursive: true },
            isSyncOperation
          );
        }
      }
    }

    try {
      await this.webcontainerInstance.fs.mkdir(path);
      this.lastOperation = {
        type: "mkdir",
        path,
        timestamp: Date.now()
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Directory already exists"
      ) {
        if (!options.recursive) {
          throw new FileSystemError(
            `Directory already exists: ${path}`,
            "ALREADY_EXISTS"
          );
        }
        return;
      }
      throw new FileSystemError(
        `Failed to create directory: ${path}`,
        "PERMISSION_DENIED"
      );
    }
  }

  async deleteItem(
    path: string,
    options: { recursive?: boolean } = {},
    isSyncOperation?: boolean
  ): Promise<void> {
    this.validateNotLocked(isSyncOperation);

    try {
      // First check if path exists and what type it is
      let isDirectory = false;
      try {
        await this.webcontainerInstance.fs.readdir(path);
        isDirectory = true;
      } catch {
        // Not a directory, check if it's a file
        try {
          await this.webcontainerInstance.fs.readFile(path);
        } catch {
          throw new FileSystemError(
            `Path does not exist: ${path}`,
            "NOT_FOUND"
          );
        }
      }

      if (isDirectory) {
        // Check if directory is empty
        const entries = await this.webcontainerInstance.fs.readdir(path);
        if (entries.length > 0) {
          if (!options.recursive) {
            throw new FileSystemError(
              `Directory not empty: ${path}`,
              "INVALID_OPERATION"
            );
          }
          // Recursively delete contents
          for (const entry of entries) {
            const entryPath = path === "/" ? `/${entry}` : `${path}/${entry}`;
            await this.deleteItem(
              entryPath,
              { recursive: true },
              isSyncOperation
            );
          }
        }
      }

      // Delete the item itself
      await this.webcontainerInstance.fs.rm(path);
      this.lastOperation = {
        type: "delete",
        path,
        timestamp: Date.now()
      };
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new FileSystemError(`Failed to delete item ${path}`, "NOT_FOUND");
    }
  }

  async listDirectory(path: string): Promise<FileSystemItem[]> {
    // Read operations should be allowed while locked
    try {
      // For root directory, ensure it exists by trying to create it (will fail if exists)
      if (path === "/") {
        try {
          await this.webcontainerInstance.fs.mkdir("/");
        } catch {
          // Directory already exists, which is fine
        }
      }

      const entries = await this.webcontainerInstance.fs.readdir(path);
      const items: FileSystemItem[] = [];

      for (const entry of entries) {
        const fullPath = path === "/" ? `/${entry}` : `${path}/${entry}`;
        try {
          // Try to read as file first
          let isFile = false;
          let content: string | Uint8Array | undefined;
          try {
            content = await this.webcontainerInstance.fs.readFile(fullPath);
            isFile = true;
          } catch {
            // Not a file
          }

          if (isFile && content !== undefined) {
            items.push({
              path: fullPath,
              type: "file",
              lastModified: Date.now(),
              size: content.length
            } as FileSystemItem & { size: number });
          } else {
            // Must be a directory
            await this.webcontainerInstance.fs.readdir(fullPath);
            items.push({
              path: fullPath,
              type: "directory",
              lastModified: Date.now()
            });
          }
        } catch {
          // Skip entries that can't be accessed
          console.warn(`Could not access ${fullPath}`);
        }
      }

      this.lastOperation = {
        type: "read",
        path,
        timestamp: Date.now()
      };

      return items;
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new FileSystemError(
        `Failed to list directory ${path}`,
        "NOT_FOUND"
      );
    }
  }

  async getMetadata(path: string): Promise<FileMetadata> {
    try {
      // Try to read as file first
      try {
        const content = await this.webcontainerInstance.fs.readFile(path);
        return {
          path,
          type: "file",
          size: content.length,
          hash: await this.calculateHash(content),
          lastModified: this.lastModifiedMap.get(path) ?? Date.now() // Use stored lastModified if available
        };
      } catch {
        // If not a file, try as directory
        await this.webcontainerInstance.fs.readdir(path);
        return {
          path,
          type: "directory",
          size: 0,
          hash: "",
          lastModified: this.lastModifiedMap.get(path) ?? Date.now()
        };
      }
    } catch {
      throw new FileSystemError(
        `Failed to get metadata for ${path}`,
        "NOT_FOUND"
      );
    }
  }

  async lock(
    timeout: number,
    reason: string,
    mode: LockMode,
    owner: string
  ): Promise<void> {
    if (this.lockState.isLocked) {
      throw new FileSystemError("File system is already locked", "LOCKED");
    }
    const acquiredAt = Date.now();
    this.lockState = {
      isLocked: true,
      lockInfo: {
        owner,
        reason,
        mode,
        timestamp: acquiredAt
      }
    };

    // Auto-unlock after timeout
    setTimeout(() => {
      if (
        this.lockState.isLocked &&
        this.lockState.lockInfo?.timestamp === acquiredAt
      ) {
        this.forceUnlock();
      }
    }, timeout);
  }

  async unlock(owner: string): Promise<void> {
    if (!this.lockState.isLocked || this.lockState.lockInfo?.owner !== owner) {
      throw new FileSystemError("Invalid unlock attempt", "INVALID_OPERATION");
    }
    this.lockState = { isLocked: false };
  }

  async forceUnlock(): Promise<void> {
    this.lockState = { isLocked: false };
  }

  getState(): FileSystemState {
    return {
      currentState: this.currentState,
      lockState: this.lockState,
      lastOperation: this.lastOperation,
      pendingOperations: this.pendingOperations
    };
  }

  private validateNotLocked(isSyncOperation?: boolean): void {
    if (this.lockState.isLocked) {
      // Allow sync operations if locked in sync mode
      if (isSyncOperation && this.lockState.lockInfo?.mode === "sync") {
        return;
      }
      throw new FileSystemError("File system is locked", "LOCKED");
    }
  }

  private async calculateHash(content: string | Uint8Array): Promise<string> {
    const textEncoder = new TextEncoder();
    const data =
      typeof content === "string" ? textEncoder.encode(content) : content;
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Disposes of the file system
   * For WebContainerFileSystem, this is a no-op as the WebContainer is managed externally
   */
  async dispose(): Promise<void> {
    // WebContainer is managed externally, so this is a no-op
    return Promise.resolve();
  }
}
