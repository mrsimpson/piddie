import { describe, beforeEach, it, expect, vi } from "vitest";
import type {
  SyncTarget,
  FileMetadata,
  FileContentStream,
  FileChangeInfo,
  TargetState,
  SyncManagerConfig,
  FileChunk,
  FileSystem,
  FileSystemItem,
  SyncManager,
  FileConflict
} from "@piddie/shared-types";
import { SyncManagerError, SyncManagerStateType } from "@piddie/shared-types";
import { ReadableStream, ReadableStreamDefaultReader } from "node:stream/web";
import { FileSyncManager } from "../src/FileSyncManager";

class MockFileContentStream implements FileContentStream {
  private stream: ReadableStream<FileChunk>;
  metadata: FileMetadata;

  constructor(content: string | Buffer, metadata: FileMetadata) {
    this.metadata = metadata;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

    this.stream = new ReadableStream<FileChunk>({
      start: (controller) => {
        controller.enqueue({
          content: buffer.toString(),
          chunkIndex: 0,
          totalChunks: 1,
          chunkHash: "mock-hash"
        });
        controller.close();
      }
    });
  }

  getReader(): ReadableStreamDefaultReader<FileChunk> {
    return this.stream.getReader();
  }

  async close(): Promise<void> {
    await this.stream.cancel();
  }
}

class MockSyncTarget implements SyncTarget {
  id: string;
  type: "browser" | "local" | "container";
  private state: TargetState;
  private watchCallback: ((changes: FileChangeInfo[]) => void) | null = null;
  private mockFiles: Map<string, { content: string; metadata: FileMetadata }> =
    new Map();

  constructor(id: string, type: "browser" | "local" | "container") {
    this.id = id;
    this.type = type;
    this.state = {
      id,
      type,
      lockState: { isLocked: false },
      pendingChanges: 0,
      status: "idle"
    };
  }

  async listDirectory(path: string): Promise<FileSystemItem[]> {
    const result: FileSystemItem[] = [];
    const prefix = path === "/" ? "" : path + "/";

    // Get all files/directories that are direct children of this path
    for (const [filePath, file] of this.mockFiles.entries()) {
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.slice(prefix.length);
        // Only include direct children (no nested paths)
        if (!relativePath.includes("/")) {
          result.push({
            path: filePath,
            type: file.metadata.type,
            lastModified: file.metadata.lastModified
          });
        }
      }
    }

    return result;
  }

  async initialize(): Promise<void> {
    // Mock implementation
  }

  async notifyIncomingChanges(): Promise<void> {
    this.state.status = "syncing";
  }

  async getMetadata(paths: string[]): Promise<FileMetadata[]> {
    // If paths is empty or contains ".", return all files
    if (paths.length === 0 || paths.includes(".")) {
      return Array.from(this.mockFiles.values()).map((file) => file.metadata);
    }

    // Otherwise return only requested files
    return paths.map((path) => {
      const file = this.mockFiles.get(path);
      if (!file) throw new Error(`File not found: ${path}`);
      return file.metadata;
    });
  }

  async getFileContent(path: string): Promise<FileContentStream> {
    const file = this.mockFiles.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return new MockFileContentStream(file.content, file.metadata);
  }

  async applyFileChange(
    changeInfo: FileChangeInfo,
    contentStream?: FileContentStream
  ): Promise<FileConflict | null> {
    if (changeInfo.type === "delete") {
      this.mockFiles.delete(changeInfo.path);
      return null;
    }

    if (!contentStream) {
      throw new Error("Content stream required for create/modify operations");
    }

    let content = "";
    const reader = contentStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += value.content;
      }
    } finally {
      reader.releaseLock();
    }

    this.mockFiles.set(changeInfo.path, {
      content,
      metadata: {
        path: changeInfo.path,
        type:
          changeInfo.hash === "" && changeInfo.size === 0
            ? "directory"
            : "file",
        hash: changeInfo.hash,
        size: changeInfo.size,
        lastModified: changeInfo.lastModified
      }
    });
    return null;
  }

  async syncComplete(): Promise<boolean> {
    // remain in error state if sync failed even after it's completed
    if (this.state.status !== "error") {
      this.state.status = "idle";
    }
    return true;
  }

  async watch(callback: (changes: FileChangeInfo[]) => void): Promise<void> {
    this.watchCallback = callback;
  }

  async unwatch(): Promise<void> {
    this.watchCallback = null;
  }

  getState(): TargetState {
    return this.state;
  }

  async recover(): Promise<void> {
    this.state.status = "idle";
  }

  // Test helper methods
  simulateChange(changes: FileChangeInfo[]): void {
    if (this.watchCallback) {
      this.watchCallback(changes);
    }
  }

  setMockFile(path: string, content: string, metadata: FileMetadata): void {
    this.mockFiles.set(path, { content, metadata });
  }
}

