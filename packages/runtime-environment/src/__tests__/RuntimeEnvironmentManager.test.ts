import { describe, test, expect, vi, beforeEach } from "vitest";
import { RuntimeEnvironmentManager } from "../RuntimeEnvironmentManager";
import {
  RuntimeEnvironmentFactory,
  RuntimeType
} from "../factory/RuntimeEnvironmentFactory";
import { CommandResult, RuntimeEnvironmentProvider } from "../types";
import { WebContainer } from "@webcontainer/api";
import { WebContainerProvider } from "../providers/WebContainerProvider";
import { FileSystem } from "@piddie/shared-types";

// Mock the WebContainerProvider
vi.mock("../providers/WebContainerProvider", () => {
  return {
    WebContainerProvider: vi
      .fn()
      .mockImplementation((container: WebContainer | undefined) => {
        return {
          container: container,
          isInitialized: !!container,
          initialize: vi.fn().mockResolvedValue(undefined),
          isReady: vi.fn().mockReturnValue(true),
          executeCommand: vi.fn().mockResolvedValue({
            exitCode: 0,
            stdout: "mocked output",
            stderr: "",
            success: true
          })
        };
      })
  };
});

// Create a mock provider for testing
class MockRuntimeProvider implements RuntimeEnvironmentProvider {
  private initialized = false;
  private mockResponses: Map<string, CommandResult> = new Map();

  constructor() {
    // Set up some default mock responses
    this.mockResponses.set("echo hello", {
      exitCode: 0,
      stdout: "hello\n",
      stderr: "",
      success: true
    });

    this.mockResponses.set("invalid command", {
      exitCode: 127,
      stdout: "",
      stderr: "command not found: invalid",
      success: false
    });
  }
  getFileSystem(): FileSystem {
    throw new Error("Method not implemented.");
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }

  public async initialize(): Promise<void> {
    this.initialized = true;
    return Promise.resolve();
  }

  public isReady(): boolean {
    return this.initialized;
  }

  public async executeCommand(command: string): Promise<CommandResult> {
    if (!this.initialized) {
      throw new Error("Provider not initialized");
    }

    const result = this.mockResponses.get(command) || {
      exitCode: 1,
      stdout: "",
      stderr: `Mock response not found for command: ${command}`,
      success: false
    };

    return Promise.resolve(result);
  }

  // Helper method for testing
  public addMockResponse(command: string, result: CommandResult): void {
    this.mockResponses.set(command, result);
  }
}

describe("RuntimeEnvironmentManager", () => {
  beforeEach(() => {
    // Register our mock provider with the factory
    RuntimeEnvironmentFactory.registerProvider(
      RuntimeType.WEB_CONTAINER,
      MockRuntimeProvider as any
    );

    vi.clearAllMocks();
  });

  test("should create manager with default provider", () => {
    const manager = new RuntimeEnvironmentManager();
    expect(manager).toBeDefined();
    expect(manager.isReady()).toBe(false);
  });

  test("should initialize the provider", async () => {
    const manager = new RuntimeEnvironmentManager();
    await manager.initialize();
    expect(manager.isReady()).toBe(true);
  });

  test("should execute command successfully", async () => {
    const manager = new RuntimeEnvironmentManager();
    await manager.initialize();

    const result = await manager.executeCommand("echo hello");

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
  });

  test("should handle command failures", async () => {
    const manager = new RuntimeEnvironmentManager();
    await manager.initialize();

    const result = await manager.executeCommand("invalid command");

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe("command not found: invalid");
  });

  test("should auto-initialize if executing command when not ready", async () => {
    const manager = new RuntimeEnvironmentManager();
    expect(manager.isReady()).toBe(false);

    const result = await manager.executeCommand("echo hello");

    expect(manager.isReady()).toBe(true);
    expect(result.success).toBe(true);
  });

  test("should allow changing the provider", async () => {
    const manager = new RuntimeEnvironmentManager();
    await manager.initialize();

    const customProvider = new MockRuntimeProvider();
    customProvider.addMockResponse("custom command", {
      exitCode: 0,
      stdout: "custom output",
      stderr: "",
      success: true
    });

    manager.setProvider(customProvider);

    // Should need to initialize the new provider
    expect(manager.isReady()).toBe(false);
    await manager.initialize();

    const result = await manager.executeCommand("custom command");
    expect(result.stdout).toBe("custom output");
  });

  test("should allow changing the provider by type", async () => {
    const manager = new RuntimeEnvironmentManager();

    // This is a bit redundant in our test since we only have one type,
    // but it tests the method works
    manager.setProvider(RuntimeType.WEB_CONTAINER);

    expect(manager.isReady()).toBe(false);
    await manager.initialize();
    expect(manager.isReady()).toBe(true);
  });

  test("should create a manager with an existing WebContainer instance", async () => {
    // Create a mock WebContainer
    const mockWebContainer = {} as WebContainer;

    // Create a manager with the WebContainer
    const manager =
      RuntimeEnvironmentManager.withWebContainer(mockWebContainer);

    // Verify that WebContainerProvider was constructed with our container
    expect(WebContainerProvider).toHaveBeenCalledWith(mockWebContainer);

    // Verify that the manager is ready
    expect(manager.isReady()).toBe(true);

    // Execute a command and verify it works
    const result = await manager.executeCommand("test command");
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("mocked output");
  });
});
