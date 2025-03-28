import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { WebContainer } from "@webcontainer/api";
import { WebContainer as WebContainerMock } from "../__mocks__/@webcontainer/api";
import { WebContainerProvider } from "../providers/WebContainerProvider";

// Setup the WebContainer mocks
vi.mock("@webcontainer/api");

describe("WebContainerProvider", () => {
  beforeEach(() => {
    // Reset the WebContainer mock before each test
    WebContainerMock.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should not be ready before initialization", () => {
    const provider = new WebContainerProvider();
    expect(provider.isReady()).toBe(false);
  });

  test("should be ready when initialized with an existing container", () => {
    const mockContainer = {} as WebContainer;
    const provider = new WebContainerProvider(mockContainer);
    expect(provider.isReady()).toBe(true);
  });

  test("should skip initialization when created with an existing container", async () => {
    const mockContainer = {} as WebContainer;
    const provider = new WebContainerProvider(mockContainer);

    // Since we're providing a container, boot should not be called
    const bootMock = vi.fn();
    WebContainer.boot = bootMock;

    await provider.initialize();

    expect(bootMock).toHaveBeenCalledTimes(0);
    expect(provider.isReady()).toBe(true);
  });

  test("should throw when executing command before initialization", async () => {
    const provider = new WebContainerProvider();

    await expect(provider.executeCommand("echo hello")).rejects.toThrow(
      "Web container is not initialized"
    );
  });

  test("should initialize the WebContainer when initialize is called", async () => {
    const provider = new WebContainerProvider();

    // Mock the WebContainer.boot method
    const bootMock = vi.fn().mockResolvedValue({});
    WebContainer.boot = bootMock;

    await provider.initialize();

    expect(bootMock).toHaveBeenCalledTimes(1);
    expect(provider.isReady()).toBe(true);
  });

  test("should execute commands successfully once initialized", async () => {
    // Set up mocks
    const mockSpawn = vi.fn().mockResolvedValue({
      output: {
        pipeTo: vi.fn().mockResolvedValue(undefined)
      },
      exit: Promise.resolve(0)
    });

    // Mock the WebContainer instance
    const mockContainer = {
      spawn: mockSpawn
    };

    // Mock the WebContainer.boot method to return our mock container
    WebContainer.boot = vi.fn().mockResolvedValue(mockContainer);

    // Create and initialize the provider
    const provider = new WebContainerProvider();
    await provider.initialize();

    // Execute a command
    const result = await provider.executeCommand("echo hello");

    // Verify the spawn method was called correctly
    expect(mockSpawn).toHaveBeenCalledWith(
      "echo",
      ["hello"],
      expect.any(Object)
    );

    // Verify the result
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });

  test("should handle command failures", async () => {
    // Set up mocks for a failed command
    const mockSpawn = vi.fn().mockResolvedValue({
      output: {
        pipeTo: vi.fn().mockResolvedValue(undefined)
      },
      exit: Promise.resolve(1)
    });

    // Mock the WebContainer instance
    const mockContainer = {
      spawn: mockSpawn
    };

    // Mock the WebContainer.boot method to return our mock container
    WebContainer.boot = vi.fn().mockResolvedValue(mockContainer);

    // Create and initialize the provider
    const provider = new WebContainerProvider();
    await provider.initialize();

    // Execute a command that will fail
    const result = await provider.executeCommand("invalid command");

    // Verify the spawn method was called correctly
    expect(mockSpawn).toHaveBeenCalledWith(
      "invalid",
      ["command"],
      expect.any(Object)
    );

    // Verify the result
    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(false);
  });

  test("should handle errors when spawning commands", async () => {
    // Mock the WebContainer instance
    const mockContainer = {
      spawn: vi.fn().mockRejectedValue(new Error("Spawn error"))
    };

    // Mock the WebContainer.boot method to return our mock container
    WebContainer.boot = vi.fn().mockResolvedValue(mockContainer);

    // Create and initialize the provider
    const provider = new WebContainerProvider();
    await provider.initialize();

    // Execute a command
    const result = await provider.executeCommand("fail command");

    // Verify the result
    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(false);
    expect(result.stderr).toBe("Spawn error");
  });

  test("should allow executing commands directly with an existing container", async () => {
    // Set up mocks
    const mockSpawn = vi.fn().mockResolvedValue({
      output: {
        pipeTo: vi.fn().mockResolvedValue(undefined)
      },
      exit: Promise.resolve(0)
    });

    // Create a mock container with the spawn method
    const mockContainer = {
      spawn: mockSpawn
    };

    // Create provider with existing container
    const provider = new WebContainerProvider(mockContainer as WebContainer);

    // Execute a command without calling initialize()
    const result = await provider.executeCommand("node --version");

    // Verify the spawn method was called correctly
    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      ["--version"],
      expect.any(Object)
    );

    // Verify the result
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });
});
