import { describe, beforeEach, it, expect, vi, afterEach } from "vitest";
import type {
  SyncTarget,
  FileMetadata,
  FileContentStream,
  FileChangeInfo,
  TargetState,
  FileSystemItem,
  FileConflict,
  SyncTargetType,
  SyncProgressEvent,
  IgnoreService
} from "@piddie/shared-types";
import { SyncManagerStateType } from "@piddie/shared-types";
import { FileSyncManager } from "../src/FileSyncManager";
import { DefaultIgnoreService } from "../src/DefaultIgnoreService";

class MockFileContentStream implements FileContentStream {
  stream: ReadableStream<Uint8Array>;
  metadata: FileMetadata;
  lastModified: number;
  private content: Uint8Array;
  getReader: () => ReadableStreamDefaultReader<Uint8Array> = () =>
    this.stream.getReader();

  constructor(content: Uint8Array, metadata: FileMetadata) {
    this.metadata = metadata;
    this.content = content;
    this.stream = this.createStream();
    this.lastModified = metadata.lastModified || Date.now();
  }

  private createStream(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(this.content);
        controller.close();
      }
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

class MockSyncTarget implements SyncTarget {
  id: string;
  type: SyncTargetType;
  private state: TargetState;
  private watchCallback: ((changes: FileChangeInfo[]) => void) | null = null;
  private mockFiles: Map<
    string,
    { content: Uint8Array; metadata: FileMetadata }
  > = new Map();

  setIgnoreService = vi.fn();

  constructor(id: string, type: SyncTargetType) {
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
        if (!relativePath.includes("/") || file.metadata.type === "directory") {
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

    // Return empty content for directories
    if (file.metadata.type === "directory") {
      return new MockFileContentStream(new Uint8Array(), file.metadata);
    }

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

    const isDirectory =
      changeInfo.metadata.hash === "" && changeInfo.metadata.size === 0;
    let content = new Uint8Array();

    // Only process content stream for files
    if (!isDirectory) {
      if (!contentStream) {
        throw new Error("Content stream required for file operations");
      }

      const reader = contentStream.stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content = new Uint8Array([...content, ...value]);
        }
      } finally {
        reader.releaseLock();
      }
    }

