import { FileSystem, FileSystemItem, FileSystemState, FileSystemError } from "@piddie/shared-types";
import type { promises as fsPromises } from 'fs';
import path from "path";

interface LocalFileSystemOptions {
    rootDir: string;  // The root directory for all operations
    fs: typeof fsPromises;  // Add fs as required option
}

/**
 * Internal state management for the local file system
 */
interface InternalState {
    lockState: {
        isLocked: boolean;
        lockedSince?: number;
        lockTimeout?: number;
        lockReason?: string;
        timeoutId?: NodeJS.Timeout;
    };
    pendingOperations: number;
    lastOperation?: {
        type: string;
        path: string;
        timestamp: number;
    };
}

interface FileOperation {
    type: string;
    path: string;
    execute: () => Promise<void>;
}

export class LocalFileSystem implements FileSystem {
    private state: InternalState = {
        lockState: { isLocked: false },
        pendingOperations: 0
    };
    private initialized = false;
    private fs: typeof fsPromises;

    constructor(private options: LocalFileSystemOptions) {
        this.fs = options.fs;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Ensure root directory exists
            await this.fs.mkdir(this.options.rootDir, { recursive: true });
            this.initialized = true;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(
                `Failed to initialize local file system: ${message}`,
                "PERMISSION_DENIED"
            );
        }
    }

    private ensureInitialized() {
        if (!this.initialized) {
            throw new FileSystemError(
                "File system not initialized",
                "INVALID_OPERATION"
            );
        }
    }

    private checkLock() {
        if (this.state.lockState.isLocked) {
            throw new FileSystemError(
                `File system is locked: ${this.state.lockState.lockReason}`,
                "LOCKED"
            );
        }
    }

    private getAbsolutePath(relativePath: string): string {
        // Normalize and resolve the path relative to root
        const normalizedPath = path.normalize(relativePath).replace(/^\//, "");
        return path.join(this.options.rootDir, normalizedPath);
    }

    private async updateState(operation: FileOperation): Promise<void> {
        this.state.lastOperation = {
            type: operation.type,
            path: operation.path,
            timestamp: Date.now()
        };
        this.state.pendingOperations++;
        try {
            await operation.execute();
        } finally {
            this.state.pendingOperations--;
        }
    }

    async listDirectory(dirPath: string): Promise<FileSystemItem[]> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(dirPath);

        try {
            const entries = await this.fs.readdir(absolutePath, { withFileTypes: true });
            const items = await Promise.all(
                entries.map(async (entry) => {
                    const itemPath = path.join(dirPath, entry.name);
                    const stats = await this.fs.stat(this.getAbsolutePath(itemPath));

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
            if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
                throw new FileSystemError(`Directory not found: ${dirPath}`, "NOT_FOUND");
            }
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(message, "PERMISSION_DENIED");
        }
    }

    async readFile(filePath: string): Promise<string> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(filePath);

        try {
            const content = await this.fs.readFile(absolutePath, "utf-8");
            return content;
        } catch (error: unknown) {
            if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
                throw new FileSystemError(`File not found: ${filePath}`, "NOT_FOUND");
            }
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(message, "PERMISSION_DENIED");
        }
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(filePath);

        try {
            // Ensure parent directory exists
            const parentDir = path.dirname(absolutePath);
            await this.fs.mkdir(parentDir, { recursive: true });

            await this.updateState({
                type: "write",
                path: filePath,
                execute: async () => {
                    await this.fs.writeFile(absolutePath, content, "utf-8");
                }
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(message, "PERMISSION_DENIED");
        }
    }

    async createDirectory(dirPath: string): Promise<void> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(dirPath);

        try {
            await this.updateState({
                type: "create_directory",
                path: dirPath,
                execute: async () => {
                    await this.fs.mkdir(absolutePath, { recursive: true });
                }
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(message, "PERMISSION_DENIED");
        }
    }

    async deleteItem(itemPath: string): Promise<void> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(itemPath);

        try {
            await this.updateState({
                type: "delete",
                path: itemPath,
                execute: async () => {
                    const stats = await this.fs.stat(absolutePath);
                    if (stats.isDirectory()) {
                        await this.fs.rm(absolutePath, { recursive: true });
                    } else {
                        await this.fs.unlink(absolutePath);
                    }
                }
            });
        } catch (error: unknown) {
            if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
                throw new FileSystemError(`Path not found: ${itemPath}`, "NOT_FOUND");
            }
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(message, "PERMISSION_DENIED");
        }
    }

    async exists(itemPath: string): Promise<boolean> {
        this.ensureInitialized();
        this.checkLock();

        try {
            await this.fs.access(this.getAbsolutePath(itemPath));
            return true;
        } catch {
            return false;
        }
    }

    async getMetadata(itemPath: string): Promise<FileSystemItem> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(itemPath);

        try {
            const stats = await this.fs.stat(absolutePath);
            const item: FileSystemItem = {
                path: itemPath,
                type: stats.isDirectory() ? "directory" : "file",
                lastModified: stats.mtimeMs,
                ...(stats.isFile() && { size: stats.size })
            };
            return item;
        } catch (error: unknown) {
            if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
                throw new FileSystemError(`Path not found: ${itemPath}`, "NOT_FOUND");
            }
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(message, "PERMISSION_DENIED");
        }
    }

    async lock(timeoutMs: number, reason: string): Promise<void> {
        this.ensureInitialized();

        if (this.state.lockState.isLocked) {
            throw new FileSystemError("File system is already locked", "LOCKED");
        }

        this.state.lockState = {
            isLocked: true,
            lockedSince: Date.now(),
            lockTimeout: timeoutMs,
            lockReason: reason,
            timeoutId: setTimeout(() => {
                this.forceUnlock();
            }, timeoutMs)
        };
    }

    async forceUnlock(): Promise<void> {
        this.ensureInitialized();

        if (this.state.lockState.timeoutId) {
            clearTimeout(this.state.lockState.timeoutId);
        }

        this.state.lockState = {
            isLocked: false
        };
    }

    getState(): FileSystemState {
        const { lockState, pendingOperations, lastOperation } = this.state;
        return {
            lockState: {
                isLocked: lockState.isLocked,
                ...(lockState.lockedSince && { lockedSince: lockState.lockedSince }),
                ...(lockState.lockTimeout && { lockTimeout: lockState.lockTimeout }),
                ...(lockState.lockReason && { lockReason: lockState.lockReason })
            },
            pendingOperations,
            ...(lastOperation && { lastOperation })
        };
    }
}