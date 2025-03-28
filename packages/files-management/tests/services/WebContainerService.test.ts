import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebContainerService } from "../../src/services/WebContainerService";

// Mock WebContainer
vi.mock("@webcontainer/api", () => {
  return {
    WebContainer: {
      boot: vi.fn().mockResolvedValue({
        mount: vi.fn().mockResolvedValue(undefined),
        teardown: vi.fn().mockResolvedValue(undefined)
      })
    }
  };
});

describe("WebContainerService", () => {
  let service: WebContainerService;

  beforeEach(() => {
    // Reset the singleton for each test
    vi.resetModules();
    // @ts-expect-error: accessing private static field
    WebContainerService.instance = undefined;
    service = WebContainerService.getInstance();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should be a singleton", () => {
    const instance1 = WebContainerService.getInstance();
    const instance2 = WebContainerService.getInstance();
    expect(instance1).toBe(instance2);
  });

  it("should throw error when getting container before initialization", () => {
    expect(() => service.getContainer()).toThrow(
      "WebContainer not initialized"
    );
  });

  it("should create container when createContainer is called", async () => {
    const container = await service.createContainer();
    expect(container).toBeDefined();
    expect(service.hasContainer()).toBe(true);
  });

  it("should throw error when creating container twice", async () => {
    await service.createContainer();
    await expect(service.createContainer()).rejects.toThrow(
      "WebContainer already exists"
    );
  });

  it("should allow getting container after creation", async () => {
    const createdContainer = await service.createContainer();
    const retrievedContainer = service.getContainer();
    expect(retrievedContainer).toBe(createdContainer);
  });

  it("should reset container when reset is called", async () => {
    await service.createContainer();
    expect(service.hasContainer()).toBe(true);

    await service.reset();
    expect(service.hasContainer()).toBe(false);
    expect(() => service.getContainer()).toThrow(
      "WebContainer not initialized"
    );
  });

  it("should set container when setContainer is called", () => {
    const mockContainer = { id: "mock-container" };
    // @ts-expect-error: Using mock object
    service.setContainer(mockContainer);
    expect(service.hasContainer()).toBe(true);
    expect(service.getContainer()).toBe(mockContainer);
  });

  it("should throw error when setting container twice", () => {
    const mockContainer1 = { id: "mock-container-1" };
    const mockContainer2 = { id: "mock-container-2" };

    // @ts-expect-error: Using mock object
    service.setContainer(mockContainer1);

    // @ts-expect-error: Using mock object
    expect(() => service.setContainer(mockContainer2)).toThrow(
      "WebContainer already exists"
    );
  });
});
