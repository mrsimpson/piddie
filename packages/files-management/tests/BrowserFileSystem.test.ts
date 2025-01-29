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

import { describe, it, expect, beforeEach, vi } from "vitest";
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

        statSpy.mockImplementation((filePath: string) =>
          Promise.resolve(
            createStatsMock({
              size: filePath.includes("file1") ? 100 : 200
            })
          )
        );

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

      it("should throw INVALID_OPERATION for directories", async () => {
        // Given a directory exists
        const path = "/test-dir";
        statSpy.mockResolvedValue(
          createStatsMock({
            isDirectory: true
          })
        );

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

      it("should prevent operations while locked", async () => {
        // Given a locked system
        await fileSystem.lock(1000, "test lock");

        // When attempting operations
        const writePromise = fileSystem.writeFile("/test.txt", "content");
        const readPromise = fileSystem.readFile("/existing.txt");
        const deletePromise = fileSystem.deleteItem("/some-file.txt");

        // Then all operations should fail with LOCKED
        await expect(writePromise).rejects.toThrow(
          expect.objectContaining({ code: "LOCKED" })
        );
        await expect(readPromise).rejects.toThrow(
          expect.objectContaining({ code: "LOCKED" })
        );
        await expect(deletePromise).rejects.toThrow(
          expect.objectContaining({ code: "LOCKED" })
        );
      });
    });
  });
});
