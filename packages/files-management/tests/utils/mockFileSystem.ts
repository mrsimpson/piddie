import type {
  FileMetadata,
  FileContentStream,
  FileSystemItem
} from "@piddie/shared-types";
import { ReadableStream } from "node:stream/web";
import { MockInstance, vi } from "vitest";

export interface MockFileSystemContext {
  mockFiles: Map<string, Partial<FileSystemHandle>>;
  mockMetadata: Map<string, Partial<FileMetadata>>;
  rootDir: string;
  timestamp?: number;
}

export function createMockMetadata(
  path: string,
  content: string = "test content",
  overrides: Partial<FileMetadata> = {}
): FileMetadata {
  const timestamp = overrides.lastModified ?? Date.now();
  return {
    path,
    type: "file",
    hash: overrides.hash ?? "testhash",
    size: overrides.size ?? content.length,
    lastModified: timestamp,
    ...overrides
  };
}

export function createMockStream(
  metadata: FileMetadata,
  content: string = "test content"
): FileContentStream {
  return {
    metadata,
    getReader: () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            content,
            chunkIndex: 0,
            totalChunks: 1,
            chunkHash: metadata.hash
          });
          controller.close();
        }
      });
      return stream.getReader();
    },
    close: vi.fn().mockResolvedValue(undefined)
  };
}

export function setupDefaultSpyBehavior(
  spies: {
    initialize: MockInstance<() => Promise<void>>;
    readFile: MockInstance<(path: string) => Promise<string>>;
    writeFile: MockInstance<(path: string, content: string) => Promise<void>>;
    deleteItem: MockInstance<(path: string) => Promise<void>>;
    exists: MockInstance<(path: string) => Promise<boolean>>;
    lock: MockInstance<(path: string, mode: LockMode) => Promise<void>>;
    forceUnlock: MockInstance<(path: string) => Promise<void>>;
    listDirectory: MockInstance<(path: string) => Promise<FileSystemItem[]>>;
    getMetadata: MockInstance<(path: string) => Promise<FileMetadata>>;
  },
  context: MockFileSystemContext
) {
  // Setup default mock implementations
  spies.initialize.mockImplementation(async () => {
    return undefined;
  });

  spies.readFile.mockResolvedValue("test content");
  spies.writeFile.mockResolvedValue(undefined);
  spies.deleteItem.mockResolvedValue(undefined);
  spies.exists.mockImplementation(async (path: string) => {
    if (path === context.rootDir || path === "/") return true;
    return context.mockFiles.has(path);
  });
  spies.lock.mockResolvedValue(undefined);
  spies.forceUnlock.mockResolvedValue(undefined);
  spies.listDirectory.mockImplementation(async (path: string) => {
    if (path === context.rootDir || path === "/") {
      // Convert the mockFiles map entries to FileMetadata array
      return Array.from(context.mockFiles.entries()).map(
        ([filePath, handle]) => {
          if (handle.kind === "file") {
            return context.mockMetadata.get(filePath);
          }
          return {
            path: filePath,
            type: "directory" as const,
            hash: "",
            size: 0,
            lastModified: context.timestamp ?? Date.now()
          };
        }
      );
    }
    return [];
  });
  spies.getMetadata.mockImplementation((path: string) => {
    const file = context.mockFiles.get(path);
    const metadata = context.mockMetadata.get(path);
    if (!file) throw new Error("File not found");

    return metadata;
  });
}

// File System Access API specific mocks
export function createMockFileHandle(
  name: string,
  content: string = "test content",
  lastModified: number = Date.now()
) {
  return {
    kind: "file" as const,
    name,
    getFile: vi
      .fn()
      .mockResolvedValue(new File([content], name, { lastModified })),
    createWritable: vi.fn(),
    queryPermission: vi.fn().mockResolvedValue("granted"),
    requestPermission: vi.fn().mockResolvedValue("granted")
  };
}

export function createMockDirectoryHandle(
  name: string,
  entries = new Map()
): FileSystemDirectoryHandle {
  return {
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
    resolve: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
    [Symbol.asyncIterator]: vi.fn(),
    isSameEntry: vi.fn()
  };
}

// Lightning FS specific mocks
export function createLightningFSMocks() {
  return {
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
}
