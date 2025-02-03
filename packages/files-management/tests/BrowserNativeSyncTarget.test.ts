import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    vi.useFakeTimers();
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Initialization", () => {
    it("should initialize with BrowserNativeFileSystem", async () => {
      await target.initialize(fileSystem, true);
      expect(spies.initialize).toHaveBeenCalled();
    });

    it("should reject non-BrowserNativeFileSystem instances", async () => {
      const invalidFs = {} as any;
      await expect(target.initialize(invalidFs, true)).rejects.toThrow(
        "BrowserNativeSyncTarget requires BrowserNativeFileSystem"
      );
    });
  });

  describe("File Operations", () => {
    beforeEach(async () => {
      await target.initialize(fileSystem, true);
      await spies.listDirectory.mockResolvedValue([
        { path: "/test.txt", type: "file" }
      ]);
    });

    it("should lock filesystem during sync", async () => {
      await target.notifyIncomingChanges(["/test.txt"]);
      expect(spies.lock).toHaveBeenCalledWith(
        30000,
        "Sync in progress",
        "sync"
      );
    });

    it("should unlock filesystem after sync completion", async () => {
      await target.notifyIncomingChanges(["/test.txt"]);
      await target.syncComplete();
      expect(spies.forceUnlock).toHaveBeenCalled();
    });

    it("should get file metadata", async () => {
      await target.initialize(fileSystem, true);

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
      await target.initialize(fileSystem, true);
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
      await target.initialize(fileSystem, true);
      const callback = vi.fn();
      await target.watch(callback);

      // First call returns empty directory
      spies.listDirectory.mockResolvedValueOnce([]);
      await vi.advanceTimersByTimeAsync(1000);

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

      // Advance timer for next check
      await vi.advanceTimersByTimeAsync(1000);

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
      await target.initialize(fileSystem, true);
      const callback = vi.fn();
      await target.watch(callback);

      const initialTimestamp = Date.now();
      const modifiedTimestamp = initialTimestamp + 5000;

      // Setup initial file state
      await setupFileWithMetadata(spies, mockFiles, "test.txt", "content", {
        lastModified: initialTimestamp,
        hash: "initialhash"
      });
      await vi.advanceTimersByTimeAsync(1000);

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

      // Advance timer for next check
      await vi.advanceTimersByTimeAsync(1000);

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
      await target.initialize(fileSystem, true);
      const callback = vi.fn();
      await target.watch(callback);

      // Setup initial file
      const { metadata } = await setupFileWithMetadata(
        spies,
        mockFiles,
        "test.txt"
      );
      await vi.advanceTimersByTimeAsync(1000);

      // Simulate deletion
      mockFiles.delete("test.txt");
      spies.listDirectory.mockResolvedValueOnce([]);

      // Advance timer for next check
      await vi.advanceTimersByTimeAsync(1000);

      // Should detect the deletion
      expect(callback).toHaveBeenLastCalledWith([
        expect.objectContaining({
          path: metadata.path,
          type: "delete",
          sourceTarget: "test-target"
        })
      ]);
    });

    it("should not overlap checks if previous check is still running", async () => {
      const callback = vi.fn();
      await target.watch(callback);

      // Make the first check take longer by adding a delay
      spies.listDirectory.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return [];
      });

      // Advance timer to trigger first check
      await vi.advanceTimersByTimeAsync(1000);

      // Advance timer again before first check completes
      await vi.advanceTimersByTimeAsync(1000);

      // Only one check should have started
      expect(spies.listDirectory).toHaveBeenCalledTimes(1);
    });
  });

  describe("State Management", () => {
    it("should report error state when not initialized", () => {
      const state = target.getState();
      expect(state).toEqual(
        expect.objectContaining({
          status: "uninitialized",
          error: undefined
        })
      );
    });

    it("should update status during sync operations", async () => {
      await target.initialize(fileSystem, true);

      await target.notifyIncomingChanges(["/test.txt"]);
      expect(target.getState().status).toBe("collecting");

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

  describe("Empty Filesystem Handling", () => {
    beforeEach(async () => {
      // Setup root directory handle with proper mock implementation
      mockFiles = new Map();
      mockRootHandle = createMockDirectoryHandle("root", mockFiles);

      // Mock getHandle method for BrowserNativeFileSystem
      const getHandleSpy = vi.spyOn(
        BrowserNativeFileSystem.prototype as any,
        "getHandle"
      );
      getHandleSpy.mockImplementation(function (this: any, ...args: any[]) {
        const path = args[0] as string;
        if (path === "/") return Promise.resolve(mockRootHandle);
        const segments = path.split("/").filter(Boolean);
        let currentHandle: ReturnType<typeof createMockDirectoryHandle> =
          mockRootHandle;

        for (const segment of segments) {
          const handle = mockFiles.get(segment);
          if (!handle || handle.kind !== "directory") {
            return Promise.reject(new Error("NotFoundError"));
          }
          currentHandle = handle as ReturnType<
            typeof createMockDirectoryHandle
          >;
        }

        return Promise.resolve(currentHandle);
      });

      // Mock getDirectoryHandle for root and directories
      mockRootHandle.getDirectoryHandle = vi
        .fn()
        .mockImplementation(async (name, options) => {
          const existingHandle = mockFiles.get(name);
          if (existingHandle) {
            if (existingHandle.kind !== "directory") {
              throw new Error("TypeMismatchError");
            }
            return existingHandle as ReturnType<
              typeof createMockDirectoryHandle
            >;
          }
          if (options?.create) {
            const newHandle = createMockDirectoryHandle(name, new Map());
            mockFiles.set(name, newHandle);
            return newHandle;
          }
          throw new Error("NotFoundError");
        });

      fileSystem = new BrowserNativeFileSystem({ rootHandle: mockRootHandle });
      target = new BrowserNativeSyncTarget("test-target");

      // Initialize with proper mocks
      spies.exists.mockResolvedValue(true);
      spies.getMetadata.mockImplementation(async (path) => ({
        path,
        type: "directory",
        hash: "",
        size: 0,
        lastModified: Date.now()
      }));
      spies.listDirectory.mockResolvedValue([]);

      await target.initialize(fileSystem, true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should handle empty filesystem sync correctly", async () => {
      // Mock an empty filesystem
      spies.listDirectory.mockResolvedValue([]);

      // Start sync process
      await target.notifyIncomingChanges(["/"]); // Include root directory
      expect(target.getState().status).toBe("collecting");

      // Should transition to syncing even with no files
      await target.applyFileChange(
        {
          path: "/",
          type: "directory",
          hash: "",
          size: 0,
          lastModified: Date.now()
        },
        {
          metadata: {
            path: "/",
            type: "directory",
            hash: "",
            size: 0,
            lastModified: Date.now()
          },
          getReader: () => new ReadableStream().getReader(),
          close: async () => {}
        }
      );
      expect(target.getState().status).toBe("syncing");

      // Should complete sync successfully
      await target.syncComplete();
      expect(target.getState().status).toBe("idle");
    });

    it("should handle empty directory sync correctly", async () => {
      const emptyDirPath = "/empty-dir";
      const timestamp = Date.now();

      // Setup mock directory in the file system
      const emptyDirHandle = createMockDirectoryHandle("empty-dir", new Map());
      mockFiles.set("empty-dir", emptyDirHandle);

      spies.exists.mockImplementation(
        async (path) => path === emptyDirPath || path === "/"
      );

      spies.getMetadata.mockImplementation(async (path) => ({
        path,
        type: "directory",
        hash: "",
        size: 0,
        lastModified: timestamp
      }));

      spies.listDirectory.mockImplementation(async (path) =>
        path === emptyDirPath ? [] : [{ path: emptyDirPath, type: "directory" }]
      );

      // Start sync process
      await target.notifyIncomingChanges([emptyDirPath]);
      expect(target.getState().status).toBe("collecting");

      // Apply directory change
      await target.applyFileChange(
        {
          path: emptyDirPath,
          type: "directory",
          hash: "",
          size: 0,
          lastModified: timestamp
        },
        {
          metadata: {
            path: emptyDirPath,
            type: "directory",
            hash: "",
            size: 0,
            lastModified: timestamp
          },
          getReader: () => new ReadableStream().getReader(),
          close: async () => {}
        }
      );
      expect(target.getState().status).toBe("syncing");

      // Should complete sync successfully
      await target.syncComplete();
      expect(target.getState().status).toBe("idle");
    });

    it("should maintain state transitions with multiple empty directories", async () => {
      const emptyDirs = ["/empty1", "/empty2", "/empty1/sub"];
      const timestamp = Date.now();

      // Setup mock directories in the file system
      const dirHandles = new Map();
      emptyDirs.forEach((dir) => {
        const name = dir.split("/").pop()!;
        const handle = createMockDirectoryHandle(name, new Map());
        dirHandles.set(name, handle);
        mockFiles.set(name, handle);

        // Setup getDirectoryHandle for each directory
        handle.getDirectoryHandle = vi
          .fn()
          .mockImplementation(async (subName, options) => {
            const subHandle = dirHandles.get(subName);
            if (subHandle && subHandle.kind === "directory") return subHandle;
            if (options?.create) {
              const newHandle = createMockDirectoryHandle(subName, new Map());
              dirHandles.set(subName, newHandle);
              return newHandle;
            }
            throw new Error("NotFoundError");
          });
      });

      spies.exists.mockImplementation(
        async (path) => path === "/" || emptyDirs.includes(path)
      );

      spies.getMetadata.mockImplementation(async (path) => ({
        path,
        type: "directory",
        hash: "",
        size: 0,
        lastModified: timestamp
      }));

      spies.listDirectory.mockImplementation(async (path) => {
        if (path === "/empty1")
          return [{ path: "/empty1/sub", type: "directory" }];
        if (emptyDirs.includes(path)) return [];
        return emptyDirs
          .filter((dir) => dir.split("/").length === 2) // Only direct children of root
          .map((dir) => ({ path: dir, type: "directory" }));
      });

      // Start sync process
      await target.notifyIncomingChanges(emptyDirs);
      expect(target.getState().status).toBe("collecting");

      // Apply changes for each directory
      for (const dirPath of emptyDirs) {
        await target.applyFileChange(
          {
            path: dirPath,
            type: "directory",
            hash: "",
            size: 0,
            lastModified: timestamp
          },
          {
            metadata: {
              path: dirPath,
              type: "directory",
              hash: "",
              size: 0,
              lastModified: timestamp
            },
            getReader: () => new ReadableStream().getReader(),
            close: async () => {}
          }
        );
      }
      expect(target.getState().status).toBe("syncing");

      // Should complete sync successfully
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
