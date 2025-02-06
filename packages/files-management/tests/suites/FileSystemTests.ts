import { describe, it, expect, beforeEach } from "vitest";
import type { FileSystem } from "@piddie/shared-types";
import { FileSystemError } from "@piddie/shared-types";

export interface FileSystemTestContext {
  fileSystem: FileSystem;
  mockFileExists: (path: string, content?: string) => void;
  mockDirectoryExists: (path: string) => void;
  verifyWriteFile: (path: string, content: string) => void;
  verifyRmdir: (path: string) => void;
  verifyUnlink: (path: string) => void;
}

export const createFileSystemTests = (
  description: string,
  setupContext: () => Promise<FileSystemTestContext>
) => {
  describe(description, () => {
    let context: FileSystemTestContext;

    beforeEach(async () => {
      context = await setupContext();
      await context.fileSystem.initialize();
    });

    describe("file operations", () => {
      it("should read existing file content", async () => {
        // Given a file exists
        const path = "/test.txt";
        const content = "test content";
        context.mockFileExists(path, content);

        // When reading the file
        const result = await context.fileSystem.readFile(path);

        // Then it should return the file content
        expect(result.toString()).toBe(content);
      });

      it("should throw NOT_FOUND for non-existent file", async () => {
        // Given a file does not exist
        const path = "/non-existent.txt";

        // When attempting to read the file, it should throw
        await expect(context.fileSystem.readFile(path)).rejects.toThrow(
          FileSystemError
        );
      });

      it("should write file content", async () => {
        // Given a file path
        const path = "/test.txt";
        const content = "new content";
        context.mockFileExists(path, content);

        // When writing to the file
        await context.fileSystem.writeFile(path, content);

        // Then the file should exist with correct content
        expect(await context.fileSystem.exists(path)).toBe(true);
        context.verifyWriteFile(path, content);
      });

      it("should throw when writing to locked file system", async () => {
        // Given a locked file system
        const path = "/test.txt";
        const content = "new content";
        await context.fileSystem.lock(1000, "test lock");

        // When trying to write
        const writePromise = context.fileSystem.writeFile(path, content);

        // Then it should throw LOCKED
        await expect(writePromise).rejects.toThrow(
          expect.objectContaining({
            code: "LOCKED"
          })
        );
      });
    });

    describe("directory operations", () => {
      it("should create directory", async () => {
        // Given a directory path
        const path = "/new-dir";

        // When creating the directory
        await context.fileSystem.createDirectory(path);

        // Then it should exist
        expect(await context.fileSystem.exists(path)).toBe(true);
      });

      it("should throw ALREADY_EXISTS when creating an existing directory without recursive flag", async () => {
        // Given an existing directory
        const path = "/existing-dir";
        context.mockDirectoryExists(path);

        // When creating the same directory again without recursive flag
        const createPromise = context.fileSystem.createDirectory(path);

        // Then it should throw ALREADY_EXISTS
        await expect(createPromise).rejects.toThrow(
          expect.objectContaining({
            code: "ALREADY_EXISTS"
          })
        );
      });

      it("should succeed silently when creating an existing directory with recursive flag", async () => {
        // Given an existing directory
        const path = "/existing-dir";
        context.mockDirectoryExists(path);

        // When creating the same directory again with recursive flag
        const createPromise = context.fileSystem.createDirectory(path, {
          recursive: true
        });

        // Then it should succeed silently
        await expect(createPromise).resolves.toBeUndefined();
      });

      it("should throw NOT_FOUND when parent directory doesn't exist without recursive flag", async () => {
        // Given a path with non-existent parent
        const path = "/non-existent-parent/new-dir";

        // When trying to create directory without recursive flag
        const createPromise = context.fileSystem.createDirectory(path);

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

        // When creating directory with recursive flag
        await context.fileSystem.createDirectory(path, { recursive: true });

        // Then the directory should exist
        expect(await context.fileSystem.exists(path)).toBe(true);
      });

      it("should throw INVALID_OPERATION when deleting non-empty directory without recursive flag", async () => {
        // Given a directory with contents
        const path = "/dir-with-contents";
        context.mockDirectoryExists(path);
        context.mockFileExists(path + "/file1.txt");
        context.mockFileExists(path + "/file2.txt");

        // When trying to delete the directory without recursive flag
        const deletePromise = context.fileSystem.deleteItem(path, {
          recursive: false
        });

        // Then it should throw INVALID_OPERATION
        await expect(deletePromise).rejects.toThrow(
          expect.objectContaining({
            code: "INVALID_OPERATION",
            message: expect.stringContaining("Directory not empty")
          })
        );
      });

      it("should delete a directory with contents when recursive flag is true", async () => {
        // Given a directory with contents
        const path = "/dir-with-contents";
        context.mockDirectoryExists(path);
        context.mockFileExists(path + "/file1.txt");
        context.mockDirectoryExists(path + "/subdir");

        // When deleting the directory with recursive flag
        await context.fileSystem.deleteItem(path, { recursive: true });

        // Then it should attempt to remove the directory and its contents
        context.verifyRmdir(path);
      });

      it("should throw NOT_FOUND when deleting non-existent directory", async () => {
        // Given a non-existent directory
        const path = "/non-existent-dir";

        // When trying to delete the directory
        const deletePromise = context.fileSystem.deleteItem(path);

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
        context.mockDirectoryExists(path);
        await context.fileSystem.lock(1000, "test lock");

        // When trying to delete the directory
        const deletePromise = context.fileSystem.deleteItem(path);

        // Then it should throw LOCKED
        await expect(deletePromise).rejects.toThrow(
          expect.objectContaining({
            code: "LOCKED"
          })
        );
      });

      it("should throw NOT_FOUND when listing non-existent directory", async () => {
        // Given a directory does not exist
        const path = "/non-existent-dir";

        // When trying to list directory
        const listPromise = context.fileSystem.listDirectory(path);

        // Then it should throw NOT_FOUND
        await expect(listPromise).rejects.toThrow(
          expect.objectContaining({
            code: "NOT_FOUND"
          })
        );
      });

      it("should list directory contents with correct metadata", async () => {
        // Given a directory with contents of different sizes
        const path = "/test-dir";
        context.mockDirectoryExists(path);
        context.mockFileExists(path + "/file1.txt", "x".repeat(100)); // 100 bytes
        context.mockFileExists(path + "/file2.txt", "x".repeat(200)); // 200 bytes

        // When listing directory contents
        const contents = await context.fileSystem.listDirectory(path);

        // Then it should return correct items with metadata
        expect(contents).toHaveLength(2);
        expect(contents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "/test-dir/file1.txt",
              type: "file",
              size: 100
            }),
            expect.objectContaining({
              path: "/test-dir/file2.txt",
              type: "file",
              size: 200
            })
          ])
        );
      });

      it("should list directory contents", async () => {
        // Given a directory with contents
        const path = "/dir";
        const entries = ["file1.txt", "file2.txt"];
        context.mockDirectoryExists(path);
        context.mockFileExists(path + "/" + entries[0]);
        context.mockFileExists(path + "/" + entries[1]);

        // When listing directory contents
        const contents = await context.fileSystem.listDirectory(path);

        // Then it should return the list of files
        expect(contents.map((item) => item.path)).toEqual(
          entries.map((entry) => path + "/" + entry)
        );
      });

      it("should delete an empty directory", async () => {
        // Given an empty directory
        const path = "/empty-dir";
        context.mockDirectoryExists(path);

        // When deleting the directory
        await context.fileSystem.deleteItem(path);

        // Then it should attempt to remove the directory
        context.verifyRmdir(path);
      });

      it("should delete a file", async () => {
        // Given a file exists
        const path = "/file.txt";
        context.mockFileExists(path);

        // When deleting the file
        await context.fileSystem.deleteItem(path);

        // Then it should attempt to remove the file
        context.verifyUnlink(path);
      });
    });

    describe("metadata operations", () => {
      it("should return file metadata", async () => {
        // Given a file exists
        const path = "/test.txt";
        const size = 100;
        // Create content of exactly 100 bytes
        const content = "x".repeat(size);
        context.mockFileExists(path, content);

        // When getting metadata
        const meta = await context.fileSystem.getMetadata(path);

        // Then it should return correct metadata
        expect(meta.type).toBe("file");
        expect(meta.size).toBe(size);
      });

      it("should return directory metadata", async () => {
        // Given a directory exists
        const path = "/dir";
        context.mockDirectoryExists(path);

        // When getting metadata
        const meta = await context.fileSystem.getMetadata(path);

        // Then it should return correct metadata
        expect(meta.type).toBe("directory");
      });
    });

    describe("Empty Filesystem Handling", () => {
      it("should handle empty directory creation", async () => {
        // Given a directory path
        const path = "/empty-dir";

        // When creating the directory
        await context.fileSystem.createDirectory(path);

        // Then it should exist
        expect(await context.fileSystem.exists(path)).toBe(true);
      });

      it("should handle recursive empty directory creation", async () => {
        // Given a nested directory path
        const path = "/parent/child/empty-dir";

        // When creating the directory recursively
        await context.fileSystem.createDirectory(path, { recursive: true });

        // Then it should exist
        expect(await context.fileSystem.exists(path)).toBe(true);
      });

      it("should handle empty directory removal", async () => {
        // Given an empty directory exists
        const path = "/empty-dir";
        context.mockDirectoryExists(path);

        // When removing the directory
        await context.fileSystem.deleteItem(path);

        // Then it should be removed
        context.verifyRmdir(path);
      });

      describe("when creating nested empty directories", () => {
        const nestedStructure = {
          "/parent": ["child"],
          "/parent/child": ["grandchild"],
          "/parent/child/grandchild": []
        };

        beforeEach(async () => {
          // Create the nested directory structure
          for (const [dir, children] of Object.entries(nestedStructure)) {
            context.mockDirectoryExists(dir);
            for (const child of children) {
              context.mockDirectoryExists(`${dir}/${child}`);
            }
          }
        });

        it("should list all nested empty directories", async () => {
          // When listing parent directory
          const contents = await context.fileSystem.listDirectory("/parent");
          expect(contents.map((item) => item.path)).toContain("/parent/child");

          // And listing child directory
          const childContents =
            await context.fileSystem.listDirectory("/parent/child");
          expect(childContents.map((item) => item.path)).toContain(
            "/parent/child/grandchild"
          );
        });

        it("should remove nested empty directories recursively", async () => {
          // When removing parent directory recursively
          await context.fileSystem.deleteItem("/parent", { recursive: true });

          // Then it should verify the removal
          context.verifyRmdir("/parent");
        });
      });
    });

    describe("Filesystem Locking", () => {
      describe("basic locking behavior", () => {
        it("should prevent writes while locked", async () => {
          // Given a file system
          const path = "/test.txt";
          const content = "test content";
          context.mockFileExists(path);

          // When locking the file system
          await context.fileSystem.lock(1000, "test lock");

          // Then write operations should be rejected
          await expect(
            context.fileSystem.writeFile(path, content)
          ).rejects.toThrow(expect.objectContaining({ code: "LOCKED" }));
          await expect(
            context.fileSystem.createDirectory("/new-dir")
          ).rejects.toThrow(expect.objectContaining({ code: "LOCKED" }));
          await expect(context.fileSystem.deleteItem(path)).rejects.toThrow(
            expect.objectContaining({ code: "LOCKED" })
          );
        });

        it("should allow reads while locked", async () => {
          // Given a file system with content
          const path = "/test.txt";
          const content = "test content";
          context.mockFileExists(path, content);

          // When locking the file system
          await context.fileSystem.lock(1000, "test lock");

          // Then read operations should still work
          await expect(context.fileSystem.exists(path)).resolves.toBe(true);
          await expect(
            context.fileSystem.readFile(path)
          ).resolves.toBeDefined();
          await expect(
            context.fileSystem.listDirectory("/")
          ).resolves.toBeDefined();
        });

        it("should maintain state through lock/unlock cycle", async () => {
          // Given a file system with content
          const path = "/test.txt";
          const content = "test content";
          context.mockFileExists(path, content);

          // When locking and unlocking
          await context.fileSystem.lock(1000, "test lock");
          await context.fileSystem.forceUnlock();

          // Then the state should persist
          expect(await context.fileSystem.exists(path)).toBe(true);
          expect((await context.fileSystem.readFile(path)).toString()).toBe(
            content
          );
        });
      });

      describe("when managing empty directories during filesystem locks", () => {
        const emptyDir = "/locked-empty-dir";

        beforeEach(async () => {
          context.mockDirectoryExists(emptyDir);
        });

        it("should maintain directory state through lock/unlock cycle", async () => {
          // Given an empty directory exists
          expect(await context.fileSystem.exists(emptyDir)).toBe(true);
          expect(await context.fileSystem.listDirectory(emptyDir)).toEqual([]);

          // When locking the filesystem
          await context.fileSystem.lock(1000, "test lock");

          // Then directory should still be accessible and empty
          expect(await context.fileSystem.exists(emptyDir)).toBe(true);
          expect(await context.fileSystem.listDirectory(emptyDir)).toEqual([]);

          // When unlocking the filesystem
          await context.fileSystem.forceUnlock();

          // Then directory state should persist
          expect(await context.fileSystem.exists(emptyDir)).toBe(true);
          expect(await context.fileSystem.listDirectory(emptyDir)).toEqual([]);
        });

        it("should prevent modifications to empty directories while locked", async () => {
          // When locking the filesystem
          await context.fileSystem.lock(1000, "test lock");

          // Then write operations should be rejected
          await expect(
            context.fileSystem.createDirectory(`${emptyDir}/new`)
          ).rejects.toThrow(expect.objectContaining({ code: "LOCKED" }));
          await expect(context.fileSystem.deleteItem(emptyDir)).rejects.toThrow(
            expect.objectContaining({ code: "LOCKED" })
          );

          // But read operations should still work
          await expect(context.fileSystem.exists(emptyDir)).resolves.toBe(true);
          await expect(
            context.fileSystem.listDirectory(emptyDir)
          ).resolves.toEqual([]);
        });
      });
    });
  });
};
