import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  SyncTarget,
  FileChangeInfo,
  FileChange,
  FileConflict,
  FileSystem,
  TargetState
} from "@piddie/shared-types";

// Mock implementation of SyncTarget for testing
class MockSyncTarget implements SyncTarget {
  private changes: FileChangeInfo[] = [];
  private fileSystem?: FileSystem;
  private watchCallback?: (changes: FileChangeInfo[]) => void;

  constructor(
    public readonly id: string,
    public readonly type: "browser" | "local" | "container" = "browser"
  ) {}

  async initialize(fileSystem: FileSystem): Promise<void> {
    this.fileSystem = fileSystem;
  }

  async notifyIncomingChanges(): Promise<void> {
    if (!this.fileSystem) throw new Error("Not initialized");
  }

  async getContents(paths: string[]): Promise<Map<string, string>> {
    if (!this.fileSystem) throw new Error("Not initialized");
    const contents = new Map<string, string>();
    paths.forEach((path) => {
      contents.set(path, "test content");
    });
    return contents;
  }

  async applyChanges(changes: FileChange[]): Promise<FileConflict[]> {
    if (!this.fileSystem) throw new Error("Not initialized");
    this.changes = [...this.changes, ...changes];
    return [];
  }

  async syncComplete(): Promise<boolean> {
    return true;
  }

  async watch(callback: (changes: FileChangeInfo[]) => void): Promise<void> {
    this.watchCallback = callback;
  }

  async unwatch(): Promise<void> {
    this.watchCallback = undefined;
  }

  getState(): TargetState {
    return {
      id: this.id,
      type: this.type,
      lockState: { isLocked: false },
      pendingChanges: this.changes.length,
      status: "idle"
    };
  }
}

// Mock FileSystem for testing
const mockFileSystem: FileSystem = {
  initialize: async () => {},
  listDirectory: async () => [],
  readFile: async () => "test content",
  writeFile: async () => {},
  createDirectory: async () => {},
  deleteItem: async () => {},
  exists: async () => true,
  getMetadata: async () => ({
    path: "test",
    type: "file",
    lastModified: Date.now()
  }),
  lock: async () => {},
  forceUnlock: async () => {},
  getState: () => ({
    lockState: { isLocked: false },
    pendingOperations: 0
  })
};

describe("SyncTarget", () => {
  let target: SyncTarget;

  beforeEach(() => {
    target = new MockSyncTarget("test-target");
  });

  describe("Initialization", () => {
    it("should initialize with file system", async () => {
      await expect(target.initialize(mockFileSystem)).resolves.not.toThrow();
    });

    it("should require initialization before operations", async () => {
      await expect(target.notifyIncomingChanges(["test.txt"])).rejects.toThrow(
        "Not initialized"
      );
    });
  });

  describe("Change Notification", () => {
    beforeEach(async () => {
      await target.initialize(mockFileSystem);
    });

    it("should handle incoming change notifications", async () => {
      await expect(
        target.notifyIncomingChanges(["test.txt"])
      ).resolves.not.toThrow();
    });
  });

  describe("Content Retrieval", () => {
    beforeEach(async () => {
      await target.initialize(mockFileSystem);
    });

    it("should retrieve contents for given paths", async () => {
      const paths = ["test1.txt", "test2.txt"];
      const contents = await target.getContents(paths);

      expect(contents.size).toBe(2);
      paths.forEach((path) => {
        expect(contents.has(path)).toBe(true);
        expect(typeof contents.get(path)).toBe("string");
      });
    });
  });

  describe("Change Application", () => {
    beforeEach(async () => {
      await target.initialize(mockFileSystem);
    });

    it("should apply changes", async () => {
      const changes: FileChange[] = [
        {
          path: "test.txt",
          type: "create",
          content: "test content",
          sourceTarget: "source",
          timestamp: Date.now()
        }
      ];

      const conflicts = await target.applyChanges(changes);
      expect(conflicts).toEqual([]);
    });
  });

  describe("Watch Management", () => {
    beforeEach(async () => {
      await target.initialize(mockFileSystem);
    });

    it("should setup and remove watch callback", async () => {
      const callback = vi.fn();
      await target.watch(callback);
      await target.unwatch();
      // Implementation specific: verify callback removal
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("State Management", () => {
    beforeEach(async () => {
      await target.initialize(mockFileSystem);
    });

    it("should return current state", () => {
      const state = target.getState();
      expect(state).toEqual({
        id: "test-target",
        type: "browser",
        lockState: { isLocked: false },
        pendingChanges: 0,
        status: "idle"
      });
    });
  });
});
