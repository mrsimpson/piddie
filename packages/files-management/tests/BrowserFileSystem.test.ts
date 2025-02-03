vi.mock("@isomorphic-git/lightning-fs", () => {
  const mockFs = {
    promises: {
      mkdir: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rmdir: vi.fn(),
      unlink: vi.fn()
    }
  };

  return {
    default: vi.fn(() => mockFs)
  };
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FileSystem } from "@piddie/shared-types";
import { BrowserFileSystem } from "../src/BrowserFileSystem";
import FS from "@isomorphic-git/lightning-fs";
import type { Stats as LightningStats } from "@isomorphic-git/lightning-fs";

// Get the mocked fs instance
const fsInstance = new FS("test");
const mockFs = fsInstance.promises;

// Create spies for each method
const mkdirSpy = vi.spyOn(mockFs, "mkdir");
const readdirSpy = vi.spyOn(mockFs, "readdir");
const statSpy = vi.spyOn(mockFs, "stat");
const readFileSpy = vi.spyOn(mockFs, "readFile");
const writeFileSpy = vi.spyOn(mockFs, "writeFile");

const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

const ROOT_DIR = "./unit-test";

// Create a helper for Stats objects
const createStatsMock = (
  options: { isDirectory?: boolean; size?: number } = {}
): LightningStats => ({
  type: options.isDirectory ? "dir" : "file",
  mode: 1,
  size: options.size ?? 0,
  ino: 0,
  mtimeMs: Date.now(),
  ctimeMs: Date.now(),
  uid: 1,
  gid: 1,
  dev: 1,
  isFile: () => !options.isDirectory,
  isDirectory: () => options.isDirectory ?? false,
  isSymbolicLink: () => false
});

describe("Browser FileSystem", () => {
  let fileSystem: FileSystem;

  beforeEach(() => {
    vi.resetAllMocks();
    fileSystem = new BrowserFileSystem({
      name: "test",
      rootDir: ROOT_DIR
    });
  });

  describe("initialization", () => {
    it("should initialize successfully", async () => {
      // Given a new file system
      statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));

      // When initializing
      const initPromise = fileSystem.initialize();

      // Then it should complete without errors
      await expect(initPromise).resolves.toBeUndefined();
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
        statSpy.mockResolvedValue(createStatsMock());
        readFileSpy.mockResolvedValue("test content");

        // When reading the file
        const content = await fileSystem.readFile(path);

        // Then it should return the content
        expect(content).toBe("test content");
      });

      it("should throw NOT_FOUND for non-existent file", async () => {
        // Given a file does not exist
        const path = "/non-existent.txt";
        statSpy.mockRejectedValue(enoentError);
        readFileSpy.mockRejectedValue(enoentError);

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
        statSpy.mockResolvedValue(createStatsMock());
        writeFileSpy.mockResolvedValue(undefined);
        readFileSpy.mockResolvedValue(content);

        // When writing to the file
        await fileSystem.writeFile(path, content);

        // Then the file should exist with correct content
        expect(await fileSystem.exists(path)).toBe(true);
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
        const path = "/test-dir";
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));

        // Mock directory entries
        readdirSpy.mockResolvedValue(["file1.txt", "file2.txt"]);

        statSpy.mockImplementation((filePath: string) => {
          if (filePath.endsWith(path)) {
            return Promise.resolve(
              createStatsMock({
                isDirectory: true
              })
            );
          }
          return Promise.resolve(
            createStatsMock({
              size: filePath.includes("file1") ? 100 : 200
            })
          );
        });

        // When listing directory contents
        const contents = await fileSystem.listDirectory(path);

        // Then it should return correct items
        expect(contents).toHaveLength(2);
        expect(contents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "/test-dir/file1.txt",
              type: "file"
            }),
            expect.objectContaining({
              path: "/test-dir/file2.txt",
              type: "file"
            })
          ])
        );
      });

      it("should throw NOT_FOUND when listing non-existent directory", async () => {
        // Given a directory does not exist
        const path = "/non-existent-dir";
        statSpy.mockRejectedValue(enoentError);
        readdirSpy.mockRejectedValue(enoentError);

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
        statSpy.mockRejectedValueOnce(enoentError); // Directory doesn't exist yet
        mkdirSpy.mockResolvedValue(undefined);
        statSpy.mockResolvedValueOnce(createStatsMock({ isDirectory: true }));

        // When creating the directory
        await fileSystem.createDirectory(path);

        // Then verify mkdir was called correctly
        expect(mkdirSpy).toHaveBeenCalledWith(
          expect.stringContaining("/new-dir"),
          expect.any(Object)
        );
      });

      it("should throw ALREADY_EXISTS when creating an existing directory without recursive flag", async () => {
        // Given an existing directory
        const path = "/existing-dir";
        // First check should show directory exists
        statSpy.mockResolvedValueOnce(createStatsMock({ isDirectory: true }));
        // Second check (if it gets there) should also show directory exists
        statSpy.mockResolvedValueOnce(createStatsMock({ isDirectory: true }));
        // mkdir should not be called, but mock it just in case
        mkdirSpy.mockRejectedValueOnce(
          Object.assign(new Error("EEXIST"), { code: "EEXIST" })
        );

        // When creating the same directory again without recursive flag
        const createPromise = fileSystem.createDirectory(path);

        // Then it should throw ALREADY_EXISTS
        await expect(createPromise).rejects.toThrow(
          expect.objectContaining({
            code: "ALREADY_EXISTS"
          })
        );

        // Verify mkdir was not called
        expect(mkdirSpy).not.toHaveBeenCalled();
      });

      it("should succeed silently when creating an existing directory with recursive flag", async () => {
        // Given an existing directory
        const path = "/existing-dir";
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));

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
        statSpy.mockRejectedValue(enoentError); // Parent doesn't exist
        mkdirSpy.mockRejectedValue(enoentError); // mkdir fails because parent missing

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
        statSpy.mockRejectedValue(enoentError); // No directories exist yet
        mkdirSpy.mockResolvedValue(undefined);
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));

        // When creating directory with recursive flag
        await fileSystem.createDirectory(path, { recursive: true });

        // Then verify mkdir was called with recursive flag
        expect(mkdirSpy).toHaveBeenCalledWith(
          expect.stringContaining("/parent/child/grandchild"),
          expect.objectContaining({ recursive: true })
        );
      });

      it("should delete an empty directory", async () => {
        // Given an empty directory
        const path = "/empty-dir";
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));
        readdirSpy.mockResolvedValue([]);

        // When deleting the directory
        await fileSystem.deleteItem(path);

        // Then it should attempt to remove the directory
        expect(mockFs.rmdir).toHaveBeenCalledWith(
          expect.stringContaining("empty-dir")
        );
      });

      it("should delete a directory with contents when recursive flag is true", async () => {
        // Given a directory with contents
        const path = "/dir-with-contents";
        statSpy.mockImplementation((filePath: string) => {
          if (filePath.endsWith(".txt")) {
            return Promise.resolve(createStatsMock({ isDirectory: false }));
          }
          return Promise.resolve(createStatsMock({ isDirectory: true }));
        });
        readdirSpy.mockResolvedValue(["file1.txt", "subdir"]);

        // When deleting the directory with recursive flag
        await fileSystem.deleteItem(path, { recursive: true });

        // Then it should attempt to remove the directory and its contents
        expect(mockFs.unlink).toHaveBeenCalled(); // For files
        expect(mockFs.rmdir).toHaveBeenCalled(); // For directories
      });

      it("should throw INVALID_OPERATION when deleting non-empty directory without recursive flag", async () => {
        // Given a directory with contents
        const path = "/dir-with-contents";
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));
        readdirSpy.mockResolvedValue(["file1.txt", "subdir"]);

        // When trying to delete the directory without recursive flag
        const deletePromise = fileSystem.deleteItem(path, { recursive: false });

        // Then it should throw INVALID_OPERATION
        await expect(deletePromise).rejects.toThrow(
          expect.objectContaining({
            code: "INVALID_OPERATION",
            message: expect.stringContaining("Directory not empty")
          })
        );
      });

      it("should throw NOT_FOUND when deleting non-existent directory", async () => {
        // Given a non-existent directory
        const path = "/non-existent-dir";
        statSpy.mockRejectedValue(enoentError);

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
        await fileSystem.lock(1000, "test lock");
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));

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
        statSpy.mockResolvedValue(
          createStatsMock({
            size: 12,
            isDirectory: false
          })
        );
        readFileSpy.mockResolvedValue("test content");

        // When getting metadata
        const meta = await fileSystem.getMetadata(path);

        // Then it should return correct metadata
        expect(meta).toEqual({
          path,
          type: "file",
          hash: expect.any(String),
          size: 12,
          lastModified: expect.any(Number)
        });
      });

      it("should return directory metadata", async () => {
        // Given a directory exists
        const path = "/test-dir";
        statSpy.mockResolvedValue(
          createStatsMock({
            isDirectory: true
          })
        );
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
        // Given a locked system
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
        await expect(readPromise).resolves.not.toThrow();
      });
    });

    describe("Empty Filesystem Handling", () => {
      beforeEach(async () => {
        await fileSystem.initialize();
      });

      it("should handle empty root directory", async () => {
        // Mock empty root directory
        readdirSpy.mockResolvedValue([]);
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));

        // List root directory
        const contents = await fileSystem.listDirectory("/");
        expect(contents).toEqual([]);
      });

      it("should create and list empty directories", async () => {
        const emptyDirPath = "/empty-dir";

        // Mock directory creation
        mkdirSpy.mockResolvedValue(undefined);
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));
        readdirSpy.mockResolvedValue([]);

        // Create empty directory
        await fileSystem.createDirectory(emptyDirPath);

        // Verify directory exists
        const exists = await fileSystem.exists(emptyDirPath);
        expect(exists).toBe(true);

        // List empty directory
        const contents = await fileSystem.listDirectory(emptyDirPath);
        expect(contents).toEqual([]);

        // Get metadata for empty directory
        const metadata = await fileSystem.getMetadata(emptyDirPath);
        expect(metadata).toEqual({
          path: emptyDirPath,
          type: "directory",
          hash: "",
          size: 0,
          lastModified: expect.any(Number)
        });
      });

      it("should handle nested empty directories", async () => {
        const paths = ["/parent", "/parent/child", "/parent/child/grandchild"];

        // Mock directory operations
        mkdirSpy.mockResolvedValue(undefined);
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));
        readdirSpy.mockImplementation(async (path) => {
          if (path.includes("/parent/child/grandchild")) return [];
          if (path.includes("/parent/child")) return ["grandchild"];
          if (path.includes("/parent")) return ["child"];
          return [];
        });

        // Create nested empty directories
        for (const path of paths) {
          await fileSystem.createDirectory(path, { recursive: true });
        }

        // Verify all directories exist
        for (const path of paths) {
          const exists = await fileSystem.exists(path);
          expect(exists).toBe(true);
        }

        // Verify directory contents
        const parentContents = await fileSystem.listDirectory("/parent");
        expect(parentContents).toEqual([
          expect.objectContaining({
            path: "/parent/child",
            type: "directory"
          })
        ]);

        const childContents = await fileSystem.listDirectory("/parent/child");
        expect(childContents).toEqual([
          expect.objectContaining({
            path: "/parent/child/grandchild",
            type: "directory"
          })
        ]);

        const grandchildContents = await fileSystem.listDirectory(
          "/parent/child/grandchild"
        );
        expect(grandchildContents).toEqual([]);
      });

      it("should delete empty directories", async () => {
        const emptyDirPath = "/empty-dir";

        // Mock directory operations
        mkdirSpy.mockResolvedValue(undefined);
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));
        readdirSpy.mockResolvedValue([]);

        // Create and verify empty directory
        await fileSystem.createDirectory(emptyDirPath);
        expect(await fileSystem.exists(emptyDirPath)).toBe(true);

        // Delete empty directory
        await fileSystem.deleteItem(emptyDirPath);

        // Verify directory is deleted
        statSpy.mockRejectedValue(enoentError);
        expect(await fileSystem.exists(emptyDirPath)).toBe(false);
      });

      it("should handle concurrent operations on empty directories", async () => {
        const paths = ["/dir1", "/dir2", "/dir3"];

        // Mock directory operations
        mkdirSpy.mockResolvedValue(undefined);
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));
        readdirSpy.mockResolvedValue([]);

        // Create multiple empty directories concurrently
        await Promise.all(
          paths.map((path) => fileSystem.createDirectory(path))
        );

        // Verify all directories exist
        for (const path of paths) {
          const exists = await fileSystem.exists(path);
          expect(exists).toBe(true);
        }

        // List all directories concurrently
        const results = await Promise.all(
          paths.map((path) => fileSystem.listDirectory(path))
        );
        results.forEach((contents) => {
          expect(contents).toEqual([]);
        });
      });

      it("should maintain empty directory state during lock/unlock", async () => {
        const emptyDirPath = "/empty-dir";

        // Mock directory operations
        mkdirSpy.mockResolvedValue(undefined);
        statSpy.mockResolvedValue(createStatsMock({ isDirectory: true }));
        readdirSpy.mockResolvedValue([]);

        // Create empty directory
        await fileSystem.createDirectory(emptyDirPath);

        // Lock filesystem
        await fileSystem.lock(1000, "test lock");

        // Verify directory still exists and is empty during lock
        expect(await fileSystem.exists(emptyDirPath)).toBe(true);
        const contents = await fileSystem.listDirectory(emptyDirPath);
        expect(contents).toEqual([]);

        // Unlock filesystem
        await fileSystem.forceUnlock();

        // Verify directory state persists after unlock
        expect(await fileSystem.exists(emptyDirPath)).toBe(true);
        const contentsAfterUnlock =
          await fileSystem.listDirectory(emptyDirPath);
        expect(contentsAfterUnlock).toEqual([]);
      });
    });
  });
});
