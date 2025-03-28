import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import type {
  FileSystem,
  FileMetadata,
  FileContentStream,
  SyncTarget,
  IgnoreService
} from "@piddie/shared-types";

export interface SyncTargetTestContext<T extends SyncTarget> {
  createTarget: () => T;
  createFileSystem: () => FileSystem;
  setupSpies: (fs: FileSystem) => {
    initialize: MockInstance;
    readFile: MockInstance;
    writeFile: MockInstance;
    deleteItem: MockInstance;
    exists: MockInstance;
    lock: MockInstance;
    unlock: MockInstance;
    forceUnlock: MockInstance;
    getMetadata: MockInstance;
    listDirectory: MockInstance;
  };
  setupFileWithMetadata: (
    spies: ReturnType<SyncTargetTestContext<T>["setupSpies"]>,
    path: string,
    metadata: FileMetadata | null,
    content?: string
  ) => Promise<{ metadata: FileMetadata }>;
  createMockStream: (
    metadata: FileMetadata,
    content?: string
  ) => FileContentStream;
  reset: () => void;
}

const DEFAULT_WATCH_OPTIONS = {
  priority: 100,
  metadata: { registeredBy: "test" }
};
export function createSyncTargetTests<T extends SyncTarget>(
  context: SyncTargetTestContext<T>
) {
  return describe("SyncTarget Interface", () => {
    let target: T;
    let fileSystem: FileSystem;
    let spies: ReturnType<typeof context.setupSpies>;

    beforeEach(() => {
      vi.useFakeTimers();
      fileSystem = context.createFileSystem();
      context.reset();
      target = context.createTarget();
      spies = context.setupSpies(fileSystem);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.resetAllMocks();
    });

    describe("Initialization", () => {
      it("should initialize in primary mode", async () => {
        await target.initialize(fileSystem, true);
        // Wait for first poll
        await vi.advanceTimersToNextTimerAsync();
        expect(spies.listDirectory).toHaveBeenCalled();
        expect(target.getState().status).toBe("idle");
      });

      it("should initialize in secondary mode", async () => {
        await target.initialize(fileSystem, false);
        // Wait for first poll
        await vi.advanceTimersToNextTimerAsync();
        expect(spies.listDirectory).toHaveBeenCalled();
        expect(target.getState().status).toBe("idle");
      });

      it("should report error state when not initialized", () => {
        const state = target.getState();
        expect(state).toEqual(
          expect.objectContaining({
            status: "uninitialized",
            error: undefined
          })
        );
      });
    });

    describe("File Operations", () => {
      beforeEach(async () => {
        await target.initialize(fileSystem, true);
      });

      it("should lock filesystem during sync", async () => {
        await target.notifyIncomingChanges(["test.txt"]);
        expect(spies.lock).toHaveBeenCalledWith(
          30000,
          "Sync in progress",
          "sync",
          target.id
        );
      });

      it("should unlock filesystem after sync completion", async () => {
        await target.notifyIncomingChanges(["test.txt"]);
        await target.applyFileChange(
          {
            sourceTarget: target.id,
            path: "test.txt",
            metadata: {
              path: "test.txt",
              type: "file",
              hash: "testhash",
              size: 100,
              lastModified: Date.now()
            },
            type: "modify"
          },
          context.createMockStream(
            {
              path: "test.txt",
              type: "file",
              hash: "testhash",
              size: 100,
              lastModified: Date.now()
            },
            "new content"
          )
        );
        await target.syncComplete();
        expect(spies.unlock).toHaveBeenCalledWith(target.id);
      });

      it("should get file metadata", async () => {
        const { metadata: expectedMetadata } =
          await context.setupFileWithMetadata(
            spies,
            "test.txt",
            {
              path: "test.txt",
              type: "file",
              hash: "testhash",
              size: 100,
              lastModified: Date.now()
            },
            "test content"
          );

        const metadata = await target.getMetadata([expectedMetadata.path]);
        expect(metadata).toHaveLength(1);
        expect(metadata[0]).toEqual(expectedMetadata);
      });

      it("should get file content stream", async () => {
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "testhash",
            size: 100,
            lastModified: Date.now()
          },
          "test content"
        );

        const stream = await target.getFileContent(metadata.path);
        expect(stream).toHaveProperty("metadata");
        expect(stream).toHaveProperty("getReader");

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let totalContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalContent += decoder.decode(value);
          }
        }
        expect(totalContent).toBe("test content");
      });

      it("should apply file changes", async () => {
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "testhash",
            size: 100,
            lastModified: Date.now()
          },
          "test content"
        );

        const stream = context.createMockStream(metadata);
        await target.notifyIncomingChanges([metadata.path]);
        await target.applyFileChange(
          {
            path: metadata.path,
            type: "modify",
            sourceTarget: target.id,
            metadata
          },
          stream
        );

        expect(spies.writeFile).toHaveBeenCalledWith(
          metadata.path,
          "test content",
          true
        );
      });

      it("should handle file deletion", async () => {
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "testhash",
            size: 100,
            lastModified: Date.now()
          },
          "test content"
        );
        await target.notifyIncomingChanges([metadata.path]);
        await target.applyFileChange({
          path: metadata.path,
          sourceTarget: target.id,
          metadata,
          type: "delete"
        });

        expect(spies.deleteItem).toHaveBeenCalledWith(metadata.path, {}, true);
      });

      it("should handle conflicts", async () => {
        const existingTimestamp = Date.now() - 1000;
        const newTimestamp = Date.now();

        // Setup existing file
        const { metadata: existingMetadata } =
          await context.setupFileWithMetadata(spies, "test.txt", {
            path: "test.txt",
            type: "file",
            hash: "existinghash",
            size: 100,
            lastModified: existingTimestamp
          });

        // Setup incoming change
        const { metadata: newMetadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "newhash",
            size: 100,
            lastModified: newTimestamp
          },
          "new content"
        );

        spies.exists.mockResolvedValue(true);
        spies.getMetadata.mockResolvedValue(existingMetadata);

        const stream = context.createMockStream(newMetadata, "new content");

        await target.notifyIncomingChanges([newMetadata.path]);
        await target.applyFileChange(
          {
            path: newMetadata.path,
            metadata: newMetadata,
            sourceTarget: target.id,
            type: "modify"
          },
          stream
        );

        expect(spies.writeFile).toHaveBeenCalledWith(
          newMetadata.path,
          "new content",
          true
        );
      });

      it("should preserve file modification dates during sync", async () => {
        const originalDate = new Date("2024-01-01").getTime();
        const filePath = "test.txt";
        const fileContent = "content1";

        // Setup a file with a specific modification date
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          filePath,
          {
            path: filePath,
            type: "file",
            size: fileContent.length,
            hash: "hash1",
            lastModified: originalDate
          },
          fileContent
        );

        // Create a mock content stream for the sync operation
        const contentStream = context.createMockStream(metadata, fileContent);

        // First collect the changes
        await target.notifyIncomingChanges([filePath]);
        expect(target.getState().status).toBe("collecting");
        await vi.advanceTimersToNextTimerAsync();

        // Simulate a sync operation
        await target.applyFileChange(
          { path: filePath, type: "modify", sourceTarget: target.id, metadata },
          contentStream
        );
        await vi.advanceTimersToNextTimerAsync();

        // Verify the modification date is preserved
        expect(spies.writeFile).toHaveBeenCalledWith(
          filePath,
          fileContent,
          true // Should be called with isSyncOperation=true
        );

        // Get the file metadata after sync
        spies.getMetadata.mockResolvedValueOnce({
          ...metadata,
          lastModified: originalDate // Should maintain original date
        });
        const syncedMetadata = await target.getMetadata([filePath]);
        expect(syncedMetadata[0].lastModified).toBe(originalDate);
      });
    });

    describe("Ignore Service", () => {
      let mockIgnoreService: IgnoreService;
      let isIgnoredMock: MockInstance;

      beforeEach(async () => {
        isIgnoredMock = vi.fn().mockReturnValue(false);
        mockIgnoreService = {
          isIgnored: isIgnoredMock as unknown as (path: string) => boolean,
          setPatterns: vi.fn(),
          getPatterns: vi.fn().mockReturnValue([])
        };
        await target.initialize(fileSystem, true);
        target.setIgnoreService(mockIgnoreService);
      });

      it("should properly initialize with ignore service", async () => {
        const state = target.getState();
        expect(state.status).toBe("idle");
      });

      it("should filter out ignored files during watch", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Setup ignored and allowed files
        const { metadata: ignoredFile } = await context.setupFileWithMetadata(
          spies,
          "ignored.txt",
          {
            path: "ignored.txt",
            type: "file",
            hash: "ignoredhash",
            size: 100,
            lastModified: Date.now()
          },
          "ignored content"
        );

        const { metadata: allowedFile } = await context.setupFileWithMetadata(
          spies,
          "allowed.txt",
          {
            path: "allowed.txt",
            type: "file",
            hash: "allowedhash",
            size: 100,
            lastModified: Date.now()
          },
          "allowed content"
        );

        // Setup ignore service mock
        isIgnoredMock.mockImplementation(
          (path: string) => path === "ignored.txt"
        );

        // Mock the poll to include both files
        spies.listDirectory.mockResolvedValueOnce([
          {
            path: ignoredFile.path,
            type: ignoredFile.type,
            size: ignoredFile.size,
            lastModified: ignoredFile.lastModified
          },
          {
            path: allowedFile.path,
            type: allowedFile.type,
            size: allowedFile.size,
            lastModified: allowedFile.lastModified
          }
        ]);

        // Wait for poll and debounce
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        // Should only get changes for non-ignored files
        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: allowedFile.path,
            type: "create",
            sourceTarget: target.id
          })
        ]);

        // Verify ignore service was consulted
        expect(isIgnoredMock).toHaveBeenCalledWith("ignored.txt");
        expect(isIgnoredMock).toHaveBeenCalledWith("allowed.txt");
      });

      it("should handle ignore service errors gracefully", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Setup a file
        const { metadata: testFile } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            hash: "testhash",
            size: 100,
            lastModified: Date.now()
          },
          "test content"
        );

        // Make ignore service throw an error
        isIgnoredMock.mockImplementation(() => {
          throw new Error("Ignore service error");
        });

        // Mock the poll to include the file
        spies.listDirectory.mockResolvedValueOnce([
          {
            path: testFile.path,
            type: testFile.type,
            hash: testFile.hash,
            size: testFile.size,
            lastModified: testFile.lastModified
          }
        ]);

        // Wait for poll and debounce
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        // Should still get changes even if ignore service fails
        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: testFile.path,
            type: "create",
            sourceTarget: target.id
          })
        ]);
      });
    });

    describe("File Watching", () => {
      beforeEach(async () => {
        await target.initialize(fileSystem, true);
      });

      it("should start polling after initialization", async () => {
        // After initialization, the first poll should happen
        await vi.advanceTimersToNextTimerAsync();
        expect(spies.listDirectory).toHaveBeenCalled();
      });

      it("should setup file watching with proper polling interval", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // First poll (no changes)
        await vi.advanceTimersToNextTimerAsync();
        expect(spies.listDirectory).toHaveBeenCalled();
        expect(callback).not.toHaveBeenCalled();

        // Second poll (still no changes)
        await vi.advanceTimersToNextTimerAsync();
        expect(spies.listDirectory).toHaveBeenCalledTimes(3);
        expect(callback).not.toHaveBeenCalled();
      });

      it("should cleanup polling on unwatch", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // First poll
        await vi.advanceTimersToNextTimerAsync();
        expect(spies.listDirectory).toHaveBeenCalled();

        // Unwatch
        await target.unwatch();

        // No more polls should happen
        await vi.advanceTimersToNextTimerAsync();
        expect(spies.listDirectory).toHaveBeenCalledTimes(2);
      });

      it("should detect new files with proper debouncing", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Setup new file
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "newfile.txt",
          {
            path: "newfile.txt",
            type: "file",
            hash: "newhash",
            size: 100,
            lastModified: Date.now()
          },
          "content"
        );

        // Wait for poll and debounce
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: metadata.path,
            type: "create",
            metadata: metadata,
            sourceTarget: target.id
          })
        ]);
      });

      it("should detect modified files with proper debouncing", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        const initialTimestamp = Date.now();
        const modifiedTimestamp = initialTimestamp + 5000;

        // Setup initial file and let it be detected
        await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            lastModified: initialTimestamp,
            hash: "initialhash",
            size: 100
          },
          "initial content"
        );

        // Wait for initial poll and debounce
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        // Reset the callback mock
        callback.mockReset();

        // Setup modified file
        const { metadata: modifiedMetadata } =
          await context.setupFileWithMetadata(
            spies,
            "test.txt",
            {
              path: "test.txt",
              type: "file",
              hash: "modifiedhash",
              size: 150,
              lastModified: modifiedTimestamp
            },
            "modified content"
          );

        // Wait for next poll and debounce
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: modifiedMetadata.path,
            type: "modify",
            metadata: modifiedMetadata,
            sourceTarget: target.id
          })
        ]);
      });

      it("should detect deleted files with proper debouncing", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Setup initial file and let it be detected
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            lastModified: Date.now(),
            hash: "initialhash",
            size: 100
          },
          "initial content"
        );

        // Wait for initial poll and debounce
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        // Reset the callback mock
        callback.mockReset();

        // Simulate deletion
        spies.listDirectory.mockResolvedValueOnce([]);

        // Wait for next poll and debounce
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: metadata.path,
            type: "delete",
            sourceTarget: target.id
          })
        ]);
      });

      it("should not overlap checks if previous check is still running", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Make the directory listing take longer than the polling interval
        let resolveListDirectory: () => void;
        spies.listDirectory.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveListDirectory = () => resolve([]);
            })
        );

        // Trigger first check
        await vi.advanceTimersToNextTimerAsync();

        // Try to trigger second check while first is still running
        await vi.advanceTimersToNextTimerAsync();

        // Should only have two listDirectory calls
        expect(spies.listDirectory).toHaveBeenCalledTimes(2);

        // Complete the first check
        resolveListDirectory!();
        await vi.advanceTimersToNextTimerAsync();

        // Next check should now happen
        await vi.advanceTimersToNextTimerAsync();
        expect(spies.listDirectory).toHaveBeenCalledTimes(3);
      });

      it("should buffer multiple changes within debounce period", async () => {
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Setup two files to be detected in the same poll
        const { metadata: file1 } = await context.setupFileWithMetadata(
          spies,
          "file1.txt",
          {
            path: "file1.txt",
            type: "file",
            lastModified: Date.now(),
            hash: "hash1",
            size: 100
          },
          "content1"
        );

        const { metadata: file2 } = await context.setupFileWithMetadata(
          spies,
          "file2.txt",
          {
            path: "file2.txt",
            type: "file",
            hash: "hash2",
            size: 200,
            lastModified: Date.now()
          },
          "content2"
        );

        // Mock the poll to include both files
        spies.listDirectory.mockResolvedValueOnce([
          {
            path: file1.path,
            type: file1.type,
            size: file1.size,
            lastModified: file1.lastModified
          },
          {
            path: file2.path,
            type: file2.type,
            size: file2.size,
            lastModified: file2.lastModified
          }
        ]);

        // Wait for poll and debounce
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        // Should get both changes in a single callback
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: file1.path,
            type: "create",
            sourceTarget: target.id
          }),
          expect.objectContaining({
            path: file2.path,
            type: "create",
            sourceTarget: target.id
          })
        ]);
      });
    });

    describe("Recovery", () => {
      it("should recover from error state caused by non-empty directory", async () => {
        // Setup a file in the secondary target before initialization
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "existing.txt",
          {
            path: "existing.txt",
            type: "file",
            hash: "existinghash",
            size: 100,
            lastModified: Date.now()
          },
          "existing content"
        );

        // Mock listDirectory to show the existing file
        spies.listDirectory.mockResolvedValueOnce([
          {
            path: metadata.path,
            type: metadata.type,
            size: metadata.size,
            lastModified: metadata.lastModified
          }
        ]);

        // Initialize as secondary target - should fail due to existing files
        await expect(target.initialize(fileSystem, false)).rejects.toThrow();
        expect(target.getState().status).toBe("error");

        // Set up a file watcher
        const callback = vi.fn();
        await target.watch(callback, DEFAULT_WATCH_OPTIONS);

        // Recover from error state
        await target.recover();
        expect(target.getState().status).toBe("idle");

        // First poll after recovery should detect existing file as new
        spies.listDirectory.mockResolvedValueOnce([
          {
            path: metadata.path,
            type: metadata.type,
            size: metadata.size,
            lastModified: metadata.lastModified
          }
        ]);

        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        // Should detect existing file as "create" since we cleared lastKnownFiles
        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: metadata.path,
            type: "create",
            metadata: metadata,
            sourceTarget: target.id
          })
        ]);

        callback.mockReset();

        // Setup a new file after recovery
        const { metadata: newFileMetadata } =
          await context.setupFileWithMetadata(
            spies,
            "post-recovery.txt",
            {
              path: "post-recovery.txt",
              type: "file",
              hash: "newhash",
              size: 100,
              lastModified: Date.now()
            },
            "new content"
          );

        // Mock listDirectory to include both files
        spies.listDirectory.mockResolvedValueOnce([
          {
            path: metadata.path,
            type: metadata.type,
            size: metadata.size,
            lastModified: metadata.lastModified
          },
          {
            path: newFileMetadata.path,
            type: newFileMetadata.type,
            size: newFileMetadata.size,
            lastModified: newFileMetadata.lastModified
          }
        ]);

        // Wait for poll and debounce cycles
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        // Should only detect the new file
        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: newFileMetadata.path,
            type: "create",
            metadata: newFileMetadata,
            sourceTarget: target.id
          })
        ]);

        // Verify that polling continues by modifying existing file
        callback.mockReset();

        // Setup a modification to the existing file
        const { metadata: modifiedMetadata } =
          await context.setupFileWithMetadata(
            spies,
            "existing.txt",
            {
              path: "existing.txt",
              type: "file",
              hash: "modifiedhash",
              size: 150,
              lastModified: Date.now() + 1000
            },
            "modified content"
          );

        // Mock listDirectory to show the modification
        spies.listDirectory.mockResolvedValueOnce([
          {
            path: modifiedMetadata.path,
            type: modifiedMetadata.type,
            size: modifiedMetadata.size,
            lastModified: modifiedMetadata.lastModified
          },
          {
            path: newFileMetadata.path,
            type: newFileMetadata.type,
            size: newFileMetadata.size,
            lastModified: newFileMetadata.lastModified
          }
        ]);

        // Wait for next poll and debounce cycles
        await vi.advanceTimersToNextTimerAsync();
        await vi.advanceTimersToNextTimerAsync();

        // Should detect the modification
        expect(callback).toHaveBeenCalledWith([
          expect.objectContaining({
            path: modifiedMetadata.path,
            type: "modify",
            metadata: modifiedMetadata,
            sourceTarget: target.id
          })
        ]);
      });

      it("should handle resolution functions during recovery", async () => {
        // Setup a file in the secondary target before initialization
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "conflict.txt",
          {
            path: "conflict.txt",
            type: "file",
            hash: "conflicthash",
            size: 100,
            lastModified: Date.now()
          },
          "conflict content"
        );

        // Mock listDirectory to show the existing file
        spies.listDirectory.mockResolvedValueOnce([
          {
            path: metadata.path,
            type: metadata.type,
            size: metadata.size,
            lastModified: metadata.lastModified
          }
        ]);

        // Create mock resolution functions
        const resolveFromPrimary = vi.fn().mockResolvedValue(undefined);
        const resolutionFunctions = {
          resolveFromPrimary
        };

        // Initialize as secondary target - should fail due to existing files
        await expect(
          target.initialize(fileSystem, false, { resolutionFunctions })
        ).rejects.toThrow();
        expect(target.getState().status).toBe("error");

        // Recover using primary resolution
        await target.recover("fromPrimary");

        // Verify resolution function was called
        expect(resolveFromPrimary).toHaveBeenCalled();
        expect(target.getState().status).toBe("idle");
      });
    });

    describe("State Management", () => {
      it("should update status during sync operations", async () => {
        await target.initialize(fileSystem, true);

        await target.notifyIncomingChanges(["test.txt"]);
        expect(target.getState().status).toBe("collecting");

        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            lastModified: Date.now(),
            hash: "initialhash",
            size: 100
          },
          "test content"
        );

        const mockStream = context.createMockStream(metadata);
        await target.applyFileChange(
          {
            path: metadata.path,
            sourceTarget: target.id,
            metadata,
            type: "modify"
          },
          mockStream
        );
        expect(target.getState().status).toBe("syncing");

        await target.syncComplete();
        expect(target.getState().status).toBe("idle");
      });

      it("should handle error states", async () => {
        await target.initialize(fileSystem, true);

        spies.writeFile.mockRejectedValue(new Error("Write failed"));

        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            lastModified: Date.now(),
            hash: "initialhash",
            size: 100
          },
          "test content"
        );

        const mockStream = context.createMockStream(metadata);
        await expect(
          target.applyFileChange(
            {
              sourceTarget: target.id,
              path: metadata.path,
              metadata,
              type: "modify"
            },
            mockStream
          )
        ).rejects.toThrow();

        const state = target.getState();
        expect(state.status).toBe("error");
        expect(state.error).toBeDefined();
      });

      it("should handle state transitions during sync process", async () => {
        await target.initialize(fileSystem, true);

        // Mock an empty directory
        spies.listDirectory.mockResolvedValue([]);

        // Start sync process with empty path array
        await target.notifyIncomingChanges([]);
        expect(target.getState().status).toBe("collecting");

        // Apply changes should transition to syncing
        const { metadata } = await context.setupFileWithMetadata(
          spies,
          "test.txt",
          {
            path: "test.txt",
            type: "file",
            lastModified: Date.now(),
            hash: "initialhash",
            size: 100
          },
          "test content"
        );

        const mockStream = context.createMockStream(metadata);

        await target.applyFileChange(
          {
            path: metadata.path,
            sourceTarget: target.id,
            metadata,
            type: "modify"
          },
          mockStream
        );
        expect(target.getState().status).toBe("syncing");

        // Complete sync should transition to idle
        await target.syncComplete();
        expect(target.getState().status).toBe("idle");
      });
    });
  });
}
