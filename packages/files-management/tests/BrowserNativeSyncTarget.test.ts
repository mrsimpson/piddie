import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockInstance } from "vitest";
import { BrowserNativeSyncTarget } from "../src/BrowserNativeSyncTarget";
import { BrowserNativeFileSystem } from "../src/BrowserNativeFileSystem";
import type {
  FileMetadata,
  FileContentStream,
  FileChunk,
  FileSystem
} from "@piddie/shared-types";
import { ReadableStream } from "node:stream/web";

// Mock File System Access API
vi.mock("native-file-system-adapter", () => {
  return {
    showDirectoryPicker: vi.fn()
  };
});

// Mock window.setInterval and window.clearInterval
const mockSetInterval = vi.fn();
const mockClearInterval = vi.fn();
vi.stubGlobal("setInterval", mockSetInterval);
vi.stubGlobal("clearInterval", mockClearInterval);

// Create mock implementations for File System Access API
const createMockFile = (
  content: string = "",
  lastModified: number = Date.now()
): File => {
  return new File([content], "mock.txt", { lastModified });
};

const createMockFileHandle = (
  name: string,
  content: string = "",
  lastModified: number = Date.now()
) => ({
  kind: "file" as const,
  name,
  getFile: vi.fn().mockResolvedValue(createMockFile(content, lastModified)),
  createWritable: vi.fn(),
  queryPermission: vi.fn().mockResolvedValue("granted"),
  requestPermission: vi.fn().mockResolvedValue("granted")
});

const createMockDirectoryHandle = (name: string, entries = new Map()) => ({
  kind: "directory" as const,
  name,
  entries: vi.fn().mockImplementation(async function* () {
    for (const [name, handle] of entries) {
      yield [name, handle];
    }
  }),
  getDirectoryHandle: vi.fn(),
  getFileHandle: vi.fn(),
  removeEntry: vi.fn(),
  queryPermission: vi.fn().mockResolvedValue("granted"),
  requestPermission: vi.fn().mockResolvedValue("granted")
});