    this.mockFiles.set(changeInfo.path, {
      content,
      metadata: {
        path: changeInfo.path,
        type: isDirectory ? "directory" : "file",
        hash: changeInfo.metadata.hash,
        size: changeInfo.metadata.size,
        lastModified: changeInfo.metadata.lastModified
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
    // Create parent directories if they don't exist
    const parts = path.split("/");
    if (parts.length > 1) {
      const dirPath = parts.slice(0, -1).join("/");
      const dirMetadata: FileMetadata = {
        path: dirPath,
        type: "directory",
        hash: "",
        size: 0,
        lastModified: Date.now()
      };
      this.mockFiles.set(dirPath, {
        content: new Uint8Array(),
        metadata: dirMetadata
      });
    }

    // Set the actual file with correct type
    const fileMetadata = {
      ...metadata,
      type:
        metadata.type ||
        ((path.includes(".") ? "file" : "directory") as FileMetadata["type"])
    };
    const textEncoder = new TextEncoder();
    const encodedContent = textEncoder.encode(content);
    this.mockFiles.set(path, {
      content: encodedContent,
      metadata: fileMetadata
    });
  }
}

// Helper function to create mock targets
function createMockTarget(id: string): MockSyncTarget {
  return new MockSyncTarget(id, "node-fs");
}

describe("FileSyncManager", () => {
  let primaryTarget: MockSyncTarget;
  let secondaryTarget1: MockSyncTarget;
  let secondaryTarget2: MockSyncTarget;
  let manager: FileSyncManager;
  let progressEvents: SyncProgressEvent[];

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
      path,
      metadata,
      type: "modify",
      sourceTarget: primaryTarget.id
    };

    return { metadata, change, content };
  };

  beforeEach(async () => {
    primaryTarget = new MockSyncTarget("primary", "node-fs");
    secondaryTarget1 = new MockSyncTarget("secondary1", "browser-fs");
    secondaryTarget2 = new MockSyncTarget("secondary2", "container-fs");
    manager = new FileSyncManager();
    progressEvents = [];
    await manager.initialize();
  });

  describe("Target Registration", () => {
    it("should allow uninitialized primary target while remaining ready", async () => {
      // Given an uninitialized primary target
      const uninitializedTarget = createMockTarget("primary");
      vi.spyOn(uninitializedTarget, "getState").mockReturnValue({
        id: "primary",
        type: "node-fs",
        status: "uninitialized",
        lockState: { isLocked: false },
        pendingChanges: 0
      });

      // When registering the target
      await manager.registerTarget(uninitializedTarget, { role: "primary" });

      // Then the sync manager should remain ready
      expect(manager.getCurrentState()).toBe("ready");
      // But the target should be in uninitialized state
      expect(uninitializedTarget.getState().status).toBe("uninitialized");
    });

    it("should allow uninitialized secondary target while remaining ready", async () => {
      // Given a primary target and an uninitialized secondary
      await manager.registerTarget(primaryTarget, { role: "primary" });
      const uninitializedSecondary = createMockTarget("secondary");
      vi.spyOn(uninitializedSecondary, "getState").mockReturnValue({
        id: "secondary",
        type: "browser-fs",
        status: "uninitialized",
        lockState: { isLocked: false },
        pendingChanges: 0
      });

      // When registering the uninitialized secondary
      await manager.registerTarget(uninitializedSecondary, {
        role: "secondary"
      });

      // Then the sync manager should remain ready
      expect(manager.getCurrentState()).toBe("ready");
      // And the secondary should be in uninitialized state
      expect(uninitializedSecondary.getState().status).toBe("uninitialized");
    });

    it.skip("should allow changes to pile up for uninitialized target", async () => {
      // Given a primary and an uninitialized secondary
      await manager.registerTarget(primaryTarget, { role: "primary" });
      const uninitializedSecondary = createMockTarget("secondary");
      vi.spyOn(uninitializedSecondary, "getState").mockReturnValue({
        id: "secondary",
        type: "browser-fs",
        status: "uninitialized",
        lockState: { isLocked: false },
        pendingChanges: 0
      });
      await manager.registerTarget(uninitializedSecondary, {
        role: "secondary"
      });

      // When changes occur in primary
      const { change } = createTestFile();
      await manager.handleTargetChanges(primaryTarget.id, [change]);

      // Then changes should pile up for the uninitialized target
      expect(uninitializedSecondary.getState().pendingChanges).toBeGreaterThan(
        0
      );
      // And sync manager should remain ready
      expect(manager.getCurrentState()).toBe("ready");
    });

    it.skip("should apply pending changes when target becomes initialized", async () => {
      // Given an uninitialized secondary with pending changes
      await manager.registerTarget(primaryTarget, { role: "primary" });
      const uninitializedSecondary = createMockTarget("secondary");
      vi.spyOn(uninitializedSecondary, "getState").mockReturnValue({
        id: "secondary",
        type: "browser-fs",
        status: "uninitialized",
        lockState: { isLocked: false },
        pendingChanges: 1
      });
      await manager.registerTarget(uninitializedSecondary, {
        role: "secondary"
      });

      // When the target becomes initialized
      vi.spyOn(uninitializedSecondary, "getState").mockReturnValue({
        id: "secondary",
        type: "browser-fs",
        status: "idle",
        lockState: { isLocked: false },
        pendingChanges: 1
      });

      // And we recover the target
      await manager.recoverTarget(uninitializedSecondary.id, "fromPrimary");

      // Then pending changes should be applied
      expect(uninitializedSecondary.getState().pendingChanges).toBe(0);
      expect(manager.getCurrentState()).toBe("ready");
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
        manager.validateStateTransition(
          "resolving",
          "ready",
          "conflictResolved"
        )
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
      await manager.initialize();

      // Then state should be ready
      expect(manager.getCurrentState()).toBe("ready");
    });
  });

  it("should transition through states during sync", async () => {
    // Given an initialized manager
    await manager.registerTarget(primaryTarget, { role: "primary" });
    await manager.registerTarget(secondaryTarget1, { role: "secondary" });
    expect(manager.getCurrentState()).toBe("ready");

    // When primary reports changes
    const { change } = createTestFile();
    const syncPromise = manager.handleTargetChanges(primaryTarget.id, [change]);

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

    // When a critical error occurs (simulate by forcing invalid state transition)
    try {
      manager.transitionTo("invalid" as SyncManagerStateType, "someAction");
    } catch {
      // Expected
    }

    // Then state should be error
    expect(manager.getCurrentState()).toBe("error");
  });

  describe("Change Handling", () => {
    beforeEach(async () => {
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.registerTarget(secondaryTarget2, { role: "secondary" });
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
        const [metadata1] = await secondaryTarget1.getMetadata([metadata.path]);
        const [metadata2] = await secondaryTarget2.getMetadata([metadata.path]);
        expect(metadata1!.hash).toBe(metadata.hash);
        expect(metadata2!.hash).toBe(metadata.hash);
      });

      it("should handle secondary sync failure by marking target as dirty", async () => {
        // Given a file change in primary
        const { metadata, change, content } = createTestFile();
        primaryTarget.setMockFile(metadata.path, content, metadata);

        // And secondary1 will fail to apply changes
        const error = new Error("Sync failed");
        vi.spyOn(secondaryTarget1, "applyFileChange").mockRejectedValueOnce(
          error
        );

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
        const [primaryMetadata] = await primaryTarget.getMetadata([
          metadata.path
        ]);
        expect(primaryMetadata!.hash).toBe(metadata.hash);

        // And other secondary should receive changes after

        const [secondaryMetadata] = await secondaryTarget2.getMetadata([
          metadata.path
        ]);
        expect(secondaryMetadata!.hash).toBe(metadata.hash);
      });

      it("should store pending changes on primary sync failure", async () => {
        // Given a file change in secondary
        const { metadata, change, content } = createTestFile();
        change.sourceTarget = secondaryTarget1.id;
        secondaryTarget1.setMockFile(metadata.path, content, metadata);

        // And primary will fail to apply changes
        const error = new Error("Sync failed");
        vi.spyOn(primaryTarget, "applyFileChange").mockRejectedValueOnce(error);

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
        const [primaryMetadata] = await primaryTarget.getMetadata([
          metadata.path
        ]);
        expect(primaryMetadata!.hash).toBe(metadata.hash);

        // And secondary2 should receive changes
        const [secondary2Metadata] = await secondaryTarget2.getMetadata([
          metadata.path
        ]);
        expect(secondary2Metadata!.hash).toBe(metadata.hash);
      });
    });
  });

