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

      describe("when creating empty directories", () => {
        const testDirs = ["/dir1", "/dir2"];
        const createdDirs = new Set<string>();

        beforeEach(() => {
          createdDirs.clear();
          // Ensure root directory exists
          createdDirs.add(ROOT_DIR);

          // Mock filesystem state for directory creation
          mkdirSpy.mockImplementation(async (path) => {
            createdDirs.add(path);
            return undefined;
          });

          statSpy.mockImplementation((path) => {
            // Return directory stat for root dir and directories we've created
            if (path === ROOT_DIR || createdDirs.has(path)) {
              return Promise.resolve(createStatsMock({ isDirectory: true }));
            }
            // Otherwise simulate not found
            return Promise.reject(enoentError);
          });

          readdirSpy.mockImplementation((path) => {
            // Only return empty array for root dir and directories that exist
            if (path === ROOT_DIR || createdDirs.has(path)) {
              return Promise.resolve([]);
            }
            return Promise.reject(enoentError);
          });
        });

        it("should create directories and verify they are empty", async () => {
          // When creating directories
          for (const dir of testDirs) {
            const fullPath = `/${ROOT_DIR}${dir}`;
            await fileSystem.createDirectory(dir);
            expect(createdDirs.has(fullPath)).toBe(true);
          }

          // Then verify directories exist
          for (const dir of testDirs) {
            const exists = await fileSystem.exists(dir);
            expect(exists).toBe(true);

            const contents = await fileSystem.listDirectory(dir);
            expect(contents).toEqual([]);
          }

          // And verify mkdir was called correctly
          expect(mkdirSpy).toHaveBeenCalledTimes(testDirs.length);
          for (const dir of testDirs) {
            expect(mkdirSpy).toHaveBeenCalledWith(
              `/${ROOT_DIR}${dir}`,
              expect.any(Object)
            );
          }
        });
      });

      describe("when creating nested empty directories", () => {
        const nestedStructure = {
          "/parent": ["child"],
          "/parent/child": ["grandchild"],
          "/parent/child/grandchild": []
        };

        const createdDirs = new Set<string>();


        beforeEach(() => {
          // Mock filesystem state for nested directories
          // Start of Selection
          mkdirSpy.mockImplementation(async (path: string) => {
            createdDirs.add(path);
            return undefined;
          });
          statSpy.mockImplementation((path) => {
            // Return directory stat for any path in our structure
            if (createdDirs.has(path)) {
              return Promise.resolve(createStatsMock({ isDirectory: true }));
            }
            return Promise.reject(enoentError);
          });
          readdirSpy.mockImplementation((path) => {
            // Start of Selection
            // Return appropriate children for each directory based on createdDirs
            const children = Array.from(createdDirs)
              .filter(dir => dir.startsWith(`${path}/`) && dir !== path)
              .map(dir => dir.slice(path.length + 1).split('/')[0])
              .filter((child, index, self) => child && self.indexOf(child) === index);
            return Promise.resolve(children);
          });
        });

        it("should create and verify nested directory structure", async () => {
          // When creating nested directories
          for (const path of Object.keys(nestedStructure)) {
            await fileSystem.createDirectory(path, { recursive: true });
          }

          // Then verify each directory exists
          for (const path of Object.keys(nestedStructure)) {
            const exists = await fileSystem.exists(path);
            expect(exists).toBe(true);
          }

          // And verify directory contents match expected structure
          for (const [dir, expectedChildren] of Object.entries(nestedStructure)) {
            const contents = await fileSystem.listDirectory(dir);
            expect(contents).toHaveLength(expectedChildren.length);
            expectedChildren.forEach(child => {
              expect(contents).toContainEqual(
                expect.objectContaining({
                  path: expect.stringContaining(child),
                  type: "directory"
                })
              );
            });
          }
        });
      });

      describe("when managing empty directories during filesystem locks", () => {
        const emptyDir = "/locked-empty-dir";

        beforeEach(async () => {
          // Mock filesystem state for empty directory
          mkdirSpy.mockResolvedValue(undefined);
          statSpy.mockImplementation((path) => {
            if (path.includes(emptyDir)) {
              return Promise.resolve(createStatsMock({ isDirectory: true }));
            }
            return Promise.reject(enoentError);
          });
          readdirSpy.mockResolvedValue([]);
        });

        it("should maintain directory state through lock/unlock cycle", async () => {
          // Given an empty directory exists
          expect(await fileSystem.exists(emptyDir)).toBe(true);
          expect(await fileSystem.listDirectory(emptyDir)).toEqual([]);

          // When locking the filesystem
          await fileSystem.lock(1000, "test lock");

          // Then directory should still be accessible and empty
          expect(await fileSystem.exists(emptyDir)).toBe(true);
          expect(await fileSystem.listDirectory(emptyDir)).toEqual([]);

          // When unlocking the filesystem
          await fileSystem.forceUnlock();

          // Then directory state should persist
          expect(await fileSystem.exists(emptyDir)).toBe(true);
          expect(await fileSystem.listDirectory(emptyDir)).toEqual([]);

          // And verify our mocks were called as expected
          expect(statSpy).toHaveBeenCalledWith(expect.stringContaining(emptyDir));
          expect(readdirSpy).toHaveBeenCalledWith(expect.stringContaining(emptyDir));
        });

        it("should prevent modifications to empty directories while locked", async () => {
          // When locking the filesystem
          await fileSystem.lock(1000, "test lock");

          // Then write operations should be rejected
          await expect(fileSystem.createDirectory(`${emptyDir}/new`))
            .rejects.toThrow(expect.objectContaining({ code: "LOCKED" }));
          await expect(fileSystem.deleteItem(emptyDir))
            .rejects.toThrow(expect.objectContaining({ code: "LOCKED" }));

          // But read operations should still work
          await expect(fileSystem.exists(emptyDir)).resolves.toBe(true);
          await expect(fileSystem.listDirectory(emptyDir)).resolves.toEqual([]);
        });
      });
    });
  });
});
