import { describe, beforeEach, it, expect, vi, MockInstance } from "vitest";
import type {
  FileSystem,
  SyncManager,
  GitOperations,
  FileManagementConfig,
  FileManagementService as IFileManagementService,
  SyncTarget
} from "@piddie/shared-types";
import { SyncManagerError, GitError } from "@piddie/shared-types";
import { FileManagementServiceFactory } from "../src/FileManagementService";

// Mock FileSyncManager module
vi.mock("../src/FileSyncManager", () => ({
  FileSyncManager: class MockFileSyncManager implements SyncManager {
    initialize = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn().mockResolvedValue(undefined);
    registerTarget = vi.fn();
    unregisterTarget = vi.fn();
    getPrimaryTarget = vi.fn().mockReturnValue(mockPrimaryTarget);
    getSecondaryTargets = vi.fn().mockReturnValue([]);
    getStatus = vi.fn().mockReturnValue({
      phase: "idle",
      targets: new Map(),
      failureHistory: []
    });
    getPendingSync = vi.fn().mockReturnValue(null);
    getFileContent = vi.fn().mockResolvedValue({
      metadata: {},
      getReader: () => ({
        read: async () => ({ done: true, value: undefined })
      }),
      close: async () => {}
    });
    handleTargetChanges = vi.fn().mockResolvedValue(undefined);
    getPendingChanges = vi.fn().mockResolvedValue([]);
    getPendingChangeContent = vi.fn().mockResolvedValue({
      metadata: {},
      getReader: () => ({
        read: async () => ({ done: true, value: undefined })
      }),
      close: async () => {}
    });
    confirmPrimarySync = vi.fn().mockResolvedValue(undefined);
    rejectPendingSync = vi.fn().mockResolvedValue(undefined);
    reinitializeTarget = vi.fn().mockResolvedValue(undefined);
    validateStateTransition = vi.fn().mockReturnValue(true);
    getCurrentState = vi.fn().mockReturnValue({ phase: "idle" });
    transitionTo = vi.fn().mockResolvedValue(undefined);
  }
}));

// Mock implementations
const mockFileSystem = {
  initialize: vi.fn().mockResolvedValue(undefined)
} as unknown as FileSystem;

const mockPrimaryTarget: SyncTarget = {
  id: "primary",
  type: "local",
  initialize: vi.fn().mockResolvedValue(undefined),
  notifyIncomingChanges: vi.fn().mockResolvedValue(undefined),
  getMetadata: vi.fn().mockResolvedValue([]),
  getFileContent: vi.fn().mockResolvedValue({
    metadata: {},
    getReader: () => ({
      read: async () => ({ done: true, value: undefined })
    }),
    close: async () => {}
  }),
  applyFileChange: vi.fn().mockResolvedValue(null),
  syncComplete: vi.fn().mockResolvedValue(true),
  watch: vi.fn().mockResolvedValue(undefined),
  unwatch: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue({
    id: "primary",
    type: "local",
    lockState: { isLocked: false },
    pendingChanges: 0,
    status: "idle"
  }),
  listDirectory: vi.fn().mockResolvedValue([]),
  validateStateTransition: vi.fn().mockReturnValue(true),
  getCurrentState: vi.fn().mockReturnValue({ status: "idle" }),
  transitionTo: vi.fn().mockResolvedValue(undefined)
};

class MockGitOperations implements GitOperations {
  stageFiles = vi.fn().mockResolvedValue(undefined);
  createCommit = vi.fn().mockResolvedValue("commit-hash");
  createConflictBranch = vi.fn().mockResolvedValue("conflict-branch");
  saveConflictVersions = vi.fn().mockResolvedValue(undefined);
  switchToMain = vi.fn().mockResolvedValue(undefined);
}