  describe("Hierarchical Operations", () => {
    beforeEach(async () => {
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.registerTarget(secondaryTarget2, { role: "secondary" });
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
        await manager.fullSyncFromPrimaryToTarget(secondaryTarget1);

        // Then the directory should be created before the file
        const [dirContent] = await secondaryTarget1.getMetadata([
          dirMetadata.path
        ]);
        const [fileContent] = await secondaryTarget1.getMetadata([
          fileMetadata.path
        ]);
        expect(dirContent!.type).toBe("directory");
        expect(fileContent!.type).toBe("file");
      });

      it("should handle empty directories", async () => {
        // Given empty directories in primary
        const emptyDirs = ["empty1", "empty1/nested"];
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
        await manager.fullSyncFromPrimaryToTarget(secondaryTarget1);

        // Then empty directories should be created
        for (const path of emptyDirs) {
          const [metadata] = await secondaryTarget1.getMetadata([path]);
          expect(metadata!.type).toBe("directory");
          expect(metadata!.path).toBe(path);
          expect(metadata!.hash).toBe("");
          expect(metadata!.size).toBe(0);
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
        await manager.fullSyncFromPrimaryToTarget(secondaryTarget1);

        // Then all directories and file should be created in correct order
        for (const path of paths) {
          const isFile = path === paths[paths.length - 1];
          const [metadata] = await secondaryTarget1.getMetadata([path]);
          expect(metadata!.type).toBe(isFile ? "file" : "directory");
          expect(metadata!.path).toBe(path);
          if (isFile) {
            expect(metadata!.hash).toBe("filehash");
            expect(metadata!.size).toBe(100);
            // Verify file content
            const content = await secondaryTarget1.getFileContent(path);
            const reader = content.stream.getReader();
            const { value } = await reader.read();
            expect(Buffer.from(value!)).toEqual(Buffer.from("content"));
          } else {
            expect(metadata!.hash).toBe("");
            expect(metadata!.size).toBe(0);
          }
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
            metadata: {
              path: "nested/file.txt",
              type: "file",
              hash: "filehash",
              size: 100,
              lastModified: Date.now()
            },
            sourceTarget: primaryTarget.id
          },
          {
            path: "nested",
            type: "create",
            metadata: {
              path: "nested",
              type: "directory",
              hash: "",
              size: 0,
              lastModified: Date.now()
            },
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
        const [dirMetadata] = await secondaryTarget1.getMetadata(["nested"]);
        const [fileMetadata] = await secondaryTarget1.getMetadata([
          "nested/file.txt"
        ]);
        expect(dirMetadata!.type).toBe("directory");
        expect(fileMetadata!.type).toBe("file");
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
        const deleteChanges: FileChangeInfo[] = paths.map((path, index) => {
          const isFile = index === 1;
          const metadata: FileMetadata = {
            path,
            type: isFile ? "file" : "directory",
            hash: isFile ? "filehash" : "",
            size: isFile ? 100 : 0,
            lastModified: Date.now()
          };
          return {
            path,
            type: "delete",
            metadata,
            sourceTarget: primaryTarget.id
          };
        });

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
            metadata: {
              path: "dir1/file1.txt",
              type: "file",
              hash: "",
              size: 0,
              lastModified: Date.now()
            },
            sourceTarget: primaryTarget.id
          },
          {
            path: "dir1",
            type: "delete",
            metadata: {
              path: "dir1",
              type: "directory",
              hash: "",
              size: 0,
              lastModified: Date.now()
            },
            sourceTarget: primaryTarget.id
          },
          {
            path: "dir3",
            type: "create",
            metadata: {
              path: "dir3",
              type: "directory",
              hash: "",
              size: 0,
              lastModified: Date.now()
            },
            sourceTarget: primaryTarget.id
          },
          {
            path: "dir3/newfile.txt",
            type: "create",
            metadata: {
              path: "dir3/newfile.txt",
              type: "file",
              hash: "newhash",
              size: 100,
              lastModified: Date.now()
            },
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
        const [dir3Metadata] = await secondaryTarget1.getMetadata(["dir3"]);
        const [newFileMetadata] = await secondaryTarget1.getMetadata([
          "dir3/newfile.txt"
        ]);
        expect(dir3Metadata!.type).toBe("directory");
        expect(newFileMetadata!.type).toBe("file");

        // Unchanged files should remain
        const [unchangedMetadata] = await secondaryTarget1.getMetadata([
          "dir2/file2.txt"
        ]);
        expect(unchangedMetadata!.hash).toBe("hash");
      });

      it("should sync a folder and its contents properly from secondary to primary", async () => {
        // Define metadata for the new folder
        const folderPath = "new-folder";
        const folderMetadata: FileMetadata = {
          path: folderPath,
          type: "directory",
          hash: "",
          size: 0,
          lastModified: Date.now()
        };

        // Create the new folder in the secondary target
        secondaryTarget1.setMockFile(folderPath, "", folderMetadata);

        // Define metadata and content for the new file within the folder
        const filePath = `${folderPath}/file.txt`;
        const fileContent = "This is a test file.";
        const fileMetadata: FileMetadata = {
          path: filePath,
          type: "file",
          hash: "testfilehash",
          size: fileContent.length,
          lastModified: Date.now()
        };

        // Create the new file in the secondary target
        secondaryTarget1.setMockFile(filePath, fileContent, fileMetadata);

        // Define the changes to be handled
        const changes: FileChangeInfo[] = [
          {
            path: folderPath,
            type: "create",
            metadata: folderMetadata,
            sourceTarget: secondaryTarget1.id
          },
          {
            path: filePath,
            type: "create",
            metadata: fileMetadata,
            sourceTarget: secondaryTarget1.id
          }
        ];

        // When the secondary target reports changes
        await manager.handleTargetChanges(secondaryTarget1.id, changes);

        // Then the primary target should have the new folder
        const [primaryFolderMetadata] = await primaryTarget.getMetadata([
          folderPath
        ]);
        expect(primaryFolderMetadata!.type).toBe("directory");
        expect(primaryFolderMetadata!.path).toBe(folderPath);

        // And the primary target should have the new file within the folder
        const [primaryFileMetadata] = await primaryTarget.getMetadata([
          filePath
        ]);
        expect(primaryFileMetadata!.type).toBe("file");
        expect(primaryFileMetadata!.path).toBe(filePath);
        expect(primaryFileMetadata!.hash).toBe(fileMetadata.hash);
        expect(primaryFileMetadata!.size).toBe(fileMetadata.size);

        // Additionally, verify the content of the file in the primary target
        const primaryFileContentStream =
          await primaryTarget.getFileContent(filePath);
        const reader = primaryFileContentStream.stream.getReader();
        const { value, done } = await reader.read();
        expect(done).toBe(false);
        const textDecoder = new TextDecoder();
        const actualContent = textDecoder.decode(value);
        expect(actualContent).toEqual(fileContent);
      });
    });
  });

