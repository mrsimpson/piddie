import { vi } from "vitest";
import { BrowserSyncTarget } from "../src/BrowserSyncTarget";
import { BrowserFileSystem } from "../src/BrowserFileSystem";
import type { FileMetadata, FileContentStream } from "@piddie/shared-types";
import {
  createSyncTargetTests,
  type SyncTargetTestContext
} from "./suites/createSyncTargetTests";
import {
  createLightningFSMocks,
  createMockFileHandle,
  createMockMetadata,
  createMockStream,
  setupDefaultSpyBehavior,
  type MockFileSystemContext
} from "./utils/mockFileSystem";

const mockPromises = createLightningFSMocks();

vi.mock("@isomorphic-git/lightning-fs", () => {
  class MockFS {
    promises = mockPromises;
    constructor() {}
  }
  return { default: MockFS };
});

const TEST_ROOT = "/test/root";
const mockFiles = new Map<string, FileSystemHandle>();
const mockMetadata = new Map<string, FileMetadata>();

const context: SyncTargetTestContext<BrowserSyncTarget> = {
  reset: () => mockFiles.clear(),
  createTarget: () => new BrowserSyncTarget("test-target"),
  createFileSystem: () => {
    mockPromises.stat.mockImplementation((filePath: string) => {
      if (filePath === TEST_ROOT) {
        return Promise.resolve({
          isDirectory: () => true,
          isFile: () => false,
          mtimeMs: Date.now()
        });
      }
      return Promise.resolve({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: Date.now()
      });
    });

    return new BrowserFileSystem({ name: "test", rootDir: TEST_ROOT });
  },
  setupSpies: (fileSystem) => {
    const mockContext: MockFileSystemContext = {
      mockFiles,
      mockMetadata,
      rootDir: TEST_ROOT,
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
