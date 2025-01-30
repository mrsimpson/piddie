import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { BrowserSyncTarget } from "../src/BrowserSyncTarget";
import { BrowserFileSystem } from "../src/BrowserFileSystem";
import type {
  FileMetadata,
  FileContentStream,
  FileChunk
} from "@piddie/shared-types";
import { ReadableStream } from "node:stream/web";

// Define mock fs methods
const mockPromises = {
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({
    isDirectory: () => false,
    isFile: () => true,
    mtimeMs: Date.now()
  }),
  readFile: vi.fn().mockResolvedValue("test content"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  rmdir: vi.fn().mockResolvedValue(undefined)
};

vi.mock("@isomorphic-git/lightning-fs", () => {
  class MockFS {
    promises = mockPromises;
    constructor() { }
  }
  return { default: MockFS };
});

describe("BrowserSyncTarget", () => {
  const TEST_ROOT = "/test/root";
  let target: BrowserSyncTarget;
  let fileSystem: BrowserFileSystem;

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
    vi.useFakeTimers();
    vi.resetAllMocks();

    // Reset mock implementations
    mockPromises.stat.mockImplementation((filePath: string) => {
      if (filePath === TEST_ROOT) {
        return Promise.resolve({
          isDirectory: () => true,
          isFile: () => false,
        });
      }
      return Promise.resolve({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: Date.now()
      });
    });

    mockPromises.readFile.mockResolvedValue("test content");
    mockPromises.readdir.mockResolvedValue([]);

    fileSystem = new BrowserFileSystem({ name: "test", rootDir: TEST_ROOT });
    target = new BrowserSyncTarget("test-target");

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
    spies.initialize.mockImplementation(async () => {
      (fileSystem as any).initialized = true;
      return Promise.resolve();
    });
    spies.readFile.mockResolvedValue("test content");
    spies.writeFile.mockResolvedValue(undefined);
    spies.deleteItem.mockResolvedValue(undefined);
    spies.exists.mockResolvedValue(true);
    spies.lock.mockResolvedValue(undefined);
    spies.forceUnlock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Initialization", () => {
    it("should initialize with BrowserFileSystem", async () => {
      await target.initialize(fileSystem);
      expect(spies.initialize).toHaveBeenCalled();
    });

    it("should reject non-BrowserFileSystem instances", async () => {
      const invalidFs = {} as any;
      await expect(target.initialize(invalidFs)).rejects.toThrow(
        "BrowserSyncTarget requires BrowserFileSystem"
      );
    });
  });

  describe("File Operations", () => {
    beforeEach(async () => {
      await target.initialize(fileSystem);
    });

    it("should lock filesystem during sync", async () => {
      await target.notifyIncomingChanges();
      expect(spies.lock).toHaveBeenCalledWith(30000, "Sync in progress");
    });

    it("should unlock filesystem after sync completion", async () => {
      await target.notifyIncomingChanges();
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
      const mockMetadata: FileMetadata = {
        path: "test.txt",
        type: "file",
        hash: "testhash",
        size: 100,
        lastModified: Date.now()
      };

      spies.getMetadata.mockResolvedValue(mockMetadata);
      spies.readFile.mockResolvedValue("test content");

      // Initialize fileSystem
      await target.initialize(fileSystem);

      const stream = await target.getFileContent("test.txt");

      // Test stream interface
      expect(stream).toHaveProperty("metadata");
      expect(stream).toHaveProperty("getReader");
      expect(stream).toHaveProperty("close");

      // Test reading content
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

      // Verify content
      const fullContent = chunks.map((chunk) => chunk.content).join("");
      expect(fullContent).toBe("test content");
    });

    it("should apply file change with streaming", async () => {
      const metadata: FileMetadata = {
        path: "test.txt",
        type: "file",
        hash: "testhash",
        size: 123,
        lastModified: Date.now()
      };

      // Initialize fileSystem
      await target.initialize(fileSystem);

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
      // Initialize fileSystem
      await target.initialize(fileSystem);

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

    it("should setup file watching with timeout", async () => {
      const callback = vi.fn();
      await target.watch(callback);

      // Verify that no changes are detected immediately
      expect(callback).not.toHaveBeenCalled();

      // Advance timer by 1 second
      await vi.advanceTimersByTimeAsync(1000);

      // Initial check should have run
      expect(callback).not.toHaveBeenCalled(); // No changes yet
    });

    it("should cleanup timeout on unwatch", async () => {
      const callback = vi.fn();
      await target.watch(callback);

      await target.unwatch();

      // Advance timer
      await vi.advanceTimersByTimeAsync(1000);

      // Callback should not be called after unwatch
      expect(callback).not.toHaveBeenCalled();
    });

    it("should detect new files", async () => {
      const callback = vi.fn();
      await target.watch(callback);

      // Mock a new file appearing
      mockPromises.readdir.mockResolvedValue(["newfile.txt"]);

      // Advance timer to trigger check
      await vi.advanceTimersByTimeAsync(1000);

      // Should detect the new file
      expect(callback).toHaveBeenCalledWith([
        expect.objectContaining({
          path: "/newfile.txt",
          type: "create",
          sourceTarget: "test-target"
        })
      ]);
    });

    it("should detect modified files", async () => {
      const callback = vi.fn();
      await target.watch(callback);

      // First, set up initial state with a file
      const initialTimestamp = Date.now();
      mockPromises.readdir.mockResolvedValue(["test.txt"]);

      // First check to register the file
      await vi.advanceTimersByTimeAsync(1000);

      // Now simulate a modification with a newer timestamp
      mockPromises.stat.mockImplementation((filePath: string) => {
        if (filePath === TEST_ROOT) {
          return Promise.resolve({
            isDirectory: () => true,
            isFile: () => false,
          });
        }
        return Promise.resolve({
          isDirectory: () => false,
          isFile: () => true,
          mtimeMs: Date.now() + 5000 // 5 seconds later
        });
      });

      // Advance timer for next check
      await vi.advanceTimersByTimeAsync(1000);

      // Should detect the modification
      expect(callback).toHaveBeenLastCalledWith([
        expect.objectContaining({
          path: "/test.txt",
          type: "modify",
          sourceTarget: "test-target"
        })
      ]);
    });

    it("should detect deleted files", async () => {
      const callback = vi.fn();
      await target.watch(callback);

      // First, mock an existing file
      mockPromises.readdir.mockResolvedValue(["test.txt"]);

      // First check to register the file
      await vi.advanceTimersByTimeAsync(1000);

      // Now simulate file deletion by returning empty directory
      mockPromises.readdir.mockResolvedValue([]);

      // Advance timer for next check
      await vi.advanceTimersByTimeAsync(1000);

      // Should detect the deletion
      expect(callback).toHaveBeenLastCalledWith([
        expect.objectContaining({
          path: "/test.txt",
          type: "delete",
          sourceTarget: "test-target"
        })
      ]);
    });

    it("should not overlap checks if previous check is still running", async () => {
      const callback = vi.fn();
      await target.watch(callback);

      // Make the first check take longer by adding a delay
      mockPromises.readdir.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return ["test.txt"];
      });

      // Advance timer to trigger first check
      await vi.advanceTimersByTimeAsync(1000);

      // Advance timer again before first check completes
      await vi.advanceTimersByTimeAsync(1000);

      // Only one check should have started
      expect(mockPromises.readdir).toHaveBeenCalledTimes(1);
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
      await target.initialize(fileSystem);

      await target.notifyIncomingChanges();
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