  describe("Full Sync Operations", () => {
    beforeEach(async () => {
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
    });

    it("should perform a full sync from primary to target", async () => {
      // Given files in primary target
      const primaryFiles = [
        { path: "file1.txt", content: "content1" },
        { path: "dir1/file2.txt", content: "content2" },
        { path: "dir1/subdir/file3.txt", content: "content3" }
      ];

      // And existing files in secondary target that should be deleted
      const secondaryFiles = [
        { path: "old-file.txt", content: "old content" },
        { path: "old-dir/old-file2.txt", content: "old content 2" }
      ];

      // Setup primary target files
      for (const file of primaryFiles) {
        primaryTarget.setMockFile(file.path, file.content, {
          path: file.path,
          type: file.path.includes(".") ? "file" : "directory",
          hash: "mock-hash",
          size: file.content.length,
          lastModified: Date.now()
        });
      }

      // Setup secondary target files
      for (const file of secondaryFiles) {
        secondaryTarget1.setMockFile(file.path, file.content, {
          path: file.path,
          type: file.path.includes("/") ? "directory" : "file",
          hash: "mock-hash",
          size: file.content.length,
          lastModified: Date.now()
        });
      }

      // When performing a full sync
      await manager.fullSyncFromPrimaryToTarget(secondaryTarget1);

      // Then old files should be deleted
      for (const file of secondaryFiles) {
        await expect(
          secondaryTarget1.getMetadata([file.path])
        ).rejects.toThrow();
      }

      // And new files should be copied
      for (const file of primaryFiles) {
        const [metadata] = await secondaryTarget1.getMetadata([file.path]);
        expect(metadata!.type).toBe(
          file.path.includes(".") ? "file" : "directory"
        );
        const content = await secondaryTarget1.getFileContent(file.path);
        const reader = content.stream.getReader();
        const { value, done } = await reader.read();
        expect(done).toBe(false);
        const textDecoder = new TextDecoder();
        const actualContent = textDecoder.decode(value);
        expect(actualContent).toEqual(file.content);
      }
    });

    it("should handle empty source and target directories", async () => {
      // When performing a full sync with empty directories
      await manager.fullSyncFromPrimaryToTarget(secondaryTarget1);

      // Then it should complete without error
      const primaryFiles = await primaryTarget.listDirectory("/");
      const secondaryFiles = await secondaryTarget1.listDirectory("/");
      expect(primaryFiles).toHaveLength(0);
      expect(secondaryFiles).toHaveLength(0);
    });

    it("should handle sync errors gracefully", async () => {
      // Given a failing read operation in primary
      vi.spyOn(primaryTarget, "getMetadata").mockRejectedValueOnce(
        new Error("Read failed")
      );

      // And a file in primary
      primaryTarget.setMockFile("test.txt", "test content", {
        path: "test.txt",
        type: "file",
        hash: "mock-hash",
        size: 11,
        lastModified: Date.now()
      });

      // When performing a full sync
      await expect(
        manager.fullSyncFromPrimaryToTarget(secondaryTarget1)
      ).rejects.toThrow("Full sync failed");

      // Then the manager should be in error state
      expect(manager.getCurrentState()).toBe("error");
    });
  });

  describe("Recovery", () => {
    beforeEach(async () => {
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.registerTarget(secondaryTarget2, { role: "secondary" });
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

      // Then secondary1 should be marked dirty, but we mocked the target here, so there's no use to test that

      // When reinitializing the target after it got available again
      await manager.fullSyncFromPrimaryToTarget(secondaryTarget1);

      // Then it should have all files from primary
      const [metadata1] = await secondaryTarget1.getMetadata([
        file1.metadata.path
      ]);
      const [metadata2] = await secondaryTarget1.getMetadata([
        file2.metadata.path
      ]);
      expect(metadata1!.hash).toBe(file1.metadata.hash);
      expect(metadata2!.hash).toBe(file2.metadata.hash);
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
      const [primaryMetadata] = await primaryTarget.getMetadata([
        metadata.path
      ]);
      expect(primaryMetadata!.hash).toBe(metadata.hash);

      // And other secondary should be reinitialized with changes
      const [secondary2Metadata] = await secondaryTarget2.getMetadata([
        metadata.path
      ]);
      expect(secondary2Metadata!.hash).toBe(metadata.hash);
    });
  });

  describe("Progress Events", () => {
    beforeEach(async () => {
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });
      await manager.registerTarget(secondaryTarget2, { role: "secondary" });
      progressEvents = [];

      manager.addProgressListener((event) => {
        progressEvents.push(event);
      });
    });

