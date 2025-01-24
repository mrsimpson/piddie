import { FileSystem, FileSystemItem, FileSystemState, FileSystemError } from "@piddie/shared-types";
import path from "path";

/**
 * Minimum required subset of fs.promises API that we need
 */
export interface MinimalFsPromises {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void | string | undefined>;
    readdir(path: string, options: { withFileTypes: true }): Promise<{ name: string; isDirectory(): boolean; isFile(): boolean; }[]>;
    stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; mtimeMs: number; size: number; }>;
    readFile(path: string, encoding: string): Promise<string>;
    writeFile(path: string, data: string, encoding: string): Promise<void>;
    rm?(path: string, options?: { recursive?: boolean }): Promise<void>;
    unlink(path: string): Promise<void>;
    access?(path: string): Promise<void>;
}

/**
 * Configuration options for the FsPromisesAdapter
 */
export interface FsPromisesAdapterOptions {
    /**
     * The root directory for all operations
     */
    rootDir: string;
    /**
     * The fs.promises-like implementation to use
     */
    fs: MinimalFsPromises;
}

/**
 * Internal state management for the file system
 */
interface InternalState {
    lockState: {
        isLocked: boolean;
        lockedSince?: number;
        lockTimeout?: number;
        lockReason?: string;
    };
    timeoutId: NodeJS.Timeout | null;
    pendingOperations: number;
}

/**
 * Adapts any fs.promises-like implementation to our FileSystem interface.
 * This serves as the base for both node's fs.promises and browser-based implementations like LightningFS.
 */
export class FsPromisesAdapter implements FileSystem {
    private state: InternalState = {
        lockState: { isLocked: false },
        timeoutId: null,
        pendingOperations: 0
    };
    private initialized = false;

    constructor(private options: FsPromisesAdapterOptions) { }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Ensure root directory exists
            await this.options.fs.mkdir(this.options.rootDir, { recursive: true });
            this.initialized = true;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(
                `Failed to initialize file system: ${message}`,
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

    async readFile(filePath: string): Promise<string> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(filePath);

        try {
            const content = await this.options.fs.readFile(absolutePath, "utf-8");
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
            await this.options.fs.mkdir(parentDir, { recursive: true });

            await this.options.fs.writeFile(absolutePath, content, "utf-8");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(message, "PERMISSION_DENIED");
        }
    }

    async exists(itemPath: string): Promise<boolean> {
        this.ensureInitialized();
        this.checkLock();

        try {
            if (this.options.fs.access) {
                await this.options.fs.access(this.getAbsolutePath(itemPath));
            } else {
                await this.options.fs.stat(this.getAbsolutePath(itemPath));
            }
            return true;
        } catch {
            return false;
        }
    }

    async deleteItem(itemPath: string): Promise<void> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(itemPath);

        try {
            const stats = await this.options.fs.stat(absolutePath);
            if (stats.isDirectory()) {
                if (this.options.fs.rm) {
                    await this.options.fs.rm(absolutePath, { recursive: true });
                } else {
                    // Fallback implementation if rm is not available
                    const entries = await this.options.fs.readdir(absolutePath, { withFileTypes: true });
                    await Promise.all(entries.map(entry => {
                        const fullPath = path.join(absolutePath, entry.name);
                        return entry.isDirectory()
                            ? this.deleteItem(fullPath)
                            : this.options.fs.unlink(fullPath);
                    }));
                }
            } else {
                await this.options.fs.unlink(absolutePath);
            }
        } catch (error: unknown) {
            if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
                throw new FileSystemError(`Path not found: ${itemPath}`, "NOT_FOUND");
            }
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(message, "PERMISSION_DENIED");
        }
    }

    async createDirectory(dirPath: string): Promise<void> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(dirPath);

        try {
            await this.options.fs.mkdir(absolutePath, { recursive: true });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new FileSystemError(message, "PERMISSION_DENIED");
        }
    }

    async listDirectory(dirPath: string): Promise<FileSystemItem[]> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(dirPath);

        try {
            const entries = await this.options.fs.readdir(absolutePath, { withFileTypes: true });
            const items = await Promise.all(
                entries.map(async (entry) => {
                    const itemPath = path.join(dirPath, entry.name);
                    const stats = await this.options.fs.stat(this.getAbsolutePath(itemPath));

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

    async getMetadata(itemPath: string): Promise<FileSystemItem> {
        this.ensureInitialized();
        this.checkLock();

        const absolutePath = this.getAbsolutePath(itemPath);

        try {
            const stats = await this.options.fs.stat(absolutePath);
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
            lockReason: reason
        };

        this.state.timeoutId = setTimeout(() => {
            this.forceUnlock();
        }, timeoutMs);
    }

    async forceUnlock(): Promise<void> {
        this.ensureInitialized();

        if (this.state.timeoutId) {
            clearTimeout(this.state.timeoutId);
            this.state.timeoutId = null;
        }

        this.state.lockState = {
            isLocked: false
        };
    }

    getState(): FileSystemState {
        return {
            lockState: {
                isLocked: this.state.lockState.isLocked,
                ...(this.state.lockState.lockedSince && { lockedSince: this.state.lockState.lockedSince }),
                ...(this.state.lockState.lockTimeout && { lockTimeout: this.state.lockState.lockTimeout }),
                ...(this.state.lockState.lockReason && { lockReason: this.state.lockState.lockReason })
            },
            pendingOperations: this.state.pendingOperations
        };
    }
} 