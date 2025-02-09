import { expect, vi } from "vitest";
import { createFileSystemTests, type FileSystemTestContext } from "./suites/createFileSystemTests";
import { BrowserFileSystem } from "../src/BrowserFileSystem";
import FS from "@isomorphic-git/lightning-fs";

// Mock lightning-fs
vi.mock("@isomorphic-git/lightning-fs", () => {
  return {
    default: vi.fn()
  };
});

// Shared mock state
const mockState = {
  files: new Map<string, MockFileStats>(),
  reset: () => {
    mockState.files.clear();
  }
};

// Mock types
interface MockFileStats {
  content: string;
  isDirectory: boolean;
  mtimeMs: number;
  size: number;
}

// Mock implementations
class MockFS {
  promises = {
    mkdir: vi.fn(async (path: string) => {
      mockState.files.set(path, {
        content: "",
        isDirectory: true,
        mtimeMs: Date.now(),
        size: 0
      });
    }),
    readdir: vi.fn(async (path: string) => {
      const entries: string[] = [];
      for (const [filePath] of mockState.files) {
        if (filePath.startsWith(path) && filePath !== path) {
          const relativePath = filePath.startsWith(path + "/")
            ? filePath.slice(path.length + 1)
            : filePath.slice(path.length);
          if (!relativePath.includes("/")) {
            entries.push(relativePath);
          }
        }
      }
      return entries;
    }),
    stat: vi.fn(async (path: string) => {
      const stats = mockState.files.get(path);
      if (!stats) {
        const error = new Error("ENOENT: no such file or directory");
        error.message = "ENOENT";
        throw error;
      }
      return {
        isDirectory: () => stats.isDirectory,
        isFile: () => !stats.isDirectory,
        mtimeMs: stats.mtimeMs,
        size: stats.size
      };
    }),
    readFile: vi.fn(async (path: string) => {
      const file = mockState.files.get(path);
      if (!file || file.isDirectory) {
        const error = new Error("ENOENT: no such file or directory");
        error.message = "ENOENT";
        throw error;
      }
      return file.content;
    }),
    writeFile: vi.fn(async (path: string, data: string) => {
      mockState.files.set(path, {
        content: data,
        isDirectory: false,
        mtimeMs: Date.now(),
        size: data.length
      });
    }),
    unlink: vi.fn(async (path: string) => {
      if (!mockState.files.has(path)) {
        const error = new Error("ENOENT: no such file or directory");
        error.message = "ENOENT";
        throw error;
      }
      mockState.files.delete(path);
    }),
    rmdir: vi.fn(async (path: string) => {
      if (!mockState.files.has(path)) {
        const error = new Error("ENOENT: no such file or directory");
        error.message = "ENOENT";
        throw error;
      }
      mockState.files.delete(path);
    })
  };

  constructor() {
    return this;
  }
}

// Mock the FS constructor
const mockFsConstructor = vi.fn().mockImplementation(() => new MockFS());
vi.mocked(FS).mockImplementation(mockFsConstructor);

// Create the shared test context
const createTestContext = async (): Promise<FileSystemTestContext> => {
  mockState.reset();

  // Ensure root directory exists in mock state
  mockState.files.set("/", {
    content: "",
    isDirectory: true,
    mtimeMs: Date.now(),
    size: 0
  });

  const fileSystem = new BrowserFileSystem({
    name: "test-fs",
    rootDir: "/"
  });

  return {
    fileSystem,
    mockFileExists: (path: string, content: string = "") => {
      // Ensure parent directory exists
      const parentPath = path.split("/").slice(0, -1).join("/") || "/";
      if (!mockState.files.has(parentPath)) {
        mockState.files.set(parentPath, {
          content: "",
          isDirectory: true,
          mtimeMs: Date.now(),
          size: 0
        });
      }

      mockState.files.set(path, {
        content,
        isDirectory: false,
        mtimeMs: Date.now(),
        size: content.length
      });
    },
    mockDirectoryExists: (path: string) => {
      // Ensure parent directory exists
      const parentPath = path.split("/").slice(0, -1).join("/") || "/";
      if (!mockState.files.has(parentPath)) {
        mockState.files.set(parentPath, {
          content: "",
          isDirectory: true,
          mtimeMs: Date.now(),
          size: 0
        });
      }

      mockState.files.set(path, {
        content: "",
        isDirectory: true,
        mtimeMs: Date.now(),
        size: 0
      });
    },
    verifyWriteFile: (path: string, content: string) => {
      const file = mockState.files.get(path);
      expect(file).toBeDefined();
      expect(file?.content).toBe(content);
      expect(file?.isDirectory).toBe(false);
    },
    verifyRmdir: (path: string) => {
      expect(mockState.files.has(path)).toBe(false);
    },
    verifyUnlink: (path: string) => {
      expect(mockState.files.has(path)).toBe(false);
    }
  };
};

// Run the shared tests
createFileSystemTests("BrowserFileSystem", createTestContext);
