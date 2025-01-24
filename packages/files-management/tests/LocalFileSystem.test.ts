import { describe, it, expect, beforeEach, vi, type MockInstance } from "vitest";
import type { FileSystem, FileSystemItem, FileSystemState } from "@piddie/shared-types";
import { FileSystemError } from "@piddie/shared-types";
import { LocalFileSystem } from "../src/LocalFileSystem";
import { promises as fs } from 'fs';

// First create base mock with only the methods we need
const fsMock = {
    mkdir: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rm: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn()
} as const;

const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

const ROOT_DIR = "./unit-test";
describe("FileSystem", () => {
    let localFileSystem: FileSystem;

    beforeEach(() => {
        vi.resetAllMocks();

        localFileSystem = new LocalFileSystem({
            rootDir: ROOT_DIR,
            fs: fsMock as unknown as typeof fs
        });
    });

    describe("initialization", () => {
        it("should initialize successfully", async () => {
            // Given a new file system
            fsMock.access.mockResolvedValue(undefined);
            fsMock.mkdir.mockResolvedValue(undefined);

            // When initializing
            const initPromise = localFileSystem.initialize();

            // Then it should complete without errors
            await expect(initPromise).resolves.toBeUndefined();
        });
    });

    describe("file operations", () => {
        beforeEach(async () => {
            await localFileSystem.initialize();
        });


        describe("reading files", () => {
            it("should read existing file content", async () => {
                // Given a file exists
                const path = "/test.txt";
                fsMock.access.mockResolvedValue(undefined);
                fsMock.readFile.mockResolvedValue("test content");

                // When reading the file
                const content = await localFileSystem.readFile(path);

                // Then it should return the content
                expect(content).toBe("test content");
            });

            it("should throw NOT_FOUND for non-existent file", async () => {
                // Given a file does not exist
                const path = "/non-existent.txt";
                fsMock.access.mockRejectedValue(enoentError);
                fsMock.readFile.mockRejectedValue(enoentError);

                // When trying to read the file
                const readPromise = localFileSystem.readFile(path);

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
                await localFileSystem.writeFile(path, content);

                // Then the file should exist with correct content
                expect(await localFileSystem.exists(path)).toBe(true);
                expect(await localFileSystem.readFile(path)).toBe(content);
            });

            it("should throw when writing to locked file system", async () => {
                // Given a locked file system
                const path = "/test.txt";
                const content = "new content";
                await localFileSystem.lock(1000, "test lock");

                // When trying to write
                const writePromise = localFileSystem.writeFile(path, content);

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
                        isFile: () => true
                    },
                    {
                        name: "file2.txt",
                        isDirectory: () => false,
                        isFile: () => true
                    }
                ];
                fsMock.readdir.mockResolvedValue(mockDirents);

                fsMock.stat.mockImplementation((filePath) => Promise.resolve({
                    isDirectory: () => false,
                    isFile: () => true,
                    mtimeMs: Date.now(),
                    size: filePath.includes("file1") ? 100 : 200
                } as any));

                // When listing directory contents
                const contents = await localFileSystem.listDirectory(path);

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
                const listPromise = localFileSystem.listDirectory(path);

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
                } as any);

                // When getting metadata
                const meta = await localFileSystem.getMetadata(path);

                // Then it should return correct metadata
                expect(meta).toEqual({
                    path,
                    type: "file",
                    size: 12,
                    lastModified: expect.any(Number)
                });
            });

            it("should return directory metadata", async () => {
                // Given a directory exists
                const path = "/test-dir";
                const lastModified = Date.now();
                fsMock.access.mockResolvedValue(undefined);
                fsMock.stat.mockResolvedValue({
                    isDirectory: () => true,
                    isFile: () => false,
                    mtimeMs: lastModified
                } as any);

                // When getting metadata
                const meta = await localFileSystem.getMetadata(path);

                // Then it should return correct metadata
                expect(meta).toEqual({
                    path,
                    type: "directory",
                    lastModified: expect.any(Number)
                });
            });
        });

        describe("locking", () => {
            it("should respect lock timeout", async () => {
                // Given a short lock
                await localFileSystem.lock(100, "short lock");

                // When waiting for timeout
                await new Promise(resolve => setTimeout(resolve, 150));

                // Then system should be unlocked
                const state = localFileSystem.getState();
                expect(state.lockState.isLocked).toBe(false);
            });

            it("should prevent operations while locked", async () => {
                // Given a locked system
                await localFileSystem.lock(1000, "test lock");

                // When attempting operations
                const writePromise = localFileSystem.writeFile("/test.txt", "content");
                const readPromise = localFileSystem.readFile("/existing.txt");
                const deletePromise = localFileSystem.deleteItem("/some-file.txt");

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