describe("BrowserNativeSyncTarget", () => {
  let target: BrowserNativeSyncTarget;
  let fileSystem: FileSystem;
  let mockRootHandle: ReturnType<typeof createMockDirectoryHandle>;
  let mockFiles: Map<
    string,
    | ReturnType<typeof createMockFileHandle>
    | ReturnType<typeof createMockDirectoryHandle>
  >;

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
    listDirectory: MockInstance;
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Setup mock file system
    mockFiles = new Map();
    mockRootHandle = createMockDirectoryHandle("root", mockFiles);
    fileSystem = new BrowserNativeFileSystem({ rootHandle: mockRootHandle });
    target = new BrowserNativeSyncTarget("test-target");

    // Setup spies on FileSystem methods
    spies = {
      initialize: vi.spyOn(fileSystem, "initialize"),
      readFile: vi.spyOn(fileSystem, "readFile"),
      writeFile: vi.spyOn(fileSystem, "writeFile"),
      deleteItem: vi.spyOn(fileSystem, "deleteItem"),
      exists: vi.spyOn(fileSystem, "exists"),
      lock: vi.spyOn(fileSystem, "lock"),
      forceUnlock: vi.spyOn(fileSystem, "forceUnlock"),
      getMetadata: vi.spyOn(fileSystem, "getMetadata"),
      listDirectory: vi.spyOn(fileSystem, "listDirectory")
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
    it("should initialize with BrowserNativeFileSystem", async () => {
      await target.initialize(fileSystem);
      expect(spies.initialize).toHaveBeenCalled();
    });

    it("should reject non-BrowserNativeFileSystem instances", async () => {
      const invalidFs = {} as any;
      await expect(target.initialize(invalidFs)).rejects.toThrow(
        "BrowserNativeSyncTarget requires BrowserNativeFileSystem"
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
      await target.initialize(fileSystem);

      const { metadata: expectedMetadata } = await setupFileWithMetadata(
        spies,
        mockFiles,
        "test.txt"
      );
      const metadata = await target.getMetadata([expectedMetadata.path]);

      expect(metadata).toHaveLength(1);
      expect(metadata[0]).toEqual(expectedMetadata);
      expect(spies.getMetadata).toHaveBeenCalledWith(expectedMetadata.path);
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
      await target.initialize(fileSystem);
      const { callback, intervalCallback } = await setupWatchCallback(target);

      // First call returns empty directory
      spies.listDirectory.mockResolvedValueOnce([]);
      await intervalCallback();

      // Setup new file
      const { metadata } = await setupFileWithMetadata(
        spies,
        mockFiles,
        "newfile.txt",
        "content",
        {
          hash: "newhash",
          size: 100
        }
      );

      // Trigger another interval
      await intervalCallback();

      // Should detect the new file
      expect(callback).toHaveBeenCalledWith([
        expect.objectContaining({
          path: metadata.path,
          type: "create",
          hash: metadata.hash,
          size: metadata.size,
          sourceTarget: "test-target"
        })
      ]);
    });

    it("should detect modified files", async () => {
      await target.initialize(fileSystem);
      const { callback, intervalCallback } = await setupWatchCallback(target);

      const initialTimestamp = Date.now();
      const modifiedTimestamp = initialTimestamp + 5000;

      // Setup initial file state
      await setupFileWithMetadata(spies, mockFiles, "test.txt", "content", {
        lastModified: initialTimestamp,
        hash: "initialhash"
      });
      await intervalCallback();

      // Clear previous mock to set up modified state
      spies.listDirectory.mockReset();
      spies.getMetadata.mockReset();

      // Setup modified file state
      const { metadata: modifiedMetadata } = await setupFileWithMetadata(
        spies,
        mockFiles,
        "test.txt",
        "new content",
        {
          lastModified: modifiedTimestamp,
          hash: "modifiedhash",
          size: 150
        }
      );

      // Trigger another interval
      await intervalCallback();

      // Should detect the modification
      expect(callback).toHaveBeenLastCalledWith([
        expect.objectContaining({
          path: modifiedMetadata.path,
          type: "modify",
          hash: modifiedMetadata.hash,
          size: modifiedMetadata.size,
          lastModified: modifiedMetadata.lastModified,
          sourceTarget: "test-target"
        })
      ]);
    });

    it("should detect deleted files", async () => {
      await target.initialize(fileSystem);
      const { callback, intervalCallback } = await setupWatchCallback(target);

      // Setup initial file
      const { metadata } = await setupFileWithMetadata(
        spies,
        mockFiles,
        "test.txt"
      );
      await intervalCallback();

      // Simulate deletion
      mockFiles.delete("test.txt");
      spies.listDirectory.mockResolvedValueOnce([]);

      // Trigger another interval
      await intervalCallback();

      // Should detect the deletion
      expect(callback).toHaveBeenLastCalledWith([
        expect.objectContaining({
          path: metadata.path,
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

// Helper functions for test setup
const setupFileWithMetadata = async (
  spies: {
    initialize: MockInstance;
    readFile: MockInstance;
    writeFile: MockInstance;
    deleteItem: MockInstance;
    exists: MockInstance;
    lock: MockInstance;
    forceUnlock: MockInstance;
    getMetadata: MockInstance;
    listDirectory: MockInstance;
  },
  mockFiles: Map<string, any>,
  path: string,
  content: string = "test content",
  metadata: Partial<FileMetadata> = {}
) => {
  const timestamp = metadata.lastModified ?? Date.now();
  const fileHandle = createMockFileHandle(path, content, timestamp);
  mockFiles.set(path, fileHandle);

  const fullMetadata: FileMetadata = {
    path: `/${path}`,
    type: "file",
    hash: metadata.hash ?? "testhash",
    size: metadata.size ?? 100,
    lastModified: timestamp,
    ...metadata
  };

  spies.listDirectory.mockResolvedValueOnce([
    {
      path: `/${path}`,
      type: "file",
      lastModified: timestamp
    }
  ]);

  spies.getMetadata.mockResolvedValueOnce(fullMetadata);

  return { fileHandle, metadata: fullMetadata };
};

const setupWatchCallback = async (target: BrowserNativeSyncTarget) => {
  const callback = vi.fn();
  await target.watch(callback);

  const intervalCallback = mockSetInterval.mock?.calls[0]?.[0];
  if (!intervalCallback) {
    throw new Error("Interval callback not set");
  }

  return { callback, intervalCallback };
};
