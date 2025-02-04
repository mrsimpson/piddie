// Mock fs.promises.watch
vi.mock("fs/promises", () => ({
  watch: vi.fn()
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockInstance } from "vitest";
import { NodeSyncTarget } from "../src/NodeSyncTarget";
import { NodeFileSystem } from "../src/NodeFileSystem";
import type {
  FileMetadata,
  FileContentStream,
  FileChunk
} from "@piddie/shared-types";
import { SyncOperationError } from "@piddie/shared-types";
import { watch } from "fs/promises";
import { ReadableStream } from "node:stream/web";

// Helper to create a mock watcher that emits specified events
class MockFsWatcher
  implements
  AsyncIterable<{ eventType: "rename" | "change"; filename: string | null }> {
  private events: Array<{
    eventType: "rename" | "change";
    filename: string | null;
  }>;

  constructor(
    events: Array<{
      eventType: "rename" | "change";
      filename: string | null;
    }> = []
  ) {
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

// TODO: Re-enable once the local file system is done
describe.skip("NodeSyncTarget", () => {
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
    getMetadata: MockInstance;
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Setup mock watcher with no events by default
    mockWatcher = new MockFsWatcher();
    (watch as unknown as MockInstance).mockImplementation(() =>
      Promise.resolve(mockWatcher)
    );

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
      forceUnlock: vi.spyOn(fileSystem, "forceUnlock"),
      getMetadata: vi.spyOn(fileSystem, "getMetadata")
    };

    // Setup default mock implementations
    spies.initialize.mockResolvedValue(undefined);
    spies.readFile.mockResolvedValue("test content");
    spies.writeFile.mockResolvedValue(undefined);
    spies.deleteItem.mockResolvedValue(undefined);
    spies.exists.mockResolvedValue(false);
    spies.lock.mockResolvedValue(undefined);
    spies.forceUnlock.mockResolvedValue(undefined);
    spies.getMetadata.mockResolvedValue({
      path: "test.txt",
      type: "file",
      lastModified: Date.now()
    });
  });

  describe("Initialization", () => {
    it("should initialize with NodeFileSystem", async () => {
      await target.initialize(fileSystem);
      expect(spies.initialize).toHaveBeenCalled();
    });

    it("should reject non-NodeFileSystem instances", async () => {
      const invalidFs = {} as any;
      await expect(target.initialize(invalidFs)).rejects.toThrow(
        new SyncOperationError(
          "NodeSyncTarget requires NodeFileSystem",
          "INITIALIZATION_FAILED"
        )
      );
    });
  });

  describe("File Operations", () => {
    beforeEach(async () => {
      await target.initialize(fileSystem);
    });

    it("should lock filesystem during sync", async () => {
      spies.exists.mockResolvedValue(true);
      await target.notifyIncomingChanges(["test.txt"]);
      expect(spies.lock).toHaveBeenCalledWith(30000, "Sync in progress");
    });

    it("should unlock filesystem after sync completion", async () => {
      spies.exists.mockResolvedValue(true);
      await target.notifyIncomingChanges(["test.txt"]);
      await target.syncComplete();
      expect(spies.forceUnlock).toHaveBeenCalled();
    });

    it("should get file metadata", async () => {
      const paths = ["test1.txt", "test2.txt"];
      await target.getMetadata(paths);

      paths.forEach((path) => {
        expect(spies.getMetadata).toHaveBeenCalledWith(path);
      });
    });

    it("should get file content stream", async () => {
      const stream = await target.getFileContent("test.txt");
      expect(stream).toHaveProperty("metadata");
      expect(stream).toHaveProperty("getReader");
      expect(stream).toHaveProperty("close");
    });

    it("should apply file change with streaming", async () => {
      const metadata: FileMetadata = {
        path: "test.txt",
        type: "file",
        hash: "testhash",
        size: 123,
        lastModified: Date.now()
      };

      // Create a mock stream using actual ReadableStream
      const mockStream: FileContentStream = {
        metadata,
        getReader: () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue({
                content: "test content",
                chunkIndex: 0,
                totalChunks: 1,
                chunkHash: "testhash"
              });
              controller.close();
            }
          });
          return stream.getReader();
        },
        close: vi.fn().mockResolvedValue(undefined)
      };

      spies.exists.mockResolvedValue(false);
      spies.writeFile.mockResolvedValue(undefined);

      const conflict = await target.applyFileChange(metadata, mockStream);
      expect(conflict).toBeNull();
      expect(spies.writeFile).toHaveBeenCalledWith("test.txt", "test content");
    });

    it("should check file existence for conflicts", async () => {
      spies.exists.mockResolvedValue(true);
      spies.getMetadata.mockResolvedValue({
        path: "test.txt",
        type: "file",
        hash: "existinghash", // Different hash than incoming
        size: 100,
        lastModified: Date.now() - 1000 // Older timestamp
      });

      const metadata: FileMetadata = {
        path: "test.txt",
        type: "file",
        hash: "newhash",
        size: 123,
        lastModified: Date.now()
      };

      // Create an empty mock stream since we'll hit a conflict before reading
      const mockStream: FileContentStream = {
        metadata,
        getReader: () => new ReadableStream<FileChunk>().getReader(),
        close: vi.fn().mockResolvedValue(undefined)
      };

      const conflict = await target.applyFileChange(metadata, mockStream);
      expect(conflict).toEqual({
        path: "test.txt",
        sourceTarget: "test-target",
        targetId: "test-target",
        timestamp: expect.any(Number)
      });
      expect(spies.exists).toHaveBeenCalledWith("test.txt");
      expect(spies.getMetadata).toHaveBeenCalledWith("test.txt");
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
      (watch as unknown as MockInstance).mockImplementation(() =>
        Promise.resolve(mockWatcher)
      );

      await target.watch(callback);

      // Wait for the async iteration to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

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
      (watch as unknown as MockInstance).mockImplementation(() =>
        Promise.resolve(mockWatcher)
      );

      await target.watch(callback);

      // Wait for the async iteration to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(spies.exists).toHaveBeenCalledWith(testFile);
      expect(callback).toHaveBeenCalledWith([
        expect.objectContaining({
          path: testFile,
          type: "modify",
          sourceTarget: "test-target"
        })
      ]);
    });

    it("should handle file deletion events", async () => {
      const callback = vi.fn();
      const testFile = "test.txt";

      // Setup watcher to emit a deletion event
      mockWatcher = new MockFsWatcher([
        { eventType: "rename", filename: testFile }
      ]);
      (watch as unknown as MockInstance).mockImplementation(() =>
        Promise.resolve(mockWatcher)
      );

      await target.watch(callback);

      // Wait for the async iteration to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(callback).toHaveBeenCalledWith([
        expect.objectContaining({
          path: testFile,
          type: "delete",
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

    it("should update status during sync operations", async () => {
      spies.exists.mockResolvedValue(true);

      await target.initialize(fileSystem);
      await target.notifyIncomingChanges(["test.txt"]);
      expect(target.getState().status).toBe("notifying");

      const metadata: FileMetadata = {
        path: "test.txt",
        type: "file",
        hash: "testhash",
        size: 123,
        lastModified: Date.now()
      };

      // Create a mock stream using actual ReadableStream
      const mockStream: FileContentStream = {
        metadata,
        getReader: () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue({
                content: "test content",
                chunkIndex: 0,
                totalChunks: 1,
                chunkHash: "testhash"
              });
              controller.close();
            }
          });
          return stream.getReader();
        },
        close: vi.fn().mockResolvedValue(undefined)
      };

      await target.applyFileChange(metadata, mockStream);
      expect(target.getState().status).toBe("syncing");

      await target.syncComplete();
      expect(target.getState().status).toBe("idle");
    });
  });
});