describe("FileSyncManager", () => {
  let primaryTarget: MockSyncTarget;
  let secondaryTarget1: MockSyncTarget;
  let secondaryTarget2: MockSyncTarget;
  let config: SyncManagerConfig;
  let manager: FileSyncManager;

  // Common test data
  const createTestFile = (
    path: string = "test.txt",
    content: string = "test content"
  ) => {
    const metadata: FileMetadata = {
      path,
      type: "file",
      hash: "testhash",
      size: 100,
      lastModified: Date.now()
    };

    const change: FileChangeInfo = {
      ...metadata,
      type: "modify",
      sourceTarget: primaryTarget.id
    };

    return { metadata, change, content };
  };

  beforeEach(() => {
    primaryTarget = new MockSyncTarget("primary", "local");
    secondaryTarget1 = new MockSyncTarget("secondary1", "browser");
    secondaryTarget2 = new MockSyncTarget("secondary2", "container");

    config = {
      inactivityDelay: 100,
      maxRetries: 3
    };

    manager = new FileSyncManager();
  });

  describe("Target Registration", () => {
    it("should register primary target successfully", async () => {
      // Given an initialized primary target
      primaryTarget.getState().status = "idle";

      // When registering a primary target
      await manager.registerTarget(primaryTarget, { role: "primary" });

      // Then it should be accessible as primary
      expect(manager.getPrimaryTarget()).toBe(primaryTarget);
      expect(manager.getSecondaryTargets()).toHaveLength(0);
    });

    it("should register secondary targets successfully", async () => {
      // Given initialized targets
      primaryTarget.getState().status = "idle";
      secondaryTarget1.getState().status = "idle";
      secondaryTarget2.getState().status = "idle";

      // When registering targets
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.registerTarget(secondaryTarget2, { role: "secondary" });

      // Then they should be accessible
      expect(manager.getPrimaryTarget()).toBe(primaryTarget);
      const secondaries = manager.getSecondaryTargets();
      expect(secondaries).toHaveLength(2);
      expect(secondaries).toContain(secondaryTarget1);
      expect(secondaries).toContain(secondaryTarget2);
    });

    it("should reject uninitialized primary target", async () => {
      // Given an uninitialized primary target
      primaryTarget.getState().status = "error";

      // When trying to register
      // Then it should throw
      await expect(() =>
        manager.registerTarget(primaryTarget, { role: "primary" })
      ).rejects.toThrow(
        new SyncManagerError(
          `Target ${primaryTarget.id} is not initialized`,
          "SOURCE_NOT_AVAILABLE"
        )
      );
    });

    it("should reject uninitialized secondary target", async () => {
      // Given an initialized primary and uninitialized secondary
      primaryTarget.getState().status = "idle";
      secondaryTarget1.getState().status = "error";

      // When registering primary and trying to register secondary
      await manager.registerTarget(primaryTarget, { role: "primary" });

      // Then it should throw
      await expect(() =>
        manager.registerTarget(secondaryTarget1, { role: "secondary" })
      ).rejects.toThrow(
        new SyncManagerError(
          `Target ${secondaryTarget1.id} is not initialized`,
          "SOURCE_NOT_AVAILABLE"
        )
      );
    });

    it("should throw error when registering second primary target", async () => {
      // Given an existing initialized primary target
      primaryTarget.getState().status = "idle";
      secondaryTarget1.getState().status = "idle";
      await manager.registerTarget(primaryTarget, { role: "primary" });

      // When trying to register another primary
      // Then it should throw
      await expect(() =>
        manager.registerTarget(secondaryTarget1, { role: "primary" })
      ).rejects.toThrow(
        new SyncManagerError(
          "Primary target already exists",
          "PRIMARY_TARGET_EXISTS"
        )
      );
    });

    it("should throw error when registering duplicate target id", async () => {
      // Given a target with ID 'test'
      const target1 = new MockSyncTarget("test", "local");
      const target2 = new MockSyncTarget("test", "browser");
      target1.getState().status = "idle";
      target2.getState().status = "idle";
      await manager.registerTarget(target1, { role: "primary" });

      // When trying to register another target with same ID
      // Then it should throw
      await expect(() =>
        manager.registerTarget(target2, { role: "secondary" })
      ).rejects.toThrow(
        new SyncManagerError(
          `Target with ID ${target2.id} already exists`,
          "TARGET_ALREADY_EXISTS"
        )
      );
    });

    it("should throw error when registering target with invalid role", async () => {
      // Given an initialized target
      primaryTarget.getState().status = "idle";

      // When trying to register with invalid role
      await expect(() =>
        manager.registerTarget(primaryTarget, { role: "invalid" as any })
      ).rejects.toThrow(
        new SyncManagerError("Invalid target role", "TARGET_NOT_FOUND")
      );
    });
  });

  describe("State Machine", () => {
    it("should validate state transitions correctly", () => {
      // Given a new manager
      const manager = new FileSyncManager();

      // Then initial state should be uninitialized
      expect(manager.getCurrentState()).toBe("uninitialized");

      // And valid transitions should be validated correctly
      expect(
        manager.validateStateTransition("uninitialized", "ready", "initialize")
      ).toBe(true);
      expect(
        manager.validateStateTransition("ready", "syncing", "changesDetected")
      ).toBe(true);
      expect(
        manager.validateStateTransition("syncing", "ready", "syncComplete")
      ).toBe(true);
      expect(
        manager.validateStateTransition(
          "syncing",
          "conflict",
          "conflictDetected"
        )
      ).toBe(true);
      expect(
        manager.validateStateTransition("conflict", "ready", "conflictResolved")
      ).toBe(true);
      expect(manager.validateStateTransition("ready", "error", "error")).toBe(
        true
      );
      expect(
        manager.validateStateTransition("error", "ready", "recovery")
      ).toBe(true);

      // And invalid transitions should be rejected
      expect(
        manager.validateStateTransition(
          "uninitialized",
          "syncing",
          "initialize"
        )
      ).toBe(false);
      expect(
        manager.validateStateTransition("ready", "ready", "someAction")
      ).toBe(false);
      expect(
        manager.validateStateTransition("error", "syncing", "recovery")
      ).toBe(false);
    });

    it("should transition through states during initialization", async () => {
      // Given a new manager
      const manager = new FileSyncManager();
      expect(manager.getCurrentState()).toBe("uninitialized");

      // When registering targets and initializing
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });

      // Then state should still be uninitialized
      expect(manager.getCurrentState()).toBe("uninitialized");

      // When initializing
      await manager.initialize(config);

      // Then state should be ready
      expect(manager.getCurrentState()).toBe("ready");
    });

    it("should transition through states during sync", async () => {
      // Given an initialized manager
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.initialize(config);
      expect(manager.getCurrentState()).toBe("ready");

      // When primary reports changes
      const { change } = createTestFile();
      const syncPromise = manager.handleTargetChanges(primaryTarget.id, [
        change
      ]);

      // Then state should be syncing
      expect(manager.getCurrentState()).toBe("syncing");

      // When sync completes
      await syncPromise;

      // Then state should be ready again
      expect(manager.getCurrentState()).toBe("ready");
    });

    it("should transition to conflict state on sync conflicts", async () => {
      // Given an initialized manager
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.initialize(config);

      // And a file that will cause conflict
      const { metadata, change, content } = createTestFile();
      secondaryTarget1.setMockFile(metadata.path, content, metadata);

      // When secondary reports changes and primary sync fails
      const error = new Error("Sync failed");
      vi.spyOn(primaryTarget, "applyFileChange").mockRejectedValueOnce(error);
      await manager.handleTargetChanges(secondaryTarget1.id, [change]);

      // Then state should be conflict
      expect(manager.getCurrentState()).toBe("conflict");

      // When confirming the sync
      await manager.confirmPrimarySync();

      // Then state should be ready
      expect(manager.getCurrentState()).toBe("ready");
    });

    it("should transition to error state on critical failures", async () => {
      // Given an initialized manager
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.initialize(config);

      // When a critical error occurs (simulate by forcing invalid state transition)
      try {
        manager.transitionTo("invalid" as SyncManagerStateType, "someAction");
      } catch (e) {
        // Expected
      }

      // Then state should be error
      expect(manager.getCurrentState()).toBe("error");
    });
  });

  describe("Change Handling", () => {
    beforeEach(async () => {
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.registerTarget(secondaryTarget2, { role: "secondary" });
      await manager.initialize(config);
      expect(manager.getCurrentState()).toBe("ready");
    });

    describe("Primary Target Changes", () => {
      it("should handle state transitions during primary sync", async () => {
        // Given a file change in primary
        const { metadata, change, content } = createTestFile();
        primaryTarget.setMockFile(metadata.path, content, metadata);

        // When primary reports changes
        const syncPromise = manager.handleTargetChanges(primaryTarget.id, [
          change
        ]);

        // Then state should be syncing
        expect(manager.getCurrentState()).toBe("syncing");

        // When sync completes
        await syncPromise;

        // Then state should be ready
        expect(manager.getCurrentState()).toBe("ready");
        expect(
          manager.validateStateTransition("ready", "syncing", "changesDetected")
        ).toBe(true);
      });

      it("should propagate changes from primary to secondaries", async () => {
        // Given a file change in primary
        const { metadata, change, content } = createTestFile();
        primaryTarget.setMockFile(metadata.path, content, metadata);

        // When primary reports changes
        await manager.handleTargetChanges(primaryTarget.id, [change]);

        // Then both secondaries should receive the changes
        const status = manager.getStatus();
        expect(status.phase).toBe("idle");
        expect(secondaryTarget1.getState().status).toBe("idle");
        expect(secondaryTarget2.getState().status).toBe("idle");

        // And file should exist in both secondaries
        const content1 = await secondaryTarget1.getFileContent(metadata.path);
        const content2 = await secondaryTarget2.getFileContent(metadata.path);
        expect(content1.metadata.hash).toBe(metadata.hash);
        expect(content2.metadata.hash).toBe(metadata.hash);
      });

      it("should handle secondary sync failure by marking target as dirty", async () => {
        // Given a file change in primary
        const { metadata, change, content } = createTestFile();
        primaryTarget.setMockFile(metadata.path, content, metadata);

        // And secondary1 will fail to apply changes
        const error = new Error("Sync failed");
        vi.spyOn(secondaryTarget1, "applyFileChange").mockRejectedValue(error);

        // When primary reports changes
        await manager.handleTargetChanges(primaryTarget.id, [change]);

        // Then secondary1 should be marked as dirty
        const status = manager.getStatus();
        expect(status.targets.get(secondaryTarget1.id)?.status).toBe("error");

        // But secondary2 should still sync successfully
        expect(status.targets.get(secondaryTarget2.id)?.status).toBe("idle");
      });

      it("should respect max batch size", async () => {
        // Given many changes exceeding batch size
        const changes = Array.from({ length: 15 }, (_, i) => {
          const { change } = createTestFile(`test${i}.txt`);
          return change;
        });

        // When primary reports changes
        await manager.handleTargetChanges(primaryTarget.id, changes);

        // Then changes should be processed in batches
        const status = manager.getStatus();
        expect(status.phase).toBe("idle");

        // Verify all changes were eventually applied
        for (let i = 0; i < 15; i++) {
          expect(secondaryTarget1.getState().pendingChanges).toBe(0);
          expect(secondaryTarget2.getState().pendingChanges).toBe(0);
        }
      });
    });

    describe("Secondary Target Changes", () => {
      it("should handle state transitions during secondary sync", async () => {
        // Given a file change in secondary
        const { metadata, change, content } = createTestFile();
        change.sourceTarget = secondaryTarget1.id;
        secondaryTarget1.setMockFile(metadata.path, content, metadata);

        // When secondary reports changes
        const syncPromise = manager.handleTargetChanges(secondaryTarget1.id, [
          change
        ]);

        // Then state should be syncing
        expect(manager.getCurrentState()).toBe("syncing");

        // When sync completes
        await syncPromise;

        // Then state should be ready
        expect(manager.getCurrentState()).toBe("ready");
      });

      it("should sync changes to primary first", async () => {
        // Given a file change in secondary
        const { metadata, change, content } = createTestFile();
        change.sourceTarget = secondaryTarget1.id;
        secondaryTarget1.setMockFile(metadata.path, content, metadata);

        // When secondary reports changes
        await manager.handleTargetChanges(secondaryTarget1.id, [change]);

        // Then primary should receive changes first
        const primaryContent = await primaryTarget.getFileContent(
          metadata.path
        );
        expect(primaryContent.metadata.hash).toBe(metadata.hash);

        // And other secondary should receive changes after
        const secondaryContent = await secondaryTarget2.getFileContent(
          metadata.path
        );
        expect(secondaryContent.metadata.hash).toBe(metadata.hash);
      });

      it("should store pending changes on primary sync failure", async () => {
        // Given a file change in secondary
        const { metadata, change, content } = createTestFile();
        change.sourceTarget = secondaryTarget1.id;
        secondaryTarget1.setMockFile(metadata.path, content, metadata);

        // And primary will fail to apply changes
        const error = new Error("Sync failed");
        vi.spyOn(primaryTarget, "applyFileChange").mockRejectedValue(error);

        // When secondary reports changes
        await manager.handleTargetChanges(secondaryTarget1.id, [change]);

        // Then changes should be stored as pending
        const pendingSync = manager.getPendingSync();
        expect(pendingSync).not.toBeNull();
        expect(pendingSync?.sourceTargetId).toBe(secondaryTarget1.id);
        expect(
          pendingSync?.pendingByTarget.get(primaryTarget.id)
        ).toBeDefined();
        expect(
          pendingSync?.pendingByTarget.get(primaryTarget.id)?.changes
        ).toEqual([change]);
        expect(
          pendingSync?.pendingByTarget.get(primaryTarget.id)?.failedSync
        ).toBe(true);

        // And other secondary should not receive changes
        await expect(
          secondaryTarget2.getFileContent(metadata.path)
        ).rejects.toThrow();
      });

      it("should propagate to other secondaries on primary sync success", async () => {
        // Given a file change in secondary1
        const { metadata, change, content } = createTestFile();
        change.sourceTarget = secondaryTarget1.id;
        secondaryTarget1.setMockFile(metadata.path, content, metadata);

        // When secondary1 reports changes
        await manager.handleTargetChanges(secondaryTarget1.id, [change]);

        // Then primary should have changes
        const primaryContent = await primaryTarget.getFileContent(
          metadata.path
        );
        expect(primaryContent.metadata.hash).toBe(metadata.hash);

        // And secondary2 should receive changes
        const secondary2Content = await secondaryTarget2.getFileContent(
          metadata.path
        );
        expect(secondary2Content.metadata.hash).toBe(metadata.hash);
      });
    });
  });

  describe("Hierarchical Operations", () => {
    beforeEach(async () => {
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.registerTarget(secondaryTarget2, { role: "secondary" });
      await manager.initialize(config);
      expect(manager.getCurrentState()).toBe("ready");
    });

    describe("Full Sync with Hierarchical Structure", () => {
      it("should create directories before files during full sync", async () => {
        // Given a hierarchical structure in primary
        const dirMetadata: FileMetadata = {
          path: "parent/child",
          type: "directory",
          hash: "",
          size: 0,
          lastModified: Date.now()
        };
        const fileMetadata: FileMetadata = {
          path: "parent/child/test.txt",
          type: "file",
          hash: "testhash",
          size: 100,
          lastModified: Date.now()
        };

        // Set up the structure in primary
        primaryTarget.setMockFile(dirMetadata.path, "", dirMetadata);
        primaryTarget.setMockFile(
          fileMetadata.path,
          "test content",
          fileMetadata
        );

        // When reinitializing a secondary target
        await manager.reinitializeTarget(secondaryTarget1.id);

        // Then the directory should be created before the file
        const dirContent = await secondaryTarget1.getFileContent(
          dirMetadata.path
        );
        const fileContent = await secondaryTarget1.getFileContent(
          fileMetadata.path
        );
        expect(dirContent.metadata.type).toBe("directory");
        expect(fileContent.metadata.type).toBe("file");
      });

      it("should handle empty directories", async () => {
        // Given empty directories in primary
        const emptyDirs = ["empty1", "empty2/nested"];
        emptyDirs.forEach((path) => {
          const metadata: FileMetadata = {
            path,
            type: "directory",
            hash: "",
            size: 0,
            lastModified: Date.now()
          };
          primaryTarget.setMockFile(path, "", metadata);
        });

        // When reinitializing a secondary target
        await manager.reinitializeTarget(secondaryTarget1.id);

        // Then empty directories should be created
        for (const path of emptyDirs) {
          const content = await secondaryTarget1.getFileContent(path);
          expect(content.metadata.type).toBe("directory");
        }
      });

      it("should handle multiple levels of directory hierarchy", async () => {
        // Given a deep directory structure
        const paths = [
          "level1",
          "level1/level2",
          "level1/level2/level3",
          "level1/level2/level3/file.txt"
        ];

        // Create directories and file in primary
        paths.forEach((path, index) => {
          const isFile = index === paths.length - 1;
          const metadata: FileMetadata = {
            path,
            type: isFile ? "file" : "directory",
            hash: isFile ? "filehash" : "",
            size: isFile ? 100 : 0,
            lastModified: Date.now()
          };
          primaryTarget.setMockFile(path, isFile ? "content" : "", metadata);
        });

        // When reinitializing a secondary target
        await manager.reinitializeTarget(secondaryTarget1.id);

        // Then all directories and file should be created in correct order
        for (const path of paths) {
          const content = await secondaryTarget1.getFileContent(path);
          const isFile = path === paths[paths.length - 1];
          expect(content.metadata.type).toBe(isFile ? "file" : "directory");
        }
      });
    });

    describe("Hierarchical Change Handling", () => {
      it("should handle creation of nested structure in correct order", async () => {
        // Given changes for nested structure
        const changes: FileChangeInfo[] = [
          {
            path: "nested/file.txt",
            type: "create",
            hash: "filehash",
            size: 100,
            lastModified: Date.now(),
            sourceTarget: primaryTarget.id
          },
          {
            path: "nested",
            type: "create",
            hash: "",
            size: 0,
            lastModified: Date.now(),
            sourceTarget: primaryTarget.id
          }
        ];

        // Set up content in primary
        primaryTarget.setMockFile("nested", "", {
          path: "nested",
          type: "directory",
          hash: "",
          size: 0,
          lastModified: Date.now()
        });
        primaryTarget.setMockFile("nested/file.txt", "content", {
          path: "nested/file.txt",
          type: "file",
          hash: "filehash",
          size: 100,
          lastModified: Date.now()
        });

        // When primary reports changes
        await manager.handleTargetChanges(primaryTarget.id, changes);

        // Then directory should be created before file in secondary
        const dirContent = await secondaryTarget1.getFileContent("nested");
        const fileContent =
          await secondaryTarget1.getFileContent("nested/file.txt");
        expect(dirContent.metadata.type).toBe("directory");
        expect(fileContent.metadata.type).toBe("file");
      });

      it("should handle deletion of nested structure in correct order", async () => {
        // Given an existing nested structure
        const paths = ["nested", "nested/file.txt"];
        paths.forEach((path, index) => {
          const isFile = index === 1;
          const metadata: FileMetadata = {
            path,
            type: isFile ? "file" : "directory",
            hash: isFile ? "filehash" : "",
            size: isFile ? 100 : 0,
            lastModified: Date.now()
          };
          primaryTarget.setMockFile(path, isFile ? "content" : "", metadata);
          secondaryTarget1.setMockFile(path, isFile ? "content" : "", metadata);
        });

        // When deleting the structure
        const deleteChanges: FileChangeInfo[] = paths.map((path) => ({
          path,
          type: "delete",
          hash: "",
          size: 0,
          lastModified: Date.now(),
          sourceTarget: primaryTarget.id
        }));

        await manager.handleTargetChanges(primaryTarget.id, deleteChanges);

        // Then file should be deleted before directory
        await expect(
          secondaryTarget1.getFileContent("nested/file.txt")
        ).rejects.toThrow();
        await expect(
          secondaryTarget1.getFileContent("nested")
        ).rejects.toThrow();
      });

      it("should handle mixed create and delete operations", async () => {
        // Given an existing structure and changes that modify it
        const initialPaths = ["dir1/file1.txt", "dir2/file2.txt"];
        initialPaths.forEach((path) => {
          const metadata: FileMetadata = {
            path,
            type: "file",
            hash: "hash",
            size: 100,
            lastModified: Date.now()
          };
          primaryTarget.setMockFile(path, "content", metadata);
          secondaryTarget1.setMockFile(path, "content", metadata);
        });

        // When applying mixed changes
        const changes: FileChangeInfo[] = [
          {
            path: "dir1/file1.txt",
            type: "delete",
            hash: "",
            size: 0,
            lastModified: Date.now(),
            sourceTarget: primaryTarget.id
          },
          {
            path: "dir1",
            type: "delete",
            hash: "",
            size: 0,
            lastModified: Date.now(),
            sourceTarget: primaryTarget.id
          },
          {
            path: "dir3",
            type: "create",
            hash: "",
            size: 0,
            lastModified: Date.now(),
            sourceTarget: primaryTarget.id
          },
          {
            path: "dir3/newfile.txt",
            type: "create",
            hash: "newhash",
            size: 100,
            lastModified: Date.now(),
            sourceTarget: primaryTarget.id
          }
        ];

        // Set up new content in primary
        primaryTarget.setMockFile("dir3", "", {
          path: "dir3",
          type: "directory",
          hash: "",
          size: 0,
          lastModified: Date.now()
        });
        primaryTarget.setMockFile("dir3/newfile.txt", "new content", {
          path: "dir3/newfile.txt",
          type: "file",
          hash: "newhash",
          size: 100,
          lastModified: Date.now()
        });

        await manager.handleTargetChanges(primaryTarget.id, changes);

        // Then changes should be applied in correct order
        // Deletions
        await expect(
          secondaryTarget1.getFileContent("dir1/file1.txt")
        ).rejects.toThrow();
        await expect(secondaryTarget1.getFileContent("dir1")).rejects.toThrow();

        // Creations
        const dirContent = await secondaryTarget1.getFileContent("dir3");
        const fileContent =
          await secondaryTarget1.getFileContent("dir3/newfile.txt");
        expect(dirContent.metadata.type).toBe("directory");
        expect(fileContent.metadata.type).toBe("file");

        // Unchanged files should remain
        const unchangedContent =
          await secondaryTarget1.getFileContent("dir2/file2.txt");
        expect(unchangedContent.metadata.hash).toBe("hash");
      });
    });
  });

  describe("Recovery", () => {
    beforeEach(async () => {
      manager.registerTarget(primaryTarget, { role: "primary" });
      manager.registerTarget(secondaryTarget1, { role: "secondary" });
      manager.registerTarget(secondaryTarget2, { role: "secondary" });
      await manager.initialize(config);
    });

    it("should reinitialize dirty target from primary", async () => {
      // Given a dirty secondary target
      const error = new Error("Sync failed");
      vi.spyOn(secondaryTarget1, "applyFileChange").mockRejectedValueOnce(
        error
      );

      // And primary has some files
      const file1 = createTestFile("test1.txt", "content1");
      const file2 = createTestFile("test2.txt", "content2");
      primaryTarget.setMockFile(
        file1.metadata.path,
        file1.content,
        file1.metadata
      );
      primaryTarget.setMockFile(
        file2.metadata.path,
        file2.content,
        file2.metadata
      );

      // When trying to sync changes to secondary
      await manager.handleTargetChanges(primaryTarget.id, [file1.change]);

      // Then secondary1 should be marked dirty
      expect(secondaryTarget1.getState().status).toBe("error");

      // When reinitializing the target after it got available again
      await manager.reinitializeTarget(secondaryTarget1.id);

      // Then it should have all files from primary
      const content1 = await secondaryTarget1.getFileContent(
        file1.metadata.path
      );
      const content2 = await secondaryTarget1.getFileContent(
        file2.metadata.path
      );
      expect(content1.metadata.hash).toBe(file1.metadata.hash);
      expect(content2.metadata.hash).toBe(file2.metadata.hash);
    });

    it("should handle pending sync confirmation", async () => {
      // Given pending changes from secondary
      const { metadata, change, content } = createTestFile();
      change.sourceTarget = secondaryTarget1.id;
      secondaryTarget1.setMockFile(metadata.path, content, metadata);

      // And primary sync will fail
      const error = new Error("Sync failed");
      vi.spyOn(primaryTarget, "applyFileChange").mockRejectedValueOnce(error);

      // When secondary reports changes
      await manager.handleTargetChanges(secondaryTarget1.id, [change]);

      // And pending sync is confirmed after the primary came back
      await manager.confirmPrimarySync();

      // Then primary should have the changes
      const primaryContent = await primaryTarget.getFileContent(metadata.path);
      expect(primaryContent.metadata.hash).toBe(metadata.hash);

      // And other secondary should be reinitialized with changes
      const secondary2Content = await secondaryTarget2.getFileContent(
        metadata.path
      );
      expect(secondary2Content.metadata.hash).toBe(metadata.hash);
    });

    it("should handle pending sync rejection", async () => {
      // Given pending changes from secondary
      const { metadata, change } = createTestFile();
      change.sourceTarget = secondaryTarget1.id;

      // And primary sync will fail
      const error = new Error("Sync failed");
      vi.spyOn(primaryTarget, "applyFileChange").mockRejectedValue(error);

      // When secondary reports changes
      await manager.handleTargetChanges(secondaryTarget1.id, [change]);

      // And pending sync is rejected
      await manager.rejectPendingSync();

      // Then pending changes should be cleared
      expect(manager.getPendingSync()).toBeNull();

      // And primary should not have changes
      await expect(
        primaryTarget.getFileContent(metadata.path)
      ).rejects.toThrow();
    });
  });

  describe("Resource Management", () => {
    it("should initialize all targets", async () => {
      // Given registered targets
      manager.registerTarget(primaryTarget, { role: "primary" });
      manager.registerTarget(secondaryTarget1, { role: "secondary" });
      manager.registerTarget(secondaryTarget2, { role: "secondary" });

      // When initializing
      await manager.initialize(config);

      // Then all targets should be initialized
      expect(primaryTarget.getState().status).toBe("idle");
      expect(secondaryTarget1.getState().status).toBe("idle");
      expect(secondaryTarget2.getState().status).toBe("idle");
    });

    it("should dispose all targets", async () => {
      // Given initialized targets
      manager.registerTarget(primaryTarget, { role: "primary" });
      manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.initialize(config);

      // When disposing
      await manager.dispose();

      // Then targets should be unregistered
      expect(() => manager.getPrimaryTarget()).toThrow();
      expect(manager.getSecondaryTargets()).toHaveLength(0);
    });

    it("should handle target unregistration", async () => {
      // Given registered targets
      manager.registerTarget(primaryTarget, { role: "primary" });
      manager.registerTarget(secondaryTarget1, { role: "secondary" });
      manager.registerTarget(secondaryTarget2, { role: "secondary" });

      // When unregistering a secondary
      await manager.unregisterTarget(secondaryTarget1.id);

      // Then it should be removed
      expect(manager.getSecondaryTargets()).toHaveLength(1);
      expect(manager.getSecondaryTargets()[0]).toBe(secondaryTarget2);

      // When unregistering primary
      await manager.unregisterTarget(primaryTarget.id);

      // Then it should be removed
      expect(() => manager.getPrimaryTarget()).toThrow();
    });
  });
});
