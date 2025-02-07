import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import type {
  FileSystem,
  FileMetadata,
  FileContentStream,
  FileChunk,
  SyncTarget
} from "@piddie/shared-types";

export interface SyncTargetTestContext<T extends SyncTarget> {
  createTarget: () => T;
  createFileSystem: () => FileSystem;
  setupSpies: (fs: FileSystem) => {
    initialize: MockInstance;
    readFile: MockInstance;
    writeFile: MockInstance;
    deleteItem: MockInstance;
    exists: MockInstance;
    lock: MockInstance;
    unlock: MockInstance;
    forceUnlock: MockInstance;
    getMetadata: MockInstance;
    listDirectory: MockInstance;
  };
  setupFileWithMetadata: (
    spies: ReturnType<SyncTargetTestContext<T>["setupSpies"]>,
    path: string,
    metadata: FileMetadata | null,
    content?: string
  ) => Promise<{ metadata: FileMetadata }>;
  createMockStream: (
    metadata: FileMetadata,
    content?: string
  ) => FileContentStream;
  reset: () => void;
}

const DEFAULT_WATCH_OPTIONS = {
  priority: 100,
  metadata: { registeredBy: "test" }
};
export function createSyncTargetTests<T extends SyncTarget>(
  context: SyncTargetTestContext<T>
) {
  return describe("SyncTarget Interface", () => {
    let target: T;
    let fileSystem: FileSystem;
    let spies: ReturnType<typeof context.setupSpies>;

    beforeEach(() => {
      vi.useFakeTimers();
      fileSystem = context.createFileSystem();
      context.reset();
      target = context.createTarget();
      spies = context.setupSpies(fileSystem);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.resetAllMocks();
    });

    describe("Initialization", () => {
      it("should initialize in primary mode", async () => {
        await target.initialize(fileSystem, true);
        // Wait for first poll
        await vi.advanceTimersByTimeAsync(1000);
        expect(spies.listDirectory).toHaveBeenCalled();
        expect(target.getState().status).toBe("idle");
      });

      it("should initialize in secondary mode", async () => {
        await target.initialize(fileSystem, false);
        // Wait for first poll
        await vi.advanceTimersByTimeAsync(1000);
        expect(spies.listDirectory).toHaveBeenCalled();
        expect(target.getState().status).toBe("idle");
      });

      it("should report error state when not initialized", () => {
        const state = target.getState();
        expect(state).toEqual(
          expect.objectContaining({
            status: "uninitialized",
            error: undefined
          })
        );
      });
    });

    describe("File Operations", () => {
      beforeEach(async () => {
        await target.initialize(fileSystem, true);
      });

      it("should lock filesystem during sync", async () => {
        await target.notifyIncomingChanges(["test.txt"]);
        expect(spies.lock).toHaveBeenCalledWith(
          30000,
          "Sync in progress",
          "sync",
          target.id
        );
      });

      it("should unlock filesystem after sync completion", async () => {
        await target.notifyIncomingChanges(["test.txt"]);
        await target.applyFileChange(
          {
            sourceTarget: target.id,
            ...{
              path: "test.txt",
              type: "file",
              hash: "testhash",
              size: 100,
              lastModified: Date.now()
            },
            type: "modify"
          },
          context.createMockStream(
            {
              path: "test.txt",
              type: "file",
              hash: "testhash",
              size: 100,
              lastModified: Date.now()
            },
            "new content"
          )
        );
        await target.syncComplete();
        expect(spies.unlock).toHaveBeenCalledWith(target.id);
      });

      it("should get file metadata", async () => {
        const { metadata: expectedMetadata } =
          await context.setupFileWithMetadata(
            spies,
            "test.txt",
            {
              path: "test.txt",
              type: "file",
              hash: "testhash",
              size: 100,
              lastModified: Date.now()
            },
            "test content"
          );

        const metadata = await target.getMetadata([expectedMetadata.path]);
        expect(metadata).toHaveLength(1);
        expect(metadata[0]).toEqual(expectedMetadata);
      });

      it("should get file content stream", async () => {
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "testhash",
            size: 100,
            lastModified: Date.now()
          },
          "test content"
        );

        const stream = await target.getFileContent(metadata.path);
        expect(stream).toHaveProperty("metadata");
        expect(stream).toHaveProperty("getReader");
        expect(stream).toHaveProperty("close");

        const reader = stream.getReader();
        const chunks: FileChunk[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[0]).toHaveProperty("content");
        expect(chunks[0]).toHaveProperty("chunkIndex");
        expect(chunks[0]).toHaveProperty("totalChunks");
        expect(chunks[0]).toHaveProperty("chunkHash");
        expect(chunks.map((c) => c.content).join("")).toBe("test content");
      });

      it("should apply file changes", async () => {
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "testhash",
            size: 100,
            lastModified: Date.now()
          },
          "test content"
        );

        const stream = context.createMockStream(metadata);
        await target.notifyIncomingChanges([metadata.path]);
        await target.applyFileChange(
          {
            ...metadata,
            sourceTarget: "test-target",
            type: "modify"
          },
          stream
        );

        expect(spies.writeFile).toHaveBeenCalledWith(
          metadata.path,
          "test content",
          true
        );
      });

      it("should handle file deletion", async () => {
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "testhash",
            size: 100,
            lastModified: Date.now()
          },
          "test content"
        );
        await target.notifyIncomingChanges([metadata.path]);
        await target.applyFileChange({
          sourceTarget: target.id,
          ...metadata,
          type: "delete"
        });

        expect(spies.deleteItem).toHaveBeenCalledWith(metadata.path, {}, true);
      });

      it("should handle conflicts", async () => {
        const existingTimestamp = Date.now() - 1000;
        const newTimestamp = Date.now();

        // Setup existing file
        const { metadata: existingMetadata } =
          await context.setupFileWithMetadata(spies, "test.txt", {
            path: "test.txt",
            type: "file",
            hash: "existinghash",
            size: 100,
            lastModified: existingTimestamp
          });

        // Setup incoming change
        const { metadata: newMetadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "newhash",
            size: 100,
            lastModified: newTimestamp
          },
          "new content"
        );

        spies.exists.mockResolvedValue(true);
        spies.getMetadata.mockResolvedValue(existingMetadata);

        const stream = context.createMockStream(newMetadata, "new content");

        await target.notifyIncomingChanges([newMetadata.path]);
        await target.applyFileChange(
          {
            sourceTarget: target.id,
            ...newMetadata,
            type: "modify"
          },
          stream
        );

        expect(spies.writeFile).toHaveBeenCalledWith(
          newMetadata.path,
          "new content",
          true
        );
      });
    });

    describe("File Watching", () => {
      beforeEach(async () => {
        await target.initialize(fileSystem, true);
      });

      it("should start polling after initialization", async () => {
        // After initialization, the first poll should happen
        await vi.advanceTimersByTimeAsync(1000);
        expect(spies.listDirectory).toHaveBeenCalled();
      });

      it("should setup file watching with proper polling interval", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // First poll (no changes)
        spies.listDirectory.mockResolvedValueOnce([]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(spies.listDirectory).toHaveBeenCalled();
        expect(callback).not.toHaveBeenCalled();

        // Second poll (still no changes)
        spies.listDirectory.mockResolvedValueOnce([]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(spies.listDirectory).toHaveBeenCalledTimes(2);
        expect(callback).not.toHaveBeenCalled();
      });

      it("should cleanup polling on unwatch", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // First poll
        spies.listDirectory.mockResolvedValueOnce([]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(spies.listDirectory).toHaveBeenCalled();

        // Unwatch
        await target.unwatch();

        // No more polls should happen
        await vi.advanceTimersByTimeAsync(5000);
        expect(spies.listDirectory).toHaveBeenCalledTimes(1);
      });

      it("should detect new files with proper debouncing", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // First poll with empty directory
        spies.listDirectory.mockResolvedValueOnce([]);
        await vi.advanceTimersByTimeAsync(1000);

        // Setup new file
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "newfile.txt",
          {
            path: "newfile.txt",
            type: "file",
            hash: "newhash",
            size: 100,
            lastModified: Date.now()
          },
          "content"
        );

        // Wait for the next poll
        await vi.advanceTimersByTimeAsync(1000);

        // Wait for debounce
        await vi.advanceTimersByTimeAsync(100);

        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: metadata.path,
            type: "create",
            hash: metadata.hash,
            size: metadata.size,
            sourceTarget: target.id
          })
        ]);
      });

      it("should detect modified files with proper debouncing", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        const initialTimestamp = Date.now();
        const modifiedTimestamp = initialTimestamp + 5000;

        // Setup initial file and let it be detected
        await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            lastModified: initialTimestamp,
            hash: "initialhash",
            size: 100
          },
          "initial content"
        );

        // Wait for initial poll and debounce
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(100);

        // Reset the callback mock
        callback.mockReset();

        // Setup modified file
        const { metadata: modifiedMetadata } =
          await context.setupFileWithMetadata(
            spies,
            "test.txt",
            {
              path: "test.txt",
              type: "file",
              lastModified: modifiedTimestamp,
              hash: "modifiedhash",
              size: 150
            },
            "modified content"
          );

        // Wait for next poll
        await vi.advanceTimersByTimeAsync(1000);

        // Wait for debounce
        await vi.advanceTimersByTimeAsync(100);

        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: modifiedMetadata.path,
            type: "modify",
            hash: modifiedMetadata.hash,
            size: modifiedMetadata.size,
            lastModified: modifiedMetadata.lastModified,
            sourceTarget: target.id
          })
        ]);
      });

      it("should detect deleted files with proper debouncing", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Setup initial file and let it be detected
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "initialhash",
            size: 100,
            lastModified: Date.now()
          },
          "initial content"
        );

        // Wait for initial poll and debounce
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(100);

        // Reset the callback mock
        callback.mockReset();

        // Simulate deletion
        spies.listDirectory.mockResolvedValueOnce([]);

        // Wait for next poll
        await vi.advanceTimersByTimeAsync(1000);

        // Wait for debounce
        await vi.advanceTimersByTimeAsync(100);

        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: metadata.path,
            type: "delete",
            sourceTarget: target.id
          })
        ]);
      });

      it("should not overlap checks if previous check is still running", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Make the directory listing take longer than the polling interval
        let resolveListDirectory: () => void;
        spies.listDirectory.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveListDirectory = () => resolve([]);
            })
        );

        // Trigger first check
        await vi.advanceTimersByTimeAsync(1000);

        // Try to trigger second check while first is still running
        await vi.advanceTimersByTimeAsync(1000);

        // Should only have one listDirectory call
        expect(spies.listDirectory).toHaveBeenCalledTimes(1);

        // Complete the first check
        resolveListDirectory!();
        await vi.advanceTimersByTimeAsync(0);

        // Next check should now happen
        await vi.advanceTimersByTimeAsync(1000);
        expect(spies.listDirectory).toHaveBeenCalledTimes(2);
      });

      it("should buffer multiple changes within debounce period", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Setup two files to be detected in the same poll
        const { metadata: file1 } = await context.setupFileWithMetadata(
          spies,
          "file1.txt",
          {
            path: "file1.txt",
            type: "file",
            hash: "hash1",
            size: 100,
            lastModified: Date.now()
          },
          "content1"
        );

        const { metadata: file2 } = await context.setupFileWithMetadata(
          spies,
          "file2.txt",
          {
            path: "file2.txt",
            type: "file",
            hash: "hash2",
            size: 200,
            lastModified: Date.now()
          },
          "content2"
        );

        // Wait for poll
        await vi.advanceTimersByTimeAsync(1000);

        // Wait for debounce
        await vi.advanceTimersByTimeAsync(100);

        // Should get both changes in a single callback
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: file1.path,
            type: "create",
            sourceTarget: target.id
          }),
          expect.objectContaining({
            path: file2.path,
            type: "create",
            sourceTarget: target.id
          })
        ]);
      });
    });

    describe("State Management", () => {
      it("should update status during sync operations", async () => {
        await target.initialize(fileSystem, true);

        await target.notifyIncomingChanges(["test.txt"]);
        expect(target.getState().status).toBe("collecting");

        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            lastModified: Date.now(),
            hash: "initialhash",
            size: 100
          },
          "test content"
        );

        const mockStream = context.createMockStream(metadata);
        await target.applyFileChange(
          {
            sourceTarget: target.id,
            ...metadata,
            type: "modify"
          },
          mockStream
        );
        expect(target.getState().status).toBe("syncing");

        await target.syncComplete();
        expect(target.getState().status).toBe("idle");
      });

      it("should handle error states", async () => {
        await target.initialize(fileSystem, true);

        spies.writeFile.mockRejectedValue(new Error("Write failed"));

        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            lastModified: Date.now(),
            hash: "initialhash",
            size: 100
          },
          "test content"
        );

        const mockStream = context.createMockStream(metadata);
        await expect(
          target.applyFileChange(
            {
              sourceTarget: target.id,
              ...metadata,
              type: "modify"
            },
            mockStream
          )
        ).rejects.toThrow();

        const state = target.getState();
        expect(state.status).toBe("error");
        expect(state.error).toBeDefined();
      });
    });
  });
}