    it("should emit syncing progress events", async () => {
      // Given a file to sync
      const { metadata, change, content } = createTestFile(
        "test.txt",
        "test content"
      );
      primaryTarget.setMockFile(metadata.path, content, metadata);

      // When changes are handled
      await manager.handleTargetChanges(primaryTarget.id, [change]);

      // Then syncing events should be emitted
      const syncingEvents = progressEvents.filter((e) => e.type === "syncing");
      expect(syncingEvents.length).toBeGreaterThan(0);

      // Verify initial syncing event
      const initialEvent = syncingEvents[0];
      expect(initialEvent).toBeDefined();
      if (initialEvent) {
        expect(initialEvent.type).toBe("syncing");
        expect(initialEvent.sourceTargetId).toBe(primaryTarget.id);
        expect(initialEvent.targetId).toBe(secondaryTarget1.id);
        expect(initialEvent.totalFiles).toBe(1);
        expect(initialEvent.syncedFiles).toBe(0);
        expect(initialEvent.currentFile).toBe("");
      }

      // Verify file syncing event
      const fileEvent = syncingEvents[1];
      expect(fileEvent).toBeDefined();
      if (fileEvent) {
        expect(fileEvent.currentFile).toBe("test.txt");
        expect(fileEvent.syncedFiles).toBe(0);
        expect(fileEvent.totalFiles).toBe(1);
      }
    });

    it.skip("should emit streaming progress events for file content", async () => {
      // Given a larger file to sync
      const content = "x".repeat(1000); // 1KB of content
      const {
        metadata,
        change,
        content: binaryContent
      } = createTestFile("large.txt", content);
      primaryTarget.setMockFile(metadata.path, binaryContent, metadata);

      // When changes are handled
      await manager.handleTargetChanges(primaryTarget.id, [change]);

      // Then streaming events should be emitted
      const streamingEvents = progressEvents.filter(
        (e) => e.type === "streaming"
      );
      expect(streamingEvents.length).toBeGreaterThan(0);

      // Verify streaming progress
      const streamEvent = streamingEvents[0];
      expect(streamEvent).toBeDefined();
      if (streamEvent) {
        expect(streamEvent.type).toBe("streaming");
        expect(streamEvent.sourceTargetId).toBe(primaryTarget.id);
        expect(streamEvent.targetId).toBe(secondaryTarget1.id);
        expect(streamEvent.totalBytes).toBe(metadata.size);
        expect(streamEvent.processedBytes).toBeGreaterThan(0);
        expect(streamEvent.currentFile).toBe("large.txt");
      }
    });

    it("should emit completion progress event", async () => {
      // Given files to sync
      const files = [
        createTestFile("file1.txt", "content 1"),
        createTestFile("file2.txt", "content 2")
      ];

      files.forEach(({ metadata, content }) => {
        primaryTarget.setMockFile(metadata.path, content, metadata);
      });

      // When changes are handled
      await manager.handleTargetChanges(
        primaryTarget.id,
        files.map((f) => f.change)
      );

      // Then completion event should be emitted
      const completionEvents = progressEvents.filter(
        (e) => e.type === "completing"
      );
      expect(completionEvents.length).toBe(2); // one for each target

      const completionEvent = completionEvents[0];
      expect(completionEvent).toBeDefined();
      if (completionEvent) {
        expect(completionEvent.type).toBe("completing");
        expect(completionEvent.sourceTargetId).toBe(primaryTarget.id);
        expect(completionEvent.targetId).toBe(secondaryTarget1.id);
        expect(completionEvent.totalFiles).toBe(2);
        expect(completionEvent.successfulFiles).toBe(2);
        expect(completionEvent.failedFiles).toBe(0);
      }
    });

