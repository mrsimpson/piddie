import { vi } from "vitest";
import { WebContainerFileSystem } from "../src/WebContainerFileSystem";
import {
  createFileSystemTests,
  FileSystemTestContext
} from "./suites/createFileSystemTests";

// Mock WebContainer instance
const createMockWebContainerInstance = () => {
  const files = new Map<string, string>();
  const directories = new Set<string>(["/"]); // Initialize with root directory

  return {
    fs: {
      readFile: vi.fn(async (path: string) => {
        if (files.has(path)) {
          return files.get(path)!;
        }
        throw new Error("File not found");
      }),
      readdir: vi.fn(async (path: string) => {
        if (!directories.has(path)) {
          throw new Error("Directory not found");
        }

        // Normalize path to handle root directory
        const normalizedPath = path === "/" ? "" : path;

        // Get immediate children only
        const children = new Set<string>();

        // Add files
        for (const filePath of files.keys()) {
          if (filePath.startsWith(normalizedPath + "/")) {
            const relativePath = filePath.slice(normalizedPath.length + 1);
            const firstSegment = relativePath.split("/")[0];
            if (firstSegment) {
              children.add(firstSegment);
            }
          }
        }

        // Add directories
        for (const dirPath of directories) {
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
        if (files.has(path)) {
          files.delete(path);
        } else if (directories.has(path)) {
          // Check if directory is empty
          const hasChildren =
            Array.from(files.keys()).some((filePath) =>
              filePath.startsWith(path + "/")
            ) ||
            Array.from(directories).some(
              (dirPath) => dirPath !== path && dirPath.startsWith(path + "/")
            );

          if (hasChildren) {
            throw new Error("Directory not empty");
          }
          directories.delete(path);
        } else {
          throw new Error("Path not found");
        }
      }),
      writeFile: vi.fn(async (path: string, contents: string) => {
        // Ensure parent directory exists
        const parentPath = path.split("/").slice(0, -1).join("/") || "/";
        if (!directories.has(parentPath)) {
          throw new Error("Parent directory not found");
        }
        files.set(path, contents);
      }),
      mkdir: vi.fn(async (path: string) => {
        if (directories.has(path)) {
          throw new Error("Directory already exists");
        }
        // Ensure parent directory exists for non-root paths
        if (path !== "/") {
          const parentPath = path.split("/").slice(0, -1).join("/") || "/";
          if (!directories.has(parentPath)) {
            throw new Error("Parent directory not found");
          }
        }
        directories.add(path);
      })
    },
    _internal: { files, directories } // For test verification
  };
};

createFileSystemTests("WebContainerFileSystem", async () => {
  const mockWebContainerInstance = createMockWebContainerInstance();
  const fileSystem = new WebContainerFileSystem(mockWebContainerInstance);

  const context: FileSystemTestContext = {
    fileSystem,

    mockFileExists: (path: string, content: string = "") => {
      mockWebContainerInstance._internal.files.set(path, content);
    },

    mockDirectoryExists: (path: string) => {
      mockWebContainerInstance._internal.directories.add(path);
    },

    verifyWriteFile: (path: string, content: string) => {
      expect(mockWebContainerInstance.fs.writeFile).toHaveBeenCalledWith(
        path,
        content
      );
    },

    verifyRmdir: (path: string) => {
      expect(mockWebContainerInstance.fs.rm).toHaveBeenCalledWith(path);
    },

    verifyUnlink: (path: string) => {
      expect(mockWebContainerInstance.fs.rm).toHaveBeenCalledWith(path);
    }
  };

  return context;
});
