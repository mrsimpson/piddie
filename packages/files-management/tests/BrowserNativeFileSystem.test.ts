// Mock File System Access API
vi.mock("native-file-system-adapter", () => {
  return {
    // Mock the showDirectoryPicker function
    showDirectoryPicker: vi.fn()
  };
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FileSystem } from "@piddie/shared-types";
import type { WritableStream } from "node:stream/web";

// File System Access API types
type PermissionState = "granted" | "denied" | "prompt";

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | ArrayBuffer | ArrayBufferView | Blob): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
}

// Mock FileSystemHandle types and implementations
interface MockFileSystemHandle {
  kind: "file" | "directory";
  name: string;
  queryPermission: (desc: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
  requestPermission: (desc: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
}

interface MockFileSystemFileHandle extends MockFileSystemHandle {
  kind: "file";
  getFile: () => Promise<File>;
  createWritable: () => Promise<FileSystemWritableFileStream>;
}

interface MockFileSystemDirectoryHandle extends MockFileSystemHandle {
  kind: "directory";
  entries: () => AsyncIterableIterator<[string, MockFileSystemHandle]>;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<MockFileSystemDirectoryHandle>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<MockFileSystemFileHandle>;
  removeEntry: (
    name: string,
    options?: { recursive?: boolean }
  ) => Promise<void>;
}

// Create mock implementations
const createMockFile = (
  content: string = "",
  lastModified: number = Date.now()
): File => {
  return new File([content], "mock.txt", { lastModified });
};

const createMockWritableStream = () => {
  let content = "";
  return {
    write: vi.fn().mockImplementation((data: string) => {
      content += data;
      return Promise.resolve();
    }),
    close: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    truncate: vi.fn().mockResolvedValue(undefined),
    _getContent: () => content
  };
};

const createMockFileHandle = (
  name: string,
  content: string = "",
  lastModified: number = Date.now(),
  permissions: { read?: boolean; write?: boolean } = { read: true, write: true }
): MockFileSystemFileHandle => ({
  kind: "file",
  name,
  queryPermission: vi.fn().mockImplementation(({ mode }) => {
    if (mode === "read")
      return Promise.resolve(permissions.read ? "granted" : "denied");
    return Promise.resolve(permissions.write ? "granted" : "denied");
  }),
  requestPermission: vi.fn().mockImplementation(({ mode }) => {
    if (mode === "read")
      return Promise.resolve(permissions.read ? "granted" : "denied");
    return Promise.resolve(permissions.write ? "granted" : "denied");
  }),
  getFile: vi.fn().mockResolvedValue(createMockFile(content, lastModified)),
  createWritable: vi
    .fn()
    .mockImplementation(() => Promise.resolve(createMockWritableStream()))
});

const createMockDirectoryHandle = (
  name: string,
  entries: Map<string, MockFileSystemHandle> = new Map(),
  permissions: { read?: boolean; write?: boolean } = { read: true, write: true }
): MockFileSystemDirectoryHandle => ({
  kind: "directory",
  name,
  queryPermission: vi.fn().mockImplementation(({ mode }) => {
    if (mode === "read")
      return Promise.resolve(permissions.read ? "granted" : "denied");
    return Promise.resolve(permissions.write ? "granted" : "denied");
  }),
  requestPermission: vi.fn().mockImplementation(({ mode }) => {
    if (mode === "read")
      return Promise.resolve(permissions.read ? "granted" : "denied");
    return Promise.resolve(permissions.write ? "granted" : "denied");
  }),
  entries: vi.fn().mockImplementation(async function* () {
    for (const [name, handle] of entries) {
      yield [name, handle];
    }
  }),
  getDirectoryHandle: vi
    .fn()
    .mockImplementation(async (name, { create = false } = {}) => {
      const existing = entries.get(name);
      if (existing?.kind === "directory") return existing;
      if (!create) throw new Error("NotFoundError");
      const newDir = createMockDirectoryHandle(name, new Map(), permissions);
      entries.set(name, newDir);
      return newDir;
    }),
  getFileHandle: vi
    .fn()
    .mockImplementation(async (name, { create = false } = {}) => {
      const existing = entries.get(name);
      if (existing?.kind === "file") return existing;
      if (!create) throw new Error("NotFoundError");
      const newFile = createMockFileHandle(name, "", Date.now(), permissions);
      entries.set(name, newFile);
      return newFile;
    }),
  removeEntry: vi.fn().mockImplementation(async (name) => {
    if (!entries.has(name)) throw new Error("NotFoundError");
    entries.delete(name);
  })
});

// Import the implementation after types are defined
import { BrowserNativeFileSystem } from "../src/BrowserNativeFileSystem";

describe("BrowserNativeFileSystem", () => {
  let fileSystem: FileSystem;
  let mockRootHandle: MockFileSystemDirectoryHandle;
  let mockFiles: Map<string, MockFileSystemHandle>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockFiles = new Map();
    mockRootHandle = createMockDirectoryHandle("root", mockFiles);
    fileSystem = new BrowserNativeFileSystem({ rootHandle: mockRootHandle });
  });

  describe("initialization", () => {
    it("should initialize successfully with granted permissions", async () => {
      // Given root handle with granted permissions
      mockRootHandle = createMockDirectoryHandle("root", mockFiles, {
        read: true,
        write: true
      });
      fileSystem = new BrowserNativeFileSystem({ rootHandle: mockRootHandle });

      // When initializing
      const initPromise = fileSystem.initialize();

      // Then it should complete without errors
      await expect(initPromise).resolves.toBeUndefined();
      expect(mockRootHandle.queryPermission).toHaveBeenCalledWith({
        mode: "readwrite"
      });
    });

    it("should fail initialization with denied permissions", async () => {
      // Given root handle with denied permissions
      mockRootHandle = createMockDirectoryHandle("root", mockFiles, {
        read: false,
        write: false
      });
      fileSystem = new BrowserNativeFileSystem({ rootHandle: mockRootHandle });

      // When initializing
      const initPromise = fileSystem.initialize();

      // Then it should throw PERMISSION_DENIED
      await expect(initPromise).rejects.toThrow(
        expect.objectContaining({
          code: "PERMISSION_DENIED"
        })
      );
    });

    it("should request permissions if in prompt state", async () => {
      // Given root handle that requires permission prompt
      mockRootHandle = createMockDirectoryHandle("root", mockFiles);
      mockRootHandle.queryPermission = vi.fn().mockResolvedValue("prompt");
      mockRootHandle.requestPermission = vi.fn().mockResolvedValue("granted");
      fileSystem = new BrowserNativeFileSystem({ rootHandle: mockRootHandle });

      // When initializing
      await fileSystem.initialize();

      // Then it should request permissions
      expect(mockRootHandle.queryPermission).toHaveBeenCalledWith({
        mode: "readwrite"
      });
      expect(mockRootHandle.requestPermission).toHaveBeenCalledWith({
        mode: "readwrite"
      });
    });
  });

  describe("file operations", () => {
    beforeEach(async () => {
      await fileSystem.initialize();
    });

    describe("reading files", () => {
      it("should read existing file content", async () => {
        // Given a file exists
        const path = "/test.txt";
        const content = "test content";
        mockFiles.set("test.txt", createMockFileHandle("test.txt", content));

        // When reading the file
        const result = await fileSystem.readFile(path);

        // Then it should return the content
        expect(result).toBe(content);
      });

      it("should throw NOT_FOUND for non-existent file", async () => {
        // Given a file does not exist
        const path = "/non-existent.txt";

        // When trying to read the file
        const readPromise = fileSystem.readFile(path);

        // Then it should throw NOT_FOUND
        await expect(readPromise).rejects.toThrow(
          expect.objectContaining({
            code: "NOT_FOUND"
          })
        );
      });
    });

    describe("writing files", () => {
      it("should write file content", async () => {
        // Given a path and content
        const path = "/test.txt";
        const content = "new content";

        // Create a mock file handle that will update its content when written to
        const mockFileHandle = createMockFileHandle("test.txt");
        const mockWritable = {
          write: vi.fn().mockImplementation(async (data: string) => {
            // Update the mock file handle's content
            mockFileHandle.getFile = vi
              .fn()
              .mockResolvedValue(createMockFile(data));
          }),
          truncate: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          seek: vi.fn().mockResolvedValue(undefined)
        };

        mockFileHandle.createWritable = vi.fn().mockResolvedValue(mockWritable);
        mockFiles.set("test.txt", mockFileHandle);

        // When writing to the file
        await fileSystem.writeFile(path, content);

        // Then the file should exist with correct content
        expect(mockWritable.truncate).toHaveBeenCalledWith(0);
        expect(mockWritable.write).toHaveBeenCalledWith(content);
        expect(mockWritable.close).toHaveBeenCalled();
        expect(await fileSystem.readFile(path)).toBe(content);
      });

      it("should throw when writing to locked file system", async () => {
        // Given a locked file system
        const path = "/test.txt";
        const content = "new content";
        await fileSystem.lock(1000, "test lock");

        // When trying to write
        const writePromise = fileSystem.writeFile(path, content);

        // Then it should throw LOCKED
        await expect(writePromise).rejects.toThrow(
          expect.objectContaining({
            code: "LOCKED"
          })
        );
      });
    });

    describe("directory operations", () => {
      it("should list directory contents", async () => {
        // Given a directory with contents
        mockFiles.set(
          "file1.txt",
          createMockFileHandle("file1.txt", "content1", Date.now())
        );
        mockFiles.set(
          "file2.txt",
          createMockFileHandle("file2.txt", "content2", Date.now())
        );

        // When listing directory contents
        const contents = await fileSystem.listDirectory("/");

        // Then it should return correct items
        expect(contents).toHaveLength(2);
        expect(contents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "/file1.txt",
              type: "file"
            }),
            expect.objectContaining({
              path: "/file2.txt",
              type: "file"
            })
          ])
        );
      });

      it("should throw NOT_FOUND when listing non-existent directory", async () => {
        // Given a directory does not exist
        const path = "/non-existent-dir";

        // When trying to list directory
        const listPromise = fileSystem.listDirectory(path);

        // Then it should throw NOT_FOUND
        await expect(listPromise).rejects.toThrow(
          expect.objectContaining({
            code: "NOT_FOUND"
          })
        );
      });
    });

    describe("metadata operations", () => {
      it("should return file metadata", async () => {
        // Given a file exists
        const path = "/meta-test.txt";
        const content = "test content";
        const lastModified = Date.now();
        mockFiles.set(
          "meta-test.txt",
          createMockFileHandle("meta-test.txt", content, lastModified)
        );

        // When getting metadata
        const meta = await fileSystem.getMetadata(path);

        // Then it should return correct metadata
        expect(meta).toEqual({
          path,
          type: "file",
          hash: expect.any(String),
          size: content.length,
          lastModified: expect.any(Number)
        });
      });

      it("should throw INVALID_OPERATION for directories", async () => {
        // Given a directory exists
        const path = "/test-dir";
        mockFiles.set("test-dir", createMockDirectoryHandle("test-dir"));

        // When getting metadata, it should throw
        await expect(fileSystem.getMetadata(path)).rejects.toThrow(
          expect.objectContaining({
            code: "INVALID_OPERATION",
            message: "Path is not a file: /test-dir"
          })
        );
      });
    });

    describe("locking", () => {
      it("should respect lock timeout", async () => {
        // Given a short lock
        await fileSystem.lock(100, "short lock");

        // When waiting for timeout
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Then system should be unlocked
        const state = fileSystem.getState();
        expect(state.lockState.isLocked).toBe(false);
      });

      it("should prevent write operations while locked", async () => {
        // Given a locked system and an existing file
        const existingContent = "existing content";
        mockFiles.set(
          "existing.txt",
          createMockFileHandle("existing.txt", existingContent)
        );
        await fileSystem.lock(1000, "test lock");

        // When attempting operations
        const writePromise = fileSystem.writeFile("/test.txt", "content");
        const deletePromise = fileSystem.deleteItem("/some-file.txt");
        const readPromise = fileSystem.readFile("/existing.txt");

        // Then write operations should fail with LOCKED
        await expect(writePromise).rejects.toThrow(
          expect.objectContaining({ code: "LOCKED" })
        );
        await expect(deletePromise).rejects.toThrow(
          expect.objectContaining({ code: "LOCKED" })
        );

        // But read operations should succeed
        await expect(readPromise).resolves.toBe(existingContent);
      });
    });
  });
});