    it("should emit error progress event on failure", async () => {
      // Given a file that will fail to sync
      const { metadata, change, content } = createTestFile(
        "error.txt",
        "content"
      );
      primaryTarget.setMockFile(metadata.path, content, metadata);

      // And secondary target will fail to apply changes
      const error = new Error("Sync failed");
      vi.spyOn(secondaryTarget1, "applyFileChange").mockRejectedValueOnce(
        error
      );

      // When changes are handled
      await manager.handleTargetChanges(primaryTarget.id, [change]);

      // Then error event should be emitted
      const errorEvents = progressEvents.filter((e) => e.type === "error");
      expect(errorEvents.length).toBe(2); // the actual file error and the failed sync as a whole

      const errorEvent = errorEvents[0];
      expect(errorEvent).toBeDefined();
      if (errorEvent) {
        expect(errorEvent.type).toBe("error");
        expect(errorEvent.sourceTargetId).toBe(primaryTarget.id);
        expect(errorEvent.targetId).toBe(secondaryTarget1.id);
        expect(errorEvent.currentFile).toBe("error.txt");
        expect(errorEvent.error).toBe(error);
        expect(errorEvent.phase).toBe("streaming");
      }
    });
  });

  describe("Ignore Service Propagation", () => {
    it("should propagate ignore service to targets during initialization", async () => {
      const mockPrimary = createMockTarget("primary");
      const mockSecondary = createMockTarget("secondary");
      const mockIgnoreService = new DefaultIgnoreService();

      const manager = new FileSyncManager();
      await manager.registerTarget(mockPrimary, { role: "primary" });
      await manager.registerTarget(mockSecondary, { role: "secondary" });
      await manager.initialize(mockIgnoreService);

      expect(mockPrimary.setIgnoreService).toHaveBeenCalledWith(
        mockIgnoreService
      );
      expect(mockSecondary.setIgnoreService).toHaveBeenCalledWith(
        mockIgnoreService
      );
    });

    it("should propagate ignore service to new targets after initialization", async () => {
      const mockPrimary = createMockTarget("primary");
      const mockIgnoreService = new DefaultIgnoreService();

      const manager = new FileSyncManager();
      await manager.registerTarget(mockPrimary, { role: "primary" });
      await manager.initialize(mockIgnoreService);

      const mockSecondary = createMockTarget("secondary");
      await manager.registerTarget(mockSecondary, { role: "secondary" });

      expect(mockSecondary.setIgnoreService).toHaveBeenCalledWith(
        mockIgnoreService
      );
    });

    it("should not propagate ignore service to targets before initialization", async () => {
      const mockPrimary = createMockTarget("primary");
      const mockSecondary = createMockTarget("secondary");

      const manager = new FileSyncManager();
      await manager.registerTarget(mockPrimary, { role: "primary" });
      await manager.registerTarget(mockSecondary, { role: "secondary" });

      expect(mockPrimary.setIgnoreService).not.toHaveBeenCalled();
      expect(mockSecondary.setIgnoreService).not.toHaveBeenCalled();
    });
  });

  describe("Gitignore Integration", () => {
    it("should read and apply .gitignore patterns from primary target", async () => {
      // Given a primary target with a .gitignore file
      const gitignoreContent = `
        # Node modules
        node_modules/
        
        # Build output
        dist/
        build/
        
        # IDE files
        .vscode/
        *.swp
      `;

      primaryTarget.setMockFile(".gitignore", gitignoreContent, {
        path: ".gitignore",
        type: "file",
        hash: "gitignore-hash",
        size: gitignoreContent.length,
        lastModified: Date.now()
      });

      // When registering the primary target
      await manager.registerTarget(primaryTarget, { role: "primary" });

      // Then the ignore patterns should include .gitignore contents
      const patterns = manager.getIgnorePatterns();
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("build/");
      expect(patterns).toContain(".vscode/");
      expect(patterns).toContain("*.swp");
    });

    it("should combine .gitignore patterns with default patterns", async () => {
      // Given a primary target with a .gitignore file containing custom patterns
      const gitignoreContent = `
        # Custom patterns
        *.log
        temp/
        custom-dir/
      `;

      primaryTarget.setMockFile(".gitignore", gitignoreContent, {
        path: ".gitignore",
        type: "file",
        hash: "gitignore-hash",
        size: gitignoreContent.length,
        lastModified: Date.now()
      });

      // When registering the primary target
      await manager.registerTarget(primaryTarget, { role: "primary" });

      // Then both default and custom patterns should be present
      const patterns = manager.getIgnorePatterns();

      // Custom patterns from .gitignore
      expect(patterns).toContain("*.log");
      expect(patterns).toContain("temp/");
      expect(patterns).toContain("custom-dir/");

      // Protected patterns should still be there
      expect(patterns).toContain(".git");
    });

    it("should work correctly when primary target has no .gitignore", async () => {
      // When registering a primary target without .gitignore
      await manager.registerTarget(primaryTarget, { role: "primary" });

      // Then only default patterns should be present
      const patterns = manager.getIgnorePatterns();
      expect(patterns).toContain(".git");
      expect(patterns).toContain("node_modules");

      // Verify no empty or undefined patterns
      expect(patterns.every((pattern) => pattern && pattern.trim())).toBe(true);
    });

    it("should propagate combined patterns to secondary targets", async () => {
      // Given a primary target with .gitignore
      const gitignoreContent = "*.custom\ntemp/";
      primaryTarget.setMockFile(".gitignore", gitignoreContent, {
        path: ".gitignore",
        type: "file",
        hash: "gitignore-hash",
        size: gitignoreContent.length,
        lastModified: Date.now()
      });

      // When registering targets
      await manager.registerTarget(primaryTarget, { role: "primary" });
      const secondaryTarget = createMockTarget("secondary");
      await manager.registerTarget(secondaryTarget, { role: "secondary" });

      // Then the secondary target should receive the combined patterns
      expect(secondaryTarget.setIgnoreService).toHaveBeenCalled();
      const ignoreService = vi.mocked(secondaryTarget.setIgnoreService).mock
        .calls[0][0];
      const patterns = ignoreService.getPatterns();
      expect(patterns).toContain("*.custom");
      expect(patterns).toContain("temp/");
    });

    it("should update patterns when .gitignore is synced from secondary", async () => {
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });

      // Given a new .gitignore in secondary
      const gitignore = "*.cache\noutput/";
      secondaryTarget1.setMockFile(".gitignore", gitignore, {
        path: ".gitignore",
        type: "file",
        hash: "secondary-hash",
        size: gitignore.length,
        lastModified: Date.now()
      });

      // When secondary reports .gitignore change
      await manager.handleTargetChanges(secondaryTarget1.id, [
        {
          path: "/.gitignore",
          type: "create",
          sourceTarget: secondaryTarget1.id,
          metadata: {
            path: ".gitignore",
            type: "file",
            hash: "secondary-hash",
            size: gitignore.length,
            lastModified: Date.now()
          }
        }
      ]);

      // Then the patterns should be updated
      const patterns = manager.getIgnorePatterns();
      expect(patterns).toContain("*.cache");
      expect(patterns).toContain("output/");
    });

    it("should handle deletion of .gitignore file", async () => {
      // Given a primary target with an initial .gitignore file
      const initialGitignore = "*.log\ntemp/";
      primaryTarget.setMockFile(".gitignore", initialGitignore, {
        path: ".gitignore",
        type: "file",
        hash: "initial-hash",
        size: initialGitignore.length,
        lastModified: Date.now()
      });

      await manager.registerTarget(primaryTarget, { role: "primary" });

      // When .gitignore is deleted
      await manager.handleTargetChanges(primaryTarget.id, [
        {
          path: "/.gitignore",
          type: "delete",
          sourceTarget: primaryTarget.id,
          metadata: {
            path: ".gitignore",
            type: "file",
            hash: "",
            size: 0,
            lastModified: Date.now()
          }
        }
      ]);

      // Then only protected patterns should remain
      const patterns = manager.getIgnorePatterns();
      expect(patterns).not.toContain("*.log");
      expect(patterns).not.toContain("temp/");
      expect(patterns).toContain(".git"); // Protected pattern should remain
    });

    it("should update patterns when .gitignore is synced from secondary", async () => {
      await manager.registerTarget(primaryTarget, { role: "primary" });
      await manager.registerTarget(secondaryTarget1, { role: "secondary" });

      // Given a new .gitignore in secondary
      const gitignore = "*.cache\noutput/";
      secondaryTarget1.setMockFile(".gitignore", gitignore, {
        path: ".gitignore",
        type: "file",
        hash: "secondary-hash",
        size: gitignore.length,
        lastModified: Date.now()
      });

      // When secondary reports .gitignore change
      await manager.handleTargetChanges(secondaryTarget1.id, [
        {
          path: ".gitignore",
          type: "create",
          sourceTarget: secondaryTarget1.id,
          metadata: {
            path: ".gitignore",
            type: "file",
            hash: "secondary-hash",
            size: gitignore.length,
            lastModified: Date.now()
          }
        }
      ]);

      // Verify the .gitignore file was synced to primary
      const primaryGitignore = await primaryTarget.getFileContent(".gitignore");
      const reader = primaryGitignore.getReader();
      const decoder = new TextDecoder();
      let content = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
      }
      content += decoder.decode();
      expect(content).toBe(gitignore);

      // Then the patterns should be updated
      const patterns = manager.getIgnorePatterns();
      expect(patterns).toContain("*.cache");
      expect(patterns).toContain("output/");
    });
  });
});

