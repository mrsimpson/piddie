import { describe, it, expect, vi, beforeEach } from "vitest";
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
    constructor() {}
  }
  return { default: MockFS };
});

// Mock window.setInterval and window.clearInterval
const mockSetInterval = vi.fn();
const mockClearInterval = vi.fn();
vi.stubGlobal("setInterval", mockSetInterval);
vi.stubGlobal("clearInterval", mockClearInterval);

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
    vi.resetAllMocks();

    // Reset mock implementations
    mockPromises.stat.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      mtimeMs: Date.now()
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
    spies.exists.mockResolvedValue(false);
    spies.lock.mockResolvedValue(undefined);
    spies.forceUnlock.mockResolvedValue(undefined);

    // Reset interval mocks
    mockSetInterval.mockReturnValue(123); // Mock interval ID
    mockClearInterval.mockReturnValue(undefined);
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

    it("should setup file watching with interval", async () => {
      const callback = vi.fn();
      await target.watch(callback);

      expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
    });

    it("should cleanup interval on unwatch", async () => {
      const callback = vi.fn();
      await target.watch(callback);
      const intervalId = mockSetInterval.mock?.results[0]?.value;

      await target.unwatch();
      expect(mockClearInterval).toHaveBeenCalledWith(intervalId);
    });

    it("should detect new files", async () => {
      const callback = vi.fn();
      await target.watch(callback);

      // Get the interval callback
      const intervalCallback = mockSetInterval.mock?.calls[0]?.[0];
      if (!intervalCallback) {
        throw new Error("Interval callback not set");
      }

      // Mock a new file appearing
      mockPromises.readdir.mockResolvedValue(["newfile.txt"]);
      mockPromises.stat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: Date.now()
      });

      // Trigger the interval callback
      await intervalCallback();

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

      // Get the interval callback
      const intervalCallback = mockSetInterval.mock?.calls[0]?.[0];
      if (!intervalCallback) {
        throw new Error("Interval callback not set");
      }

      // First, set up initial state with a file
      const initialTimestamp = Date.now();
      mockPromises.readdir.mockResolvedValue(["test.txt"]);
      mockPromises.stat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: initialTimestamp
      });

      // Let one interval pass to register the file
      await intervalCallback();

      // Now simulate a modification with a newer timestamp
      mockPromises.stat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: initialTimestamp + 5000 // 5 seconds later
      });

      // Trigger another interval
      await intervalCallback();

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

      // Get the interval callback
      const intervalCallback = mockSetInterval.mock?.calls[0]?.[0];
      if (!intervalCallback) {
        throw new Error("Interval callback not set");
      }

      // Let one interval pass to register the file
      await intervalCallback();

      // Now simulate file deletion by returning empty directory
      mockPromises.readdir.mockResolvedValue([]);

      // Trigger another interval
      await intervalCallback();

      // Should detect the deletion
      expect(callback).toHaveBeenLastCalledWith([
        expect.objectContaining({
          path: "/test.txt",
          type: "delete",
          sourceTarget: "test-target"
        })
      ]);
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
