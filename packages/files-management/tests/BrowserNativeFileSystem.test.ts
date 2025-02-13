import { describe, it, expect, beforeEach, Mock } from "vitest";
import type { WritableStream } from "node:stream/web";
import {
  createFileSystemTests,
  type FileSystemTestContext
} from "./suites/createFileSystemTests";
import { BrowserNativeFileSystem } from "../src/BrowserNativeFileSystem";
import { showDirectoryPicker } from "native-file-system-adapter";

// Mock File System Access API
vi.mock("native-file-system-adapter", () => {
  return {
    showDirectoryPicker: vi.fn()
  };
});

// Shared mock state
const mockState = {
  files: new Map<string, MockFileSystemFileHandle>(),
  directories: new Map<string, MockFileSystemDirectoryHandle>(),
  reset: () => {
    mockState.files.clear();
    mockState.directories.clear();
  }
};

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
  path: string;
  content?: string;
  lastModified?: number;
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
  name: string;
  path: string;
  queryPermission: Mock<
    (desc: { mode: "read" | "readwrite" }) => Promise<PermissionState>
  >;
  requestPermission: Mock<
    (desc: { mode: "read" | "readwrite" }) => Promise<PermissionState>
  >;
  entries: Mock<() => AsyncIterableIterator<[string, MockFileSystemHandle]>>;
  getDirectoryHandle: Mock<
    (
      name: string,
      options?: { create?: boolean }
    ) => Promise<MockFileSystemDirectoryHandle>
  >;
  getFileHandle: Mock<
    (
      name: string,
      options?: { create?: boolean }
    ) => Promise<MockFileSystemFileHandle>
  >;
  removeEntry: Mock<
    (name: string, options?: { recursive?: boolean }) => Promise<void>
  >;
  getEntries: Mock<() => AsyncIterableIterator<[string, MockFileSystemHandle]>>;
  keys: Mock<() => AsyncIterableIterator<string>>;
  values: Mock<() => AsyncIterableIterator<MockFileSystemHandle>>;
  resolve: Mock<
    (possibleDescendant: MockFileSystemHandle) => Promise<string[]>
  >;
  [Symbol.asyncIterator]: Mock<
    () => AsyncIterableIterator<[string, MockFileSystemHandle]>
  >;
  isSameEntry: Mock<(other: MockFileSystemHandle) => Promise<boolean>>;
}

const createMockWritableStream = (path: string) => {
  // Create file handle if it doesn't exist
  if (!mockState.files.has(path)) {
    createMockFileHandle(path);
  }

  return {
    write: vi.fn().mockImplementation(async (data: string) => {
      const handle = mockState.files.get(path);
      if (handle?.kind === "file") {
        handle.content = data;
      }
    }),
    close: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    truncate: vi.fn().mockResolvedValue(undefined),
    locked: false,
    abort: vi.fn().mockResolvedValue(undefined),
    getWriter: vi.fn().mockImplementation(() => {
      throw new Error("getWriter not implemented in mock");
    })
  } as FileSystemWritableFileStream;
};

const createMockFileHandle = (
  path: string,
  content: string = "",
  lastModified: number = Date.now(),
  permissions: { read?: boolean; write?: boolean } = { read: true, write: true }
): MockFileSystemFileHandle => {
  const name = path.split("/").pop() || "";
  const handle: MockFileSystemFileHandle = {
    kind: "file",
    name,
    path,
    content,
    lastModified,
    queryPermission: vi.fn().mockImplementation(async ({ mode }) => {
      if (mode === "read") return permissions.read ? "granted" : "denied";
      return permissions.write ? "granted" : "denied";
    }),
    requestPermission: vi.fn().mockImplementation(async ({ mode }) => {
      if (mode === "read") return permissions.read ? "granted" : "denied";
      return permissions.write ? "granted" : "denied";
    }),
    getFile: vi.fn().mockImplementation(async () => {
      return new File([handle.content ?? ""], handle.name, {
        lastModified: handle.lastModified!
      });
    }),
    createWritable: vi
      .fn()
      .mockImplementation(async () => createMockWritableStream(path))
  };
  mockState.files.set(path, handle);
  return handle;
};