describe("Resource Management with uninitialized sync manager", () => {
  let primaryTarget: MockSyncTarget;
  let secondaryTarget1: MockSyncTarget;
  let secondaryTarget2: MockSyncTarget;
  let manager: FileSyncManager;

  beforeEach(async () => {
    primaryTarget = new MockSyncTarget("primary", "browser-fs");
    secondaryTarget1 = new MockSyncTarget("secondary1", "browser-native");
    secondaryTarget2 = new MockSyncTarget("secondary2", "node-fs");
    manager = new FileSyncManager();
  });

  it("should initialize all targets", async () => {
    // Given registered targets
    manager.registerTarget(primaryTarget, { role: "primary" });
    manager.registerTarget(secondaryTarget1, { role: "secondary" });
    manager.registerTarget(secondaryTarget2, { role: "secondary" });

    // When initializing
    await manager.initialize();

    // Then all targets should be initialized
    expect(primaryTarget.getState().status).toBe("idle");
    expect(secondaryTarget1.getState().status).toBe("idle");
    expect(secondaryTarget2.getState().status).toBe("idle");
  });

  it("should dispose all targets", async () => {
    // Given initialized targets
    manager.registerTarget(primaryTarget, { role: "primary" });
    manager.registerTarget(secondaryTarget1, { role: "secondary" });
    await manager.initialize();

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

describe("Progress Tracking", () => {
  let primaryTarget: MockSyncTarget;
  let secondaryTarget: MockSyncTarget;
  let manager: FileSyncManager;
  let progressEvents: SyncProgressEvent[];

  beforeEach(async () => {
    primaryTarget = new MockSyncTarget("primary", "node-fs");
    secondaryTarget = new MockSyncTarget("secondary", "browser-fs");
    manager = new FileSyncManager();
    progressEvents = [];

    // Initialize targets
    primaryTarget.initialize();
    secondaryTarget.initialize();

    // Initialize and register with manager
    await manager.initialize();
    await manager.registerTarget(primaryTarget, { role: "primary" });
    await manager.registerTarget(secondaryTarget, { role: "secondary" });

    // Add progress collector
    manager.addProgressListener((event) => {
      progressEvents.push(event);
    });
  });

  afterEach(() => {
    progressEvents = [];
  });

  const createTestFile = (path = "test.txt", content = "test content") => {
    const metadata: FileMetadata = {
      path,
      type: "file",
      hash: "testhash",
      size: 100,
      lastModified: Date.now()
    };

    const change: FileChangeInfo = {
      path,
      metadata,
      type: "modify",
      sourceTarget: primaryTarget.id
    };

    const contentBuffer = Buffer.from(content);
    const uint8Array = new Uint8Array(contentBuffer);

    return { metadata, change, content: uint8Array };
  };

  describe("Listener Management", () => {
    it("should allow adding and removing progress listeners", async () => {
      // Given a progress listener
      const listener = vi.fn();

      // When adding the listener
      const removeListener = manager.addProgressListener(listener);
      expect(typeof removeListener).toBe("function");

      // And removing it
      removeListener();

      // Then it should not be called when progress occurs
      const { metadata, change, content } = createTestFile(
        "test.txt",
        "test content"
      );
      const decoder = new TextDecoder();
      primaryTarget.setMockFile(
        metadata.path,
        decoder.decode(content),
        metadata
      );
      await manager.handleTargetChanges(primaryTarget.id, [change]);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should handle multiple listeners", async () => {
      // Given multiple listeners
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      // When adding both listeners
      manager.addProgressListener(listener1);
      manager.addProgressListener(listener2);

      // And progress occurs
      const { metadata, change, content } = createTestFile(
        "test.txt",
        "test content"
      );
      const decoder = new TextDecoder();
      primaryTarget.setMockFile(
        metadata.path,
        decoder.decode(content),
        metadata
      );
      await manager.handleTargetChanges(primaryTarget.id, [change]);

      // Then both should be called
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it("should handle listener errors gracefully", async () => {
      // Given a listener that throws
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error("Listener error");
      });
      const goodListener = vi.fn();

      // When adding both listeners
      manager.addProgressListener(errorListener);
      manager.addProgressListener(goodListener);

      // And progress occurs
      const { metadata, change, content } = createTestFile(
        "test.txt",
        "test content"
      );
      const decoder = new TextDecoder();
      primaryTarget.setMockFile(
        metadata.path,
        decoder.decode(content),
        metadata
      );
      await manager.handleTargetChanges(primaryTarget.id, [change]);

      // Then the error should not prevent other listeners from being called
      expect(errorListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });
});

describe("FileSyncManager with IgnoreService", () => {
  let primaryTarget: MockSyncTarget;
  let secondaryTarget: MockSyncTarget;
  let manager: FileSyncManager;
  let ignoreService: IgnoreService;

  beforeEach(async () => {
    // Create mock targets
    primaryTarget = new MockSyncTarget("primary", "node-fs");
    secondaryTarget = new MockSyncTarget("secondary", "browser-fs");
    primaryTarget.getState().status = "idle";
    secondaryTarget.getState().status = "idle";

    // Create mock IgnoreService
    ignoreService = {
      isIgnored: vi.fn(),
      setPatterns: vi.fn(),
      getPatterns: vi.fn()
    };
    // Initialize manager with ignore service
    manager = new FileSyncManager();
    manager.registerTarget(primaryTarget, { role: "primary" });
    manager.registerTarget(secondaryTarget, { role: "secondary" });
    await manager.initialize(ignoreService);
  });

  describe("Initialization", () => {
    it("should initialize with pre-configured ignore service", async () => {
      // Given a pre-configured ignore service
      const patterns = ["*.tmp", "node_modules/**"];
      (ignoreService.getPatterns as ReturnType<typeof vi.fn>).mockReturnValue(
        patterns
      );

      // When initializing a new manager
      const newManager = new FileSyncManager();
      await newManager.initialize(ignoreService);

      // Then the service should be used as-is
      expect(ignoreService.setPatterns).not.toHaveBeenCalled();
      expect(primaryTarget.setIgnoreService).toHaveBeenCalled();
      expect(secondaryTarget.setIgnoreService).toHaveBeenCalled();
    });
  });

  describe("Change Detection", () => {
    it("should use ignore service to filter changes", async () => {
      // Given a configured ignore service
      (ignoreService.isIgnored as ReturnType<typeof vi.fn>).mockImplementation(
        (path: string) => {
          return path.endsWith(".tmp") || path.startsWith("node_modules/");
        }
      );

      // And some test files in the primary target
      const files = [
        { path: "test.tmp", content: "temp content" },
        { path: "node_modules/package/index.js", content: "module content" },
        { path: "src/main.ts", content: "source content" }
      ];

      files.forEach((file) => {
        primaryTarget.setMockFile(file.path, file.content, {
          path: file.path,
          type: "file",
          hash: "mock-hash",
          size: file.content.length,
          lastModified: Date.now()
        });
      });

      // When primary reports changes
      const changes = files.map((file) => ({
        path: file.path,
        type: "create" as const,
        sourceTarget: primaryTarget.id,
        metadata: {
          path: file.path,
          type: "file" as const,
          hash: "mock-hash",
          size: file.content.length,
          lastModified: Date.now()
        }
      }));

      await manager.handleTargetChanges(primaryTarget.id, changes);

      // Then ignore service should be consulted for each file
      expect(ignoreService.isIgnored).toHaveBeenCalledWith("test.tmp");
      expect(ignoreService.isIgnored).toHaveBeenCalledWith(
        "node_modules/package/index.js"
      );
      expect(ignoreService.isIgnored).toHaveBeenCalledWith("src/main.ts");

      // And only non-ignored files should be synced to secondary
      await expect(
        secondaryTarget.getFileContent("test.tmp")
      ).rejects.toThrow();
      await expect(
        secondaryTarget.getFileContent("node_modules/package/index.js")
      ).rejects.toThrow();
      const [mainContent] = await secondaryTarget.getMetadata(["src/main.ts"]);
      expect(mainContent).toBeDefined();
      expect(mainContent!.hash).toBe("mock-hash");
    });
  });

  describe("Error Handling", () => {
    it("should handle ignore service errors gracefully", async () => {
      // Given an ignore service that throws errors
      (ignoreService.isIgnored as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error("Invalid pattern");
        }
      );

      // And a test file in primary
      const testFile = {
        path: "test.ts",
        content: "test content",
        metadata: {
          path: "test.ts",
          type: "file" as const,
          hash: "mock-hash",
          size: 11,
          lastModified: Date.now()
        }
      };

      primaryTarget.setMockFile(
        testFile.path,
        testFile.content,
        testFile.metadata
      );

      // When primary reports changes
      const change = {
        path: testFile.path,
        type: "create" as const,
        sourceTarget: primaryTarget.id,
        metadata: testFile.metadata
      };

      // Then it should not throw and process the change
      await expect(
        manager.handleTargetChanges(primaryTarget.id, [change])
      ).resolves.not.toThrow();

      // And the file should be synced despite the ignore service error
      const [syncedMetadata] = await secondaryTarget.getMetadata([
        testFile.path
      ]);
      expect(syncedMetadata).toBeDefined();
      expect(syncedMetadata!.hash).toBe(testFile.metadata.hash);
    });
  });
});
