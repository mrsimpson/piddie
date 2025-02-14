import { vi } from "vitest";
import { WebContainerSyncTarget } from "../src/WebContainerSyncTarget";
import { WebContainerFileSystem } from "../src/WebContainerFileSystem";
import type {
  FileSystem,
  FileMetadata,
  FileContentStream
} from "@piddie/shared-types";
import type { WebContainer } from "@webcontainer/api";
import { createSyncTargetTests } from "./suites/createSyncTargetTests";

// Mock state for WebContainer
const mockFiles = new Map<
  string,
  { content: string; lastModified: number; hash: string; size: number }
>();
const mockDirectories = new Set<string>(["/"]); // Initialize with root directory
let mockTimestamp = Date.now();

const calculateHash = async (content: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const createMockWebContainer = () =>
  ({
    fs: {
      readFile: vi.fn(async (path: string) => {
        if (mockFiles.has(path)) {
          return mockFiles.get(path)!.content;
        }
        throw new Error("File not found");
      }),
      readdir: vi.fn(async (path: string) => {
        if (!mockDirectories.has(path)) {
          throw new Error("Directory not found");
        }

        // Normalize path to handle root directory
        const normalizedPath = path === "/" ? "" : path;

        // Get immediate children only
        const children = new Set<string>();

        // Add files
        for (const filePath of mockFiles.keys()) {
          if (filePath.startsWith(normalizedPath + "/")) {
            const relativePath = filePath.slice(normalizedPath.length + 1);
            const firstSegment = relativePath.split("/")[0];
            if (firstSegment) {
              children.add(firstSegment);
            }
          }
        }

        // Add directories
        for (const dirPath of mockDirectories) {
          if (dirPath !== "/" && dirPath.startsWith(normalizedPath + "/")) {
            const relativePath = dirPath.slice(normalizedPath.length + 1);
            const firstSegment = relativePath.split("/")[0];
            if (firstSegment) {
              children.add(firstSegment);
            }
          }
        }

        return Array.from(children);
      }),
      rm: vi.fn(async (path: string) => {
        if (mockFiles.has(path)) {
          mockFiles.delete(path);
        } else if (mockDirectories.has(path)) {
          // Check if directory is empty
          const hasChildren =
            Array.from(mockFiles.keys()).some((filePath) =>
              filePath.startsWith(path + "/")
            ) ||
            Array.from(mockDirectories).some(
              (dirPath) => dirPath !== path && dirPath.startsWith(path + "/")
            );

          if (hasChildren) {
            throw new Error("Directory not empty");
          }
          mockDirectories.delete(path);
        } else {
          throw new Error("Path not found");
        }
      }),
      writeFile: vi.fn(async (path: string, contents: string) => {
        // Ensure parent directory exists
        const parentPath = path.split("/").slice(0, -1).join("/") || "/";
        if (!mockDirectories.has(parentPath)) {
          throw new Error("Parent directory not found");
        }
        const hash = await calculateHash(contents);
        mockFiles.set(path, {
          content: contents,
          lastModified: mockTimestamp,
          hash,
          size: contents.length
        });
      }),
      mkdir: vi.fn(async (path: string) => {
        if (mockDirectories.has(path)) {
          throw new Error("Directory already exists");
        }
        // Ensure parent directory exists for non-root paths
        if (path !== "/") {
          const parentPath = path.split("/").slice(0, -1).join("/") || "/";
          if (!mockDirectories.has(parentPath)) {
            throw new Error("Parent directory not found");
          }
        }
        mockDirectories.add(path);
      })
    },
    // Mock other required WebContainer methods that we don't use
    spawn: vi.fn(),
    on: vi.fn(),
    mount: vi.fn(),
    unmount: vi.fn(),
    teardown: vi.fn(),
    // Internal properties required by the interface
    _unsubscribeFromTokenChangedListener: vi.fn(),
    _tornDown: false as const,
    internal: {} as any
  }) as unknown as WebContainer;

// Create the test context for WebContainerSyncTarget
createSyncTargetTests({
  createTarget: () => new WebContainerSyncTarget("test-target"),
  createFileSystem: () => {
    return new WebContainerFileSystem(createMockWebContainer());
  },
  setupSpies: (fs: FileSystem) => {
    const fileSystem = fs as WebContainerFileSystem;
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

    // After initialization is complete, clear the listDirectory call count
    spies.initialize.mockImplementation(async () => {
      console.log("[TEST] Initializing filesystem");
      await fileSystem.initialize();
      spies.listDirectory.mockClear();
    });

    return spies;
  },
  setupFileWithMetadata: async (spies, path, metadata, content = "") => {
    console.log("[TEST] Setting up file:", path, "with content:", content);
    // Create parent directories if they don't exist
    const parentPath = path.split("/").slice(0, -1).join("/") || "/";
    if (!mockDirectories.has(parentPath)) {
      const parts = parentPath.split("/").filter(Boolean);
      let currentPath = "";
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
        if (!mockDirectories.has(currentPath)) {
          mockDirectories.add(currentPath);
          console.log("[TEST] Created directory:", currentPath);
        }
      }
    }

    if (metadata?.type === "directory") {
      mockDirectories.add(path);
      console.log("[TEST] Added directory:", path);
    } else {
      const hash = await calculateHash(content);
      mockFiles.set(path, {
        content,
        lastModified: metadata?.lastModified ?? mockTimestamp,
        hash: metadata?.hash ?? hash,
        size: metadata?.size ?? content.length
      });
      console.log("[TEST] Added file:", path, "with hash:", hash);
    }

    // Update spy implementations to reflect the current state
    spies.exists.mockImplementation(async (p) => {
      const exists = mockFiles.has(p) || mockDirectories.has(p);
      console.log("[TEST] Checking exists:", p, exists);
      return exists;
    });

    spies.getMetadata.mockImplementation(async (p) => {
      console.log("[TEST] Getting metadata for:", p);
      if (mockFiles.has(p)) {
        const fileInfo = mockFiles.get(p)!;
        return {
          path: p,
          type: "file",
          lastModified: fileInfo.lastModified,
          hash: fileInfo.hash,
          size: fileInfo.size
        };
      } else if (mockDirectories.has(p)) {
        return {
          path: p,
          type: "directory",
          lastModified: metadata?.lastModified ?? mockTimestamp,
          hash: "",
          size: 0
        };
      }
      throw new Error("Path not found");
    });

    spies.readFile.mockImplementation(async (p) => {
      console.log("[TEST] Reading file:", p);
      if (mockFiles.has(p)) {
        return mockFiles.get(p)!.content;
      }
      throw new Error("File not found");
    });

    spies.listDirectory.mockImplementation(async (p) => {
      console.log("[TEST] Listing directory:", p);
      const items: any[] = [];
      if (mockDirectories.has(p)) {
        const normalizedPath = p === "/" ? "" : p;
        // Add files
        for (const [filePath, fileInfo] of mockFiles.entries()) {
          // For root directory, include files in root
          if (p === "/" && !filePath.slice(1).includes("/")) {
            items.push({
              path: filePath,
              type: "file",
              lastModified: fileInfo.lastModified,
              hash: fileInfo.hash,
              size: fileInfo.size
            });
          } else if (filePath.startsWith(normalizedPath + "/")) {
            const relativePath = filePath.slice(normalizedPath.length + 1);
            if (!relativePath.includes("/")) {
              items.push({
                path: filePath,
                type: "file",
                lastModified: fileInfo.lastModified,
                hash: fileInfo.hash,
                size: fileInfo.size
              });
            }
          }
        }
        // Add directories
        for (const dirPath of mockDirectories) {
          // For root directory, include directories in root
          if (p === "/" && !dirPath.slice(1).includes("/") && dirPath !== "/") {
            items.push({
              path: dirPath,
              type: "directory",
              lastModified: mockTimestamp
            });
          } else if (
            dirPath !== "/" &&
            dirPath.startsWith(normalizedPath + "/")
          ) {
            const relativePath = dirPath.slice(normalizedPath.length + 1);
            if (!relativePath.includes("/")) {
              items.push({
                path: dirPath,
                type: "directory",
                lastModified: mockTimestamp
              });
            }
          }
        }
      }
      console.log("[TEST] Directory contents:", items);
      return items;
    });

    // Implement write and delete operations to properly update state
    spies.writeFile.mockImplementation(async (p, c) => {
      console.log("[TEST] Writing file:", p);
      const hash = await calculateHash(c);
      mockFiles.set(p, {
        content: c,
        lastModified: mockTimestamp,
        hash,
        size: c.length
      });
      console.log("[TEST] File written with hash:", hash);
    });

    spies.deleteItem.mockImplementation(async (p) => {
      console.log("[TEST] Deleting item:", p);
      if (mockFiles.has(p)) {
        mockFiles.delete(p);
        console.log("[TEST] Deleted file:", p);
      } else if (mockDirectories.has(p)) {
        mockDirectories.delete(p);
        console.log("[TEST] Deleted directory:", p);
      } else {
        throw new Error("Path not found");
      }
    });

    return { metadata: metadata! };
  },
  createMockStream: (
    metadata: FileMetadata,
    content: string = "test content"
  ) => {
    console.log("[TEST] Creating mock stream for:", metadata.path);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(content));
        controller.close();
      }
    });

    return {
      metadata,
      stream,
      getReader: () => stream.getReader()
    } as FileContentStream;
  },
  reset: () => {
    console.log("[TEST] Resetting test state");
    vi.clearAllMocks();
    mockFiles.clear();
    mockDirectories.clear();
    mockDirectories.add("/"); // Reset with root directory
    mockTimestamp = Date.now(); // Reset timestamp

    // Set up vi.advanceTimersByTime to update our mockTimestamp
    vi.spyOn(global.Date, "now").mockImplementation(() => mockTimestamp);
    const originalAdvanceTimersByTime = vi.advanceTimersByTime;
    vi.advanceTimersByTime = (ms: number) => {
      mockTimestamp += ms;
      console.log("[TEST] Advancing time by:", ms, "ms");
      return originalAdvanceTimersByTime(ms);
    };
  }
});
