vi.mock("fs", () => {
  return {
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: Date.now(),
        size: 0,
        mode: 0,
        uid: 0,
        gid: 0,
        atime: new Date(),
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
        atimeMs: Date.now(),
        ctimeMs: Date.now(),
        birthtimeMs: Date.now(),
        blocks: 0,
        blksize: 0,
        dev: 0,
        ino: 0,
        nlink: 0,
        rdev: 0,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false
      }),
      readFile: vi.fn().mockResolvedValue(""),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined)
    }
  };
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FileSystem } from "@piddie/shared-types";
import { NodeFileSystem } from "../src/NodeFileSystem";
import { promises as fs } from "fs";
import type { BigIntStats, Dirent, PathLike, Stats } from "fs";

// Get the mocked fs module with proper typing
const fsMock = vi.mocked(fs, true);

const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

const ROOT_DIR = "./unit-test";

// Create a helper for Stats objects
const createStatsMock = (
  options: { isDirectory?: boolean; size?: number } = {}
): Stats =>
  ({
    isDirectory: () => options.isDirectory ?? false,
    isFile: () => !options.isDirectory,
    mtimeMs: Date.now(),
    size: options.size ?? 0,
    mode: 0,
    uid: 0,
    gid: 0,
    atime: new Date(),
    mtime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
    atimeMs: Date.now(),
    ctimeMs: Date.now(),
    birthtimeMs: Date.now(),
    blocks: 0,
    blksize: 0,
    dev: 0,
    ino: 0,
    nlink: 0,
    rdev: 0,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false
  }) as Stats;

// TODO: Re-enable once the local file system is done
describe.skip("FileSystem", () => {
  let fileSystem: FileSystem;

  beforeEach(() => {
    vi.resetAllMocks();
    fileSystem = new NodeFileSystem(ROOT_DIR);
  });

  describe("initialization", () => {
    it("should initialize successfully", async () => {
      // Given a new file system
      fsMock.access.mockResolvedValue(undefined);
      fsMock.mkdir.mockResolvedValue(undefined);

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
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue("test content");

        // When reading the file
        const content = await fileSystem.readFile(path);

        // Then it should return the content
        expect(content).toBe("test content");
      });

      it("should throw NOT_FOUND for non-existent file", async () => {
        // Given a file does not exist
        const path = "/non-existent.txt";
        fsMock.access.mockRejectedValue(enoentError);
        fsMock.readFile.mockRejectedValue(enoentError);

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
        fsMock.access.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue(content);

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
        fsMock.access.mockResolvedValue(undefined);

        // Mock directory entries with proper Dirent objects
        const mockDirents = [
          {
            name: "file1.txt",
            isDirectory: () => false,
            isFile: () => true,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isSymbolicLink: () => false,
            isFIFO: () => false,
            isSocket: () => false
          },
          {
            name: "file2.txt",
            isDirectory: () => false,
            isFile: () => true,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isSymbolicLink: () => false,
            isFIFO: () => false,
            isSocket: () => false
          }
        ] as Dirent[];
        fsMock.readdir.mockResolvedValue(mockDirents);

        fsMock.stat.mockImplementation((filePath: PathLike) => {
          if (filePath.toString().endsWith(path)) {
            return Promise.resolve(
              createStatsMock({
                isDirectory: true
              })
            );
          }
          return Promise.resolve(
            createStatsMock({
              size: filePath.toString().includes("file1") ? 100 : 200
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
        fsMock.access.mockRejectedValue(enoentError);
        fsMock.readdir.mockRejectedValue(enoentError);

        // When trying to list directory
        const listPromise = fileSystem.listDirectory(path);

        // Then it should throw NOT_FOUND
        await expect(listPromise).rejects.toThrow(
          expect.objectContaining({
            code: "NOT_FOUND"
          })
        );
      });
    });

    describe("metadata operations", () => {
      it("should return file metadata", async () => {
        // Given a file exists
        const path = "/meta-test.txt";
        const lastModified = Date.now();
        fsMock.access.mockResolvedValue(undefined);
        fsMock.stat.mockResolvedValue({
          isDirectory: () => false,
          isFile: () => true,
          mtimeMs: lastModified,
          size: 12
        } as unknown as BigIntStats);
        fsMock.readFile.mockResolvedValue("test content");

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

      it("should throw INVALID_OPERATION for directories", async () => {
        // Given a directory exists
        const path = "/test-dir";
        const lastModified = Date.now();
        fsMock.access.mockResolvedValue(undefined);
        fsMock.stat.mockResolvedValue({
          isDirectory: () => true,
          isFile: () => false,
          mtimeMs: lastModified
        } as unknown as BigIntStats);

        // When getting metadata, it should throw
        await expect(fileSystem.getMetadata(path)).rejects.toThrow(
          expect.objectContaining({
            code: "INVALID_OPERATION",
            message: "Path is not a file: /test-dir"
          })
        );
      });
    });

    describe("locking", () => {
      it("should respect lock timeout", async () => {
        // Given a short lock
        await fileSystem.lock(100, "short lock");

        // When waiting for timeout
        await new Promise((resolve) => setTimeout(resolve, 150));

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
  });
});
