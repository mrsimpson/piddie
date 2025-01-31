import type { FileSystem, FileMetadata, FileContentStream, FileConflict, FileChangeInfo } from "@piddie/shared-types";
import { SyncOperationError } from "@piddie/shared-types";
import { ReadableStream } from "node:stream/web";
import { BaseSyncTarget } from "./BaseSyncTarget";
import { NodeFileSystem } from "./NodeFileSystem";
import { watch } from "node:fs/promises";

/**
 * Node.js implementation of the SyncTarget interface
 */
export class NodeSyncTarget extends BaseSyncTarget {
    override readonly type = "local";
    private changeBuffer: FileChangeInfo[] = [];
    private changeTimeout: ReturnType<typeof setTimeout> | null = null;
    private watchAbortController: AbortController | null = null;

    constructor(
        targetId: string,
        private readonly rootDir: string
    ) {
        super(targetId);
    }

    override async initialize(fileSystem: FileSystem, isPrimary: boolean): Promise<void> {
        if (!(fileSystem instanceof NodeFileSystem)) {
            this.transitionTo("error", "initialize");
            throw new SyncOperationError(
                "Invalid file system type",
                "INITIALIZATION_FAILED"
            );
        }

        this.fileSystem = fileSystem;
        this.isPrimaryTarget = isPrimary;
        this.transitionTo("idle", "initialize");

        // Start watching for changes if initialized successfully
        if (this.getCurrentState() === "idle") {
            await this.startWatching();
        }
    }

    private async startWatching(): Promise<void> {
        if (!this.fileSystem || !(this.fileSystem instanceof NodeFileSystem)) {
            throw new SyncOperationError(
                "FileSystem not initialized",
                "INITIALIZATION_FAILED"
            );
        }

        this.watchAbortController = new AbortController();

        try {
            const watcher = await watch(this.rootDir, {
                recursive: true,
                signal: this.watchAbortController.signal
            });

            for await (const event of watcher) {
                if (event.filename) {
                    // Ensure we have a valid filename
                    const filePath = event.filename; // Use the filename directly since it's already relative to the watched directory
                    const exists = await this.fileSystem.exists(filePath);

                    let change: FileChangeInfo;
                    if (exists) {
                        // Get metadata for the changed file
                        const metadata = await this.fileSystem.getMetadata(filePath);
                        change = {
                            path: filePath,
                            type: event.eventType === "rename" ? "delete" : "modify",
                            sourceTarget: this.id,
                            lastModified: metadata.lastModified,
                            hash: metadata.hash,
                            size: metadata.size
                        };
                    } else if (event.eventType === "rename") {
                        // File was deleted - use empty hash and size 0
                        change = {
                            path: filePath,
                            type: "delete",
                            sourceTarget: this.id,
                            lastModified: Date.now(),
                            hash: "",
                            size: 0
                        };
                    } else {
                        // New file created
                        const metadata = await this.fileSystem.getMetadata(filePath);
                        change = {
                            path: filePath,
                            type: "create",
                            sourceTarget: this.id,
                            lastModified: metadata.lastModified,
                            hash: metadata.hash,
                            size: metadata.size
                        };
                    }

                    await this.handleFileChange(change);
                }
            }
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                // Normal abort during unwatch, ignore
                return;
            }
            throw new SyncOperationError(
                `Failed to watch directory: ${error}`,
                "WATCH_FAILED"
            );
        }
    }

    protected async handleFileChange(change: FileChangeInfo): Promise<void> {
        this.changeBuffer.push(change);

        // Clear existing timeout if any
        if (this.changeTimeout !== null) {
            globalThis.clearTimeout(this.changeTimeout);
        }

        // Set new timeout to process changes
        this.changeTimeout = globalThis.setTimeout(async () => {
            const changes = [...this.changeBuffer];
            this.changeBuffer = [];
            this.changeTimeout = null;

            // Notify watchers of the changes
            await this.notifyWatchers(changes);
        }, 100); // 100ms debounce
    }

    override async unwatch(): Promise<void> {
        this.watchAbortController?.abort();
        this.watchAbortController = null;
        await super.unwatch();
    }
} 