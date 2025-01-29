import { describe, beforeEach, it, expect, vi } from "vitest";
import {
  type SyncTarget,
  type FileMetadata,
  type FileContentStream,
  type FileChangeInfo,
  type TargetState,
  type SyncManagerConfig,
  type FileChunk,
  SyncManagerError,
  FileSystem,
  FileSystemItem
} from "@piddie/shared-types";
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
    return [];
  }

  async initialize(): Promise<void> {
    // Mock implementation
  }

  async notifyIncomingChanges(): Promise<void> {
    this.state.status = "notifying";
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
    metadata: FileMetadata,
    contentStream: FileContentStream
  ): Promise<null> {
    const reader = contentStream.getReader();
    let content = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += value.content;
      }
    } finally {
      reader.releaseLock();
    }

    this.mockFiles.set(metadata.path, {
      content,
      metadata
    });
    return null;
  }

  async syncComplete(): Promise<boolean> {
    this.state.status = "idle";
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
      maxBatchSize: 10,
      maxRetries: 3
    };

    manager = new FileSyncManager();
  });

  describe("Target Registration", () => {
    it("should register primary target successfully", async () => {
      // Given an initialized primary target
      primaryTarget.getState().status = "idle";

      // When registering a primary target
      manager.registerTarget(primaryTarget, { role: "primary" });

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
      manager.registerTarget(primaryTarget, { role: "primary" });
      manager.registerTarget(secondaryTarget1, { role: "secondary" });
      manager.registerTarget(secondaryTarget2, { role: "secondary" });

      // Then they should be accessible
      expect(manager.getPrimaryTarget()).toBe(primaryTarget);
      const secondaries = manager.getSecondaryTargets();
      expect(secondaries).toHaveLength(2);
      expect(secondaries).toContain(secondaryTarget1);
      expect(secondaries).toContain(secondaryTarget2);
    });

    it("should reject uninitialized primary target", () => {
      // Given an uninitialized primary target
      primaryTarget.getState().status = "error";

      // When trying to register
      // Then it should throw
      expect(() =>
        manager.registerTarget(primaryTarget, { role: "primary" })
      ).toThrow(
        new SyncManagerError(
          "Target primary is not initialized",
          "SOURCE_NOT_AVAILABLE"
        )
      );
    });

    it("should reject uninitialized secondary target", () => {
      // Given an initialized primary and uninitialized secondary
      primaryTarget.getState().status = "idle";
      secondaryTarget1.getState().status = "error";

      // When registering primary and trying to register secondary
      manager.registerTarget(primaryTarget, { role: "primary" });

      // Then it should throw
      expect(() =>
        manager.registerTarget(secondaryTarget1, { role: "secondary" })
      ).toThrow(
        new SyncManagerError(
          "Target secondary1 is not initialized",
          "SOURCE_NOT_AVAILABLE"
        )
      );
    });

    it("should throw error when registering second primary target", () => {
      // Given an existing initialized primary target
      primaryTarget.getState().status = "idle";
      secondaryTarget1.getState().status = "idle";
      manager.registerTarget(primaryTarget, { role: "primary" });

      // When trying to register another primary
      // Then it should throw
      expect(() =>
        manager.registerTarget(secondaryTarget1, { role: "primary" })
      ).toThrow("Primary target already exists");
    });

    it("should throw error when registering duplicate target id", () => {
      // Given a target with ID 'test'
      const target1 = new MockSyncTarget("test", "local");
      const target2 = new MockSyncTarget("test", "browser");
      target1.getState().status = "idle";
      target2.getState().status = "idle";
      manager.registerTarget(target1, { role: "primary" });

      // When trying to register another target with same ID
      // Then it should throw
      expect(() =>
        manager.registerTarget(target2, { role: "secondary" })
      ).toThrow("Target with ID test already exists");
    });

    it("should throw error when registering target with invalid role", () => {
      // Given an initialized target
      primaryTarget.getState().status = "idle";

      // When trying to register with invalid role
      expect(() =>
        manager.registerTarget(primaryTarget, { role: "invalid" as any })
      ).toThrow("Invalid target role");
    });
  });

  describe("Change Handling", () => {
    beforeEach(async () => {
      manager.registerTarget(primaryTarget, { role: "primary" });
      manager.registerTarget(secondaryTarget1, { role: "secondary" });
      manager.registerTarget(secondaryTarget2, { role: "secondary" });
      await manager.initialize(config);
    });

    describe("Primary Target Changes", () => {
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
        expect(pendingSync?.changes).toEqual([change]);
        expect(pendingSync?.failedPrimarySync).toBe(true);

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
      manager.unregisterTarget(secondaryTarget1.id);

      // Then it should be removed
      expect(manager.getSecondaryTargets()).toHaveLength(1);
      expect(manager.getSecondaryTargets()[0]).toBe(secondaryTarget2);

      // When unregistering primary
      manager.unregisterTarget(primaryTarget.id);

      // Then it should be removed
      expect(() => manager.getPrimaryTarget()).toThrow();
    });
  });
});