const createMockDirectoryHandle = (
  path: string,
  permissions: { read?: boolean; write?: boolean } = { read: true, write: true }
): MockFileSystemDirectoryHandle => {
  const name = path.split("/").pop() || "";
  const handle: MockFileSystemDirectoryHandle = {
    kind: "directory",
    name,
    path,
    queryPermission: vi.fn().mockImplementation(async ({ mode }) => {
      if (mode === "read") return permissions.read ? "granted" : "denied";
      return permissions.write ? "granted" : "denied";
    }),
    requestPermission: vi.fn().mockImplementation(async ({ mode }) => {
      if (mode === "read") return permissions.read ? "granted" : "denied";
      return permissions.write ? "granted" : "denied";
    }),
    entries: vi.fn().mockImplementation(async function* () {
      // Check read permission first – just like the browser does
      if (!permissions.read) {
        throw new Error("Permission denied");
      }

      const normalizedPath = path.endsWith("/") ? path : path + "/";

      // Only yield direct children, not all descendants
      for (const [childPath, handle] of mockState.files.entries()) {
        if (childPath.startsWith(normalizedPath)) {
          // Get the relative path after our directory
          const relativePath = childPath.slice(normalizedPath.length);
          // Only include direct children (no slashes in relative path)
          if (!relativePath.includes("/")) {
            yield [handle.name, handle];
          }
        }
      }
      for (const [childPath, handle] of mockState.directories.entries()) {
        if (childPath.startsWith(normalizedPath)) {
          // Get the relative path after our directory
          const relativePath = childPath.slice(normalizedPath.length);
          // Only include direct children (no slashes in relative path)
          if (!relativePath.includes("/")) {
            yield [handle.name, handle];
          }
        }
      }
    }),
    getDirectoryHandle: vi
      .fn()
      .mockImplementation(async (name, { create = false } = {}) => {
        const childPath = path.endsWith("/")
          ? `${path}${name}`
          : `${path}/${name}`;
        const existing = mockState.directories.get(childPath);
        if (existing) return existing;
        if (!create) throw new Error("NotFoundError");
        return ensureDirectory(childPath);
      }),
    getFileHandle: vi
      .fn()
      .mockImplementation(async (name, { create = false } = {}) => {
        const childPath = path.endsWith("/")
          ? `${path}${name}`
          : `${path}/${name}`;
        const existing = mockState.files.get(childPath);
        if (existing) return existing;
        if (!create) throw new Error("NotFoundError");
        return mockFileInDirectory(childPath);
      }),
    removeEntry: vi
      .fn()
      .mockImplementation(async (name, { recursive = false } = {}) => {
        const childPath = `${path}${name}`;
        if (recursive) {
          // Remove all children that start with this path
          for (const [path] of mockState.files.entries()) {
            if (path.startsWith(childPath)) {
              mockState.files.delete(path);
            }
          }
          for (const [path] of mockState.directories.entries()) {
            if (path.startsWith(childPath)) {
              mockState.directories.delete(path);
            }
          }
        } else {
          mockState.files.delete(childPath);
          mockState.directories.delete(childPath);
        }
      }),
    getEntries: vi.fn().mockImplementation(async function* () {
      for (const [childPath, handle] of mockState.files.entries()) {
        if (childPath.startsWith(path) && childPath !== path) {
          yield [handle.name, handle];
        }
      }
      for (const [childPath, handle] of mockState.directories.entries()) {
        if (childPath.startsWith(path) && childPath !== path) {
          yield [handle.name, handle];
        }
      }
    }),
    keys: vi.fn().mockImplementation(async function* () {
      for (const [childPath, handle] of mockState.files.entries()) {
        if (childPath.startsWith(path) && childPath !== path) {
          yield handle.name;
        }
      }
      for (const [childPath, handle] of mockState.directories.entries()) {
        if (childPath.startsWith(path) && childPath !== path) {
          yield handle.name;
        }
      }
    }),
    values: vi.fn().mockImplementation(async function* () {
      for (const [childPath, handle] of mockState.files.entries()) {
        if (childPath.startsWith(path) && childPath !== path) {
          yield handle;
        }
      }
      for (const [childPath, handle] of mockState.directories.entries()) {
        if (childPath.startsWith(path) && childPath !== path) {
          yield handle;
        }
      }
    }),
    resolve: vi.fn().mockImplementation(async (possibleDescendant) => {
      const pathParts = possibleDescendant.path.split("/");
      const directoryPath = pathParts.slice(0, pathParts.length - 1).join("/");
      const directoryHandle = mockState.directories.get(directoryPath);
      if (directoryHandle) {
        return [directoryHandle.name];
      }
      return [];
    }),
    [Symbol.asyncIterator]: vi.fn().mockImplementation(async function* () {
      for (const [childPath, handle] of mockState.files.entries()) {
        if (childPath.startsWith(path) && childPath !== path) {
          yield [handle.name, handle];
        }
      }
      for (const [childPath, handle] of mockState.directories.entries()) {
        if (childPath.startsWith(path) && childPath !== path) {
          yield [handle.name, handle];
        }
      }
    }),
    isSameEntry: vi.fn().mockImplementation(async (other) => {
      return other.path === path;
    })
  };
  return handle;
};

