import { describe, it, expect, beforeEach } from "vitest";
import type { FileSystem, FileSystemItem, FileSystemState } from "@piddie/shared-types";
import { FileSystemError } from "@piddie/shared-types";
import { LocalFileSystem } from "../src/LocalFileSystem";

const ROOT_DIR = "./unit-test";
describe("FileSystem", () => {
    let fs: FileSystem;

    beforeEach(() => {
        // Will implement factory later
        fs = new LocalFileSystem({ rootDir: ROOT_DIR });
    });

    describe("initialization", () => {
        it("should initialize successfully", async () => {
            // Given a new file system
            // When initializing
            const initPromise = fs.initialize();

            // Then it should complete without errors
            await expect(initPromise).resolves.toBeUndefined();
        });
    });

    describe("file operations", () => {
        beforeEach(async () => {
            await fs.initialize();
        });

        describe("reading files", () => {
            it("should read existing file content", async () => {
                // Given an existing file
                await fs.writeFile("/test.txt", "test content");

                // When reading the file
                const content = await fs.readFile("/test.txt");

                // Then it should return the content
                expect(content).toBe("test content");
            });

            it("should throw NOT_FOUND for non-existent file", async () => {
                // When trying to read non-existent file
                const readPromise = fs.readFile("/non-existent.txt");

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
                // Given a file path and content
                const path = "/new-file.txt";
                const content = "new content";

                // When writing the file
                await fs.writeFile(path, content);

                // Then the file should exist with correct content
                expect(await fs.exists(path)).toBe(true);
                expect(await fs.readFile(path)).toBe(content);
            });

            it("should throw when writing to locked file system", async () => {
                // Given a locked file system
                await fs.lock(1000, "test lock");

                // When trying to write
                const writePromise = fs.writeFile("/test.txt", "content");

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
                // Given a directory with files
                await fs.createDirectory("/test-dir");
                await fs.writeFile("/test-dir/file1.txt", "content1");
                await fs.writeFile("/test-dir/file2.txt", "content2");

                // When listing directory
                const contents = await fs.listDirectory("/test-dir");

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
                // When trying to list non-existent directory
                const listPromise = fs.listDirectory("/non-existent");

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
                // Given an existing file
                const path = "/meta-test.txt";
                await fs.writeFile(path, "test content");

                // When getting metadata
                const meta = await fs.getMetadata(path);

                // Then it should return correct metadata
                expect(meta).toEqual({
                    path,
                    type: "file",
                    size: 12, // "test content" length
                    lastModified: expect.any(Number)
                });
            });

            it("should return directory metadata", async () => {
                // Given an existing directory
                const path = "/test-dir";
                await fs.createDirectory(path);

                // When getting metadata
                const meta = await fs.getMetadata(path);

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
                await fs.lock(100, "short lock");

                // When waiting for timeout
                await new Promise(resolve => setTimeout(resolve, 150));

                // Then system should be unlocked
                const state = fs.getState();
                expect(state.lockState.isLocked).toBe(false);
            });

            it("should prevent operations while locked", async () => {
                // Given a locked system
                await fs.lock(1000, "test lock");

                // When attempting operations
                const writePromise = fs.writeFile("/test.txt", "content");
                const readPromise = fs.readFile("/existing.txt");
                const deletePromise = fs.deleteItem("/some-file.txt");

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