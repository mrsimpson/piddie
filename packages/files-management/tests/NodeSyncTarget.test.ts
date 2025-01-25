// Mock fs.promises.watch
vi.mock("fs/promises", () => ({
    watch: vi.fn()
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockInstance } from "vitest";
import { NodeSyncTarget } from "../src/NodeSyncTarget";
import { NodeFileSystem } from "../src/NodeFileSystem";
import type { FileChange, FileChangeInfo, FileSystem, FileSystemItem } from "@piddie/shared-types";
import { watch } from "fs/promises";
import type { FSWatcher } from "fs";

// Helper to create a mock watcher that emits specified events
class MockFsWatcher implements AsyncIterable<{ eventType: 'rename' | 'change', filename: string | null }> {
    private events: Array<{ eventType: 'rename' | 'change', filename: string | null }>;

    constructor(events: Array<{ eventType: 'rename' | 'change', filename: string | null }> = []) {
        this.events = events;
    }

    async *[Symbol.asyncIterator]() {
        for (const event of this.events) {
            yield event;
        }
    }

    close() {
        // Method required by FSWatcher interface
    }
}

describe("NodeSyncTarget", () => {
    const TEST_ROOT = "/test/root";
    let target: NodeSyncTarget;
    let fileSystem: NodeFileSystem;
    let mockWatcher: MockFsWatcher;

    // Spy on FileSystem methods
    let spies: {
        initialize: MockInstance;
        readFile: MockInstance;
        writeFile: MockInstance;
        deleteItem: MockInstance;
        exists: MockInstance;
        lock: MockInstance;
        forceUnlock: MockInstance;
    };

    beforeEach(() => {
        vi.resetAllMocks();

        // Setup mock watcher with no events by default
        mockWatcher = new MockFsWatcher();
        (watch as unknown as MockInstance).mockImplementation(() => Promise.resolve(mockWatcher));

        fileSystem = new NodeFileSystem(TEST_ROOT);
        target = new NodeSyncTarget("test-target", TEST_ROOT);

        // Setup spies on FileSystem methods
        spies = {
            initialize: vi.spyOn(fileSystem, "initialize"),
            readFile: vi.spyOn(fileSystem, "readFile"),
            writeFile: vi.spyOn(fileSystem, "writeFile"),
            deleteItem: vi.spyOn(fileSystem, "deleteItem"),
            exists: vi.spyOn(fileSystem, "exists"),
            lock: vi.spyOn(fileSystem, "lock"),
            forceUnlock: vi.spyOn(fileSystem, "forceUnlock")
        };

        // Setup default mock implementations
        spies.initialize.mockResolvedValue(undefined);
        spies.readFile.mockResolvedValue("test content");
        spies.writeFile.mockResolvedValue(undefined);
        spies.deleteItem.mockResolvedValue(undefined);
        spies.exists.mockResolvedValue(false);
        spies.lock.mockResolvedValue(undefined);
        spies.forceUnlock.mockResolvedValue(undefined);
    });

    describe("temp", () => {
        it("should iterate", async () => {
            mockWatcher = new MockFsWatcher([
                { eventType: "change", filename: "test1.txt" },
                { eventType: "change", filename: "test2.txt" }
            ]);

            const events: Array<{ eventType: 'rename' | 'change', filename: string | null }> = [];
            for await (const event of mockWatcher) {
                events.push(event);
            }

            expect(events).toEqual([
                { eventType: "change", filename: "test1.txt" },
                { eventType: "change", filename: "test2.txt" }
            ]);
        });

        it("should verify mock watcher is used in watch()", async () => {
            const callback = vi.fn();
            const testEvents = [
                { eventType: "change" as const, filename: "test1.txt" },
                { eventType: "change" as const, filename: "test2.txt" }
            ];

            mockWatcher = new MockFsWatcher(testEvents);
            (watch as unknown as MockInstance).mockImplementation(() => Promise.resolve(mockWatcher));

            await target.initialize(fileSystem);
            await target.watch(callback);

            // Wait for events to be processed
            await new Promise(resolve => setTimeout(resolve, 0));

            // Verify watch was called with correct params
            expect(watch).toHaveBeenCalledWith(TEST_ROOT, {
                recursive: true,
                signal: expect.any(AbortSignal)
            });

            // Verify callback was called for each event
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith([
                expect.objectContaining({
                    path: "test1.txt",
                    type: "create",
                    sourceTarget: "test-target"
                }),
                expect.objectContaining({
                    path: "test2.txt",
                    type: "create",
                    sourceTarget: "test-target"
                })
            ]);
        });
    });

    describe("Initialization", () => {
        it("should initialize with NodeFileSystem", async () => {
            await target.initialize(fileSystem);
            expect(spies.initialize).toHaveBeenCalled();
        });

        it("should reject non-NodeFileSystem instances", async () => {
            const invalidFs = {} as any;
            await expect(target.initialize(invalidFs)).rejects.toThrow("NodeSyncTarget requires NodeFileSystem");
        });
    });

    describe("File System Operations", () => {
        beforeEach(async () => {
            await target.initialize(fileSystem);
        });

        it("should lock filesystem during sync", async () => {
            await target.notifyIncomingChanges(["test.txt"]);
            expect(spies.lock).toHaveBeenCalledWith(30000, "Sync in progress");
        });

        it("should unlock filesystem after sync completion", async () => {
            await target.notifyIncomingChanges(["test.txt"]);
            await target.syncComplete();
            expect(spies.forceUnlock).toHaveBeenCalled();
        });

        it("should read file contents", async () => {
            const paths = ["test1.txt", "test2.txt"];
            await target.getContents(paths);

            paths.forEach(path => {
                expect(spies.readFile).toHaveBeenCalledWith(path);
            });
        });

        it("should write file contents", async () => {
            const changes: FileChange[] = [
                {
                    path: "test.txt",
                    type: "create",
                    content: "new content",
                    sourceTarget: "source",
                    timestamp: Date.now()
                }
            ];

            await target.applyChanges(changes);
            expect(spies.writeFile).toHaveBeenCalledWith("test.txt", "new content");
        });

        it("should delete files", async () => {
            const changes: FileChange[] = [
                {
                    path: "test.txt",
                    type: "delete",
                    content: "",
                    sourceTarget: "source",
                    timestamp: Date.now()
                }
            ];

            await target.applyChanges(changes);
            expect(spies.deleteItem).toHaveBeenCalledWith("test.txt");
        });

        it("should check file existence for conflicts", async () => {
            spies.exists.mockResolvedValue(true);
            spies.readFile.mockResolvedValue("existing content");

            const changes: FileChange[] = [
                {
                    path: "test.txt",
                    type: "create",
                    content: "new content",
                    sourceTarget: "source",
                    timestamp: Date.now()
                }
            ];

            await target.applyChanges(changes);
            expect(spies.exists).toHaveBeenCalledWith("test.txt");
            expect(spies.readFile).toHaveBeenCalledWith("test.txt");
        });
    });

    describe("File Watching", () => {
        beforeEach(async () => {
            await target.initialize(fileSystem);
        });

        it("should setup file watching", async () => {
            const callback = vi.fn();
            await target.watch(callback);

            expect(watch).toHaveBeenCalledWith(TEST_ROOT, {
                recursive: true,
                signal: expect.any(AbortSignal)
            });
        });

        it("should handle file creation events", async () => {
            const callback = vi.fn();
            const testFile = "test.txt";

            // Setup watcher to emit a creation event
            mockWatcher = new MockFsWatcher([
                { eventType: "change", filename: testFile }
            ]);
            (watch as unknown as MockInstance).mockImplementation(() => Promise.resolve(mockWatcher));

            await target.watch(callback);

            // Wait for the async iteration to complete
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(spies.exists).toHaveBeenCalledWith(testFile);
            expect(callback).toHaveBeenCalledWith([
                expect.objectContaining({
                    path: testFile,
                    type: "create",
                    sourceTarget: "test-target"
                })
            ]);
        });

        it("should handle file modification events", async () => {
            const callback = vi.fn();
            const testFile = "test.txt";

            spies.exists.mockResolvedValue(true);

            // Setup watcher to emit a modification event
            mockWatcher = new MockFsWatcher([
                { eventType: "change", filename: testFile }
            ]);
            (watch as unknown as MockInstance).mockImplementation(() => Promise.resolve(mockWatcher));

            await target.watch(callback);

            // Wait for the async iteration to complete
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(spies.exists).toHaveBeenCalledWith(testFile);
            expect(callback).toHaveBeenCalledWith([
                expect.objectContaining({
                    path: testFile,
                    type: "modify",
                    sourceTarget: "test-target"
                })
            ]);
        });

        it("should cleanup watchers on unwatch", async () => {
            const callback = vi.fn();
            await target.watch(callback);
            await target.unwatch();

            const state = target.getState();
            expect(state.pendingChanges).toBe(0);
        });
    });

    describe("State Management", () => {
        it("should report error state when not initialized", () => {
            const state = target.getState();
            expect(state).toEqual(
                expect.objectContaining({
                    status: "error",
                    error: "Not initialized"
                })
            );
        });

        it("should track pending changes", async () => {
            await target.initialize(fileSystem);

            const callback = vi.fn();

            // Setup watcher to emit a change event
            mockWatcher = new MockFsWatcher([
                { eventType: "change", filename: "test.txt" }
            ]);
            (watch as unknown as MockInstance).mockImplementation(() => Promise.resolve(mockWatcher));

            await target.watch(callback);

            // Wait for the async iteration to complete
            await new Promise(resolve => setTimeout(resolve, 0));

            const state = target.getState();
            expect(state.pendingChanges).toBeGreaterThan(0);
        });

        it("should update status during sync operations", async () => {
            await target.initialize(fileSystem);

            await target.notifyIncomingChanges(["test.txt"]);
            expect(target.getState().status).toBe("notifying");

            await target.applyChanges([{
                path: "test.txt",
                type: "create",
                content: "test",
                sourceTarget: "source",
                timestamp: Date.now()
            }]);
            expect(target.getState().status).toBe("syncing");

            await target.syncComplete();
            expect(target.getState().status).toBe("idle");
        });
    });
}); 