describe("FileManagementService", () => {
  let service: IFileManagementService;
  let git: MockGitOperations;
  let config: FileManagementConfig;
  let mockSyncManager: SyncManager;

  beforeEach(async () => {
    // Reset all mocks first
    vi.clearAllMocks();

    git = new MockGitOperations();
    config = {
      paths: {
        include: ["src/**/*"],
        ignore: ["node_modules/**/*"]
      },
      sync: {
        inactivityDelay: 1000,
        maxBatchSize: 10
      }
    };

    // Create service using factory
    service = await FileManagementServiceFactory.create({
      primaryTarget: mockPrimaryTarget,
      secondaryTargets: [],
      git,
      fileSystem: mockFileSystem
    });

    // Initialize service with config
    await service.initialize(config);

    // Get reference to sync manager for testing
    mockSyncManager = service.syncManager;
  });

  describe("initialization", () => {
    let uninitializedService: IFileManagementService;

    beforeEach(async () => {
      // Create a new uninitialized service for these tests
      uninitializedService = await FileManagementServiceFactory.create({
        primaryTarget: mockPrimaryTarget,
        secondaryTargets: [],
        git,
        fileSystem: mockFileSystem
      });

      // Reset mocks after service creation
      vi.clearAllMocks();
    });

    it("should initialize all components with config", async () => {
      // When initializing
      await uninitializedService.initialize(config);

      // Then all components should be initialized
      expect(mockPrimaryTarget.initialize).toHaveBeenCalledWith(
        mockFileSystem,
        true
      );
      expect(mockFileSystem.initialize).toHaveBeenCalled();
    });

    it("should initialize with default config if none provided", async () => {
      // When initializing without config
      await uninitializedService.initialize();

      // Then should initialize with defaults
      expect(mockPrimaryTarget.initialize).toHaveBeenCalledWith(
        mockFileSystem,
        true
      );
      expect(mockFileSystem.initialize).toHaveBeenCalled();
    });

    it("should throw if already initialized", async () => {
      // Given service is initialized
      await uninitializedService.initialize(config);

      // When trying to initialize again
      const initPromise = uninitializedService.initialize(config);

      // Then should throw
      await expect(initPromise).rejects.toThrow("Service already initialized");
    });
  });

  describe("disposal", () => {
    it("should dispose sync manager", async () => {
      // When disposing
      await service.dispose();

      // Then sync manager should be disposed
      expect(mockSyncManager.dispose).toHaveBeenCalled();
    });

    it("should handle disposal errors gracefully", async () => {
      // Given sync manager fails to dispose
      const error = new SyncManagerError("Dispose failed", "SYNC_IN_PROGRESS");
      (mockSyncManager.dispose as unknown as MockInstance).mockRejectedValue(
        error
      );

      // When disposing
      const disposePromise = service.dispose();

      // Then should still complete
      await expect(disposePromise).resolves.toBeUndefined();
    });
  });

  describe("interface exposure", () => {
    it("should expose primary target's file system", () => {
      expect(service.fileSystem).toBe(mockFileSystem);
    });

    it("should expose sync manager interface", () => {
      expect(service.syncManager).toBeDefined();
    });

    it("should expose git operations interface", () => {
      expect(service.git).toBe(git);
    });

    it("should throw if accessing interfaces before initialization", async () => {
      // Create new uninitialized service
      const uninitializedService = await FileManagementServiceFactory.create({
        primaryTarget: mockPrimaryTarget,
        secondaryTargets: [],
        git,
        fileSystem: mockFileSystem
      });

      expect(() => uninitializedService.fileSystem).toThrow(
        "Service not initialized"
      );
      expect(() => uninitializedService.syncManager).toThrow(
        "Service not initialized"
      );
      expect(() => uninitializedService.git).toThrow("Service not initialized");
    });
  });

  describe("git operations", () => {
    it("should handle git operation errors", async () => {
      // Given git operation fails
      const error = new GitError("Commit failed", "COMMIT_FAILED");
      git.createCommit.mockRejectedValue(error);

      // When performing operation
      const commitPromise = service.git.createCommit("test: commit message");

      // Then should throw
      await expect(commitPromise).rejects.toThrow(error);
    });

    it("should create conflict branches with correct naming", async () => {
      // When creating conflict branch
      await service.git.createConflictBranch({
        targetId: "browser",
        timestamp: 1234567890
      });

      // Then should use correct branch name format
      expect(git.createConflictBranch).toHaveBeenCalledWith({
        targetId: "browser",
        timestamp: 1234567890
      });
    });
  });
});
