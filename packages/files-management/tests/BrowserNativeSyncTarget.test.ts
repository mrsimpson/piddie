import { vi } from "vitest";
import { BrowserNativeSyncTarget } from "../src/BrowserNativeSyncTarget";
import type { FileSystemDirectoryHandle } from "native-file-system-adapter";
import type { FileMetadata, FileContentStream } from "@piddie/shared-types";
import {
  createSyncTargetTests,
  type SyncTargetTestContext
} from "./suites/SyncTargetTests";
import {
  createMockDirectoryHandle,
  createMockFileHandle,
  createMockMetadata,
  createMockStream,
  setupDefaultSpyBehavior,
  type MockFileSystemContext
} from "./utils/mockFileSystem";
import { BrowserNativeFileSystem } from "../src/BrowserNativeFileSystem";

// Mock File System Access API
vi.mock("native-file-system-adapter", () => {
  return {
    showDirectoryPicker: vi.fn()
  };
});
const mockFiles = new Map<string, Partial<FileSystemHandle>>();
const mockMetadata = new Map<string, Partial<FileMetadata>>();

const context: SyncTargetTestContext<BrowserNativeSyncTarget> = {
  reset: () => mockFiles.clear(),
  createTarget: () => new BrowserNativeSyncTarget("test-target"),
  createFileSystem: () => {
    const mockRootHandle = {
      ...createMockDirectoryHandle("root", mockFiles),
      queryPermission: vi.fn().mockImplementation(async () => "granted"),
      requestPermission: vi.fn().mockImplementation(async () => "granted")
    } as unknown as FileSystemDirectoryHandle;

    // Setup directory handle behavior
    mockRootHandle.getDirectoryHandle = vi
      .fn()
      .mockImplementation(async (name, options) => {
        const existingHandle = mockFiles.get(name);
        if (existingHandle) {
          if (existingHandle.kind !== "directory") {
            throw new Error("TypeMismatchError");
          }
          return existingHandle;
        }
        if (options?.create) {
          const newHandle = createMockDirectoryHandle(name, new Map());
          mockFiles.set(name, newHandle);
          return newHandle;
        }
        throw new Error("NotFoundError");
      });

    return new BrowserNativeFileSystem({ rootHandle: mockRootHandle });
  },
  setupSpies: (fileSystem) => {
    const mockContext: MockFileSystemContext = {
      mockFiles,
      mockMetadata,
      rootDir: "/",
      timestamp: Date.now()
    };

    const spies = {
      initialize: vi.spyOn(fileSystem, "initialize"),
      readFile: vi.spyOn(fileSystem, "readFile"),
      writeFile: vi.spyOn(fileSystem, "writeFile"),
      deleteItem: vi.spyOn(fileSystem, "deleteItem"),
      exists: vi.spyOn(fileSystem, "exists"),
      lock: vi.spyOn(fileSystem, "lock"),
      unlock: vi.spyOn(fileSystem, "unlock"),
      forceUnlock: vi.spyOn(fileSystem, "forceUnlock"),
      getMetadata: vi.spyOn(fileSystem, "getMetadata"),
      listDirectory: vi.spyOn(fileSystem, "listDirectory")
    };

    setupDefaultSpyBehavior(spies, mockContext);
    return spies;
  },
  setupFileWithMetadata: async (
    spies,
    path,
    metadata: FileMetadata | null,
    content = "test content"
  ) => {
    const fileMetadata = createMockMetadata(
      path,
      content,
      metadata || undefined
    );
    const fileHandle = createMockFileHandle(
      path,
      content,
      fileMetadata.lastModified
    );
    mockFiles.set(path, fileHandle);
    mockMetadata.set(path, fileMetadata);

    return { metadata: fileMetadata };
  },
  createMockStream: (
    metadata: FileMetadata,
    content = "test content"
  ): FileContentStream => {
    return createMockStream(metadata, content);
  }
};

createSyncTargetTests(context);
