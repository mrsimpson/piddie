import type {
  FileSystem,
  FileSystemState,
  FileSystemStateType,
  LockMode
} from "@piddie/shared-types";
import { FileSystemError, VALID_FILE_SYSTEM_STATE_TRANSITIONS } from "@piddie/shared-types";
import { promises as fs } from "fs";
import { FsPromisesAdapter, MinimalFsPromises } from "./FsPromisesAdapter";

/**
 * Node.js implementation of the FileSystem interface using fs.promises
 */
export class NodeFileSystem extends FsPromisesAdapter implements FileSystem {
  protected override currentState: FileSystemStateType = "uninitialized";
  protected override lockState: FileSystemState["lockState"] = { isLocked: false };
  protected override pendingOperations = 0;
  declare protected lastOperation?: FileSystemState["lastOperation"];

  constructor(rootDir: string) {
    const fsWrapper: MinimalFsPromises = {
      mkdir: fs.mkdir,
      readdir: fs.readdir,
      stat: fs.stat,
      readFile: (path) => fs.readFile(path, "utf-8"),
      writeFile: (path, data) => fs.writeFile(path, data, "utf-8"),
      rm: fs.rm,
      unlink: fs.unlink,
      access: fs.access
    };

    super({ rootDir, fs: fsWrapper });
  }

  override validateStateTransition(from: FileSystemStateType, to: FileSystemStateType, via: string): boolean {
    return VALID_FILE_SYSTEM_STATE_TRANSITIONS.some(
      t => t.from === from && t.to === to && t.via === via
    );
  }

  override getCurrentState(): FileSystemStateType {
    return this.currentState;
  }

  override transitionTo(newState: FileSystemStateType, via: string): void {
    if (!this.validateStateTransition(this.currentState, newState, via)) {
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
    try {
      await super.initialize();
      this.transitionTo("ready", "initialize");
    } catch (error) {
      this.transitionTo("error", "error");
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
   * Get the size of a file in bytes
   */
  async getSize(path: string): Promise<number> {
    const stats = await this.options.fs.stat(this.getAbsolutePath(path));
    return stats.size;
  }
}