// Helper functions for mocking files and directories
const ensureDirectory = (path: string): MockFileSystemDirectoryHandle => {
  const existingHandle = mockState.directories.get(path);
  if (existingHandle) {
    return existingHandle;
  }

  const handle = createMockDirectoryHandle(path);
  if (path !== "/") {
    const parentPath = path.substring(0, path.lastIndexOf("/")) || "/";
    ensureDirectory(parentPath);
  }
  mockState.directories.set(path, handle);
  return handle;
};

const mockFileInDirectory = (filePath: string, content: string = "") => {
  // Ensure parent directory exists
  const parentPath = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
  ensureDirectory(parentPath);

  // Create or update file
  const existingHandle = mockState.files.get(filePath);
  if (existingHandle) {
    existingHandle.content = content;
    return existingHandle;
  }

  const handle = createMockFileHandle(filePath, content);
  mockState.files.set(filePath, handle);
  return handle;
};

// Create the shared test context
const createTestContext = async (): Promise<FileSystemTestContext> => {
  mockState.reset();
  const mockRootHandle = createMockDirectoryHandle("/");
  (showDirectoryPicker as any).mockResolvedValue(mockRootHandle);

  const fileSystem = new BrowserNativeFileSystem({
    rootHandle: mockRootHandle
  });
  await fileSystem.initialize();

  return {
    fileSystem,
    mockFileExists: (path: string, content: string = "") => {
      mockFileInDirectory(path, content);
    },
    mockDirectoryExists: (path: string) => {
      ensureDirectory(path);
    },
    verifyWriteFile: (path: string, content: string) => {
      const file = mockState.files.get(path);
      expect(file?.kind).toBe("file");
      if (file?.kind === "file") {
        expect(file.content).toBe(content);
      }
    },
    verifyRmdir: (path: string) => {
      expect(mockState.directories.has(path)).toBe(false);
    },
    verifyUnlink: (path: string) => {
      expect(mockState.files.has(path)).toBe(false);
    }
  };
};

// Run the shared tests
createFileSystemTests("BrowserNativeFileSystem", createTestContext);

// Add BrowserNativeFileSystem-specific tests
describe("BrowserNativeFileSystem specific", () => {
  beforeEach(() => {
    mockState.reset();
  });

  it("should handle permission denied", async () => {
    const mockRootHandle = createMockDirectoryHandle("/", { read: false });
    (showDirectoryPicker as any).mockRejectedValue(
      new Error("Permission denied")
    );

    const fileSystem = new BrowserNativeFileSystem({
      rootHandle: mockRootHandle
    });
    await expect(fileSystem.initialize()).rejects.toThrow("Permission denied");
  });
});
