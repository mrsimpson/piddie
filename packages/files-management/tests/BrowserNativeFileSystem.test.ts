// Mock File System Access API
vi.mock("native-file-system-adapter", () => {
  return {
    // Mock the showDirectoryPicker function
    showDirectoryPicker: vi.fn()
  };
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

      it("should create a new directory", async () => {
        // Given a path for a new directory
        const path = "/new-dir";

        // When creating the directory
        await fileSystem.createDirectory(path);

        // Then verify the directory exists
        const dirHandle = await mockRootHandle.getDirectoryHandle("new-dir");
        expect(dirHandle.kind).toBe("directory");
      });

      it("should throw ALREADY_EXISTS when creating an existing directory without recursive flag", async () => {
        // Given an existing directory
        const path = "/existing-dir";
        // Create the directory first to set up the mock state
        mockFiles.set(
          "existing-dir",
          createMockDirectoryHandle("existing-dir")
        );

        // When creating the same directory again without recursive flag
        const createPromise = fileSystem.createDirectory(path);

        // Then it should throw ALREADY_EXISTS
        await expect(createPromise).rejects.toThrow(
          expect.objectContaining({
            code: "ALREADY_EXISTS"
          })
        );

        // Verify getDirectoryHandle was called only for checking existence
        expect(mockRootHandle.getDirectoryHandle).toHaveBeenCalledWith(
          "existing-dir"
        );
      });

      it("should succeed silently when creating an existing directory with recursive flag", async () => {
        // Given an existing directory
        const path = "/existing-dir";
        await fileSystem.createDirectory(path);

        // When creating the same directory again with recursive flag
        const createPromise = fileSystem.createDirectory(path, {
          recursive: true
        });

        // Then it should succeed silently
        await expect(createPromise).resolves.toBeUndefined();
      });

      it("should throw NOT_FOUND when parent directory doesn't exist without recursive flag", async () => {
        // Given a path with non-existent parent
        const path = "/non-existent-parent/new-dir";

        // When trying to create directory without recursive flag
        const createPromise = fileSystem.createDirectory(path);

        // Then it should throw NOT_FOUND
        await expect(createPromise).rejects.toThrow(
          expect.objectContaining({
            code: "NOT_FOUND"
          })
        );
      });

      it("should create parent directories when using recursive flag", async () => {
        // Given a path with non-existent parent
        const path = "/parent/child/grandchild";

        // When creating directory with recursive flag
        await fileSystem.createDirectory(path, { recursive: true });

        // Then verify all directories in the path exist
        const parentHandle = await mockRootHandle.getDirectoryHandle("parent");
        expect(parentHandle.kind).toBe("directory");

        const childHandle = await parentHandle.getDirectoryHandle("child");
        expect(childHandle.kind).toBe("directory");

        const grandchildHandle =
          await childHandle.getDirectoryHandle("grandchild");
        expect(grandchildHandle.kind).toBe("directory");
      });

      it("should delete an empty directory", async () => {
        // Given an empty directory
        const path = "/empty-dir";
        await fileSystem.createDirectory(path);

        // When deleting the directory
        await fileSystem.deleteItem(path);

        // Then verify the directory is gone
        const checkPromise = mockRootHandle.getDirectoryHandle("empty-dir");
        await expect(checkPromise).rejects.toThrow();
      });

      it("should delete a directory with contents recursively", async () => {
        // Given a directory with contents
        const path = "/dir-with-contents";
        await fileSystem.createDirectory(path);
        await fileSystem.writeFile(`${path}/file1.txt`, "content1");
        await fileSystem.createDirectory(`${path}/subdir`);
        await fileSystem.writeFile(`${path}/subdir/file2.txt`, "content2");

        // When deleting the directory
        await fileSystem.deleteItem(path);

        // Then verify the directory and its contents are gone
        const checkPromise =
          mockRootHandle.getDirectoryHandle("dir-with-contents");
        await expect(checkPromise).rejects.toThrow();
      });

      it("should throw NOT_FOUND when deleting non-existent directory", async () => {
        // Given a non-existent directory
        const path = "/non-existent-dir";

        // When trying to delete the directory
        const deletePromise = fileSystem.deleteItem(path);

        // Then it should throw NOT_FOUND
        await expect(deletePromise).rejects.toThrow(
          expect.objectContaining({
            code: "NOT_FOUND"
          })
        );
      });

      it("should throw when deleting a directory while file system is locked", async () => {
        // Given a locked file system and an existing directory
        const path = "/locked-dir";
        await fileSystem.createDirectory(path);
        await fileSystem.lock(1000, "test lock");

        // When trying to delete the directory
        const deletePromise = fileSystem.deleteItem(path);

        // Then it should throw LOCKED
        await expect(deletePromise).rejects.toThrow(
          expect.objectContaining({
            code: "LOCKED"
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

      it("should return directory metadata", async () => {
        // Given a directory exists
        const path = "/test-dir";
        mockFiles.set("test-dir", createMockDirectoryHandle("test-dir"));

        // When getting metadata
        const meta = await fileSystem.getMetadata(path);

        // Then it should return correct directory metadata
        expect(meta).toEqual({
          path,
          type: "directory",
          hash: "", // Directories don't have a hash
          size: 0, // Directories don't have a size
          lastModified: expect.any(Number)
        });
      });
    });

    describe("locking", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("should respect lock timeout", async () => {
        // Given a short lock
        await fileSystem.lock(100, "short lock");

        // When waiting for timeout
        vi.advanceTimersByTime(150);
        await Promise.resolve(); // Flush promises

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
