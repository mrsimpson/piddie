import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RuntimeEnvironmentMCPServer } from "../mcp/RuntimeEnvironmentMCPServer";
import { RuntimeEnvironmentManager } from "../RuntimeEnvironmentManager";
import { RuntimeType } from "../factory/RuntimeEnvironmentFactory";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CommandResult, RuntimeEnvironmentProvider } from "../types";
import { RuntimeEnvironmentFactory } from "../factory/RuntimeEnvironmentFactory";
import { FileSystem } from "@piddie/shared-types";

// Define the response type for tool calls
interface ToolCallResponse {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
}

// Mock Runtime Provider for testing
class MockRuntimeProvider implements RuntimeEnvironmentProvider {
  private initialized = false;
  private mockResponses: Map<string, CommandResult> = new Map();

  constructor() {
    // Set default responses for common commands
    this.addMockResponse("echo 'Hello from MCP!'", {
      exitCode: 0,
      stdout: "Hello from MCP!",
      stderr: "",
      success: true
    });

    this.addMockResponse("invalid-command-that-does-not-exist", {
      exitCode: 127,
      stdout: "",
      stderr: "command not found: invalid-command-that-does-not-exist",
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
  }

  public isReady(): boolean {
    return this.initialized;
  }

  public async executeCommand(command: string): Promise<CommandResult> {
    // Check if we have a mock response for this exact command
    if (this.mockResponses.has(command)) {
      return this.mockResponses.get(command) as CommandResult;
    }

    // Default response for unknown commands
    return {
      exitCode: 127,
      stdout: "",
      stderr: `unknown command: ${command}`,
      success: false
    };
  }

  public addMockResponse(command: string, result: CommandResult): void {
    this.mockResponses.set(command, result);
  }
}

// This test uses a mocked RuntimeEnvironmentManager
describe("RuntimeEnvironmentMCPServer Integration", () => {
  let server: RuntimeEnvironmentMCPServer;
  let runtimeManager: RuntimeEnvironmentManager;
  let client: Client;
  let clientTransport: any;
  let serverTransport: any;

  beforeAll(async () => {
    // Register our mock provider with the factory
    RuntimeEnvironmentFactory.registerProvider(
      RuntimeType.WEB_CONTAINER,
      MockRuntimeProvider as any
    );

    // Create a RuntimeEnvironmentManager with the mock provider
    runtimeManager = new RuntimeEnvironmentManager(
      undefined,
      RuntimeType.WEB_CONTAINER
    );

    // Initialize the runtime
    await runtimeManager.initialize();

    // Initialize the server with the runtime manager
    server = new RuntimeEnvironmentMCPServer(runtimeManager);

    // Create a linked pair of transports
    const transports = InMemoryTransport.createLinkedPair();
    clientTransport = transports[0];
    serverTransport = transports[1];

    // Set up the client
    client = new Client({
      name: "test-client",
      version: "1.0.0"
    });

    // Connect the server and client
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }, 10000); // Reduced timeout since we're using mocks

  afterAll(async () => {
    // Only close if they exist to prevent errors
    if (client) client.close();
    if (server) server.close();
  });

  it("should execute a simple command and return the result", async () => {
    // GIVEN a simple command to execute (echo)
    const command = "echo 'Hello from MCP!'";

    // WHEN we call the tool through the client
    const result = (await client.callTool({
      name: "execute_command",
      arguments: { command }
    })) as ToolCallResponse;

    // THEN the command executes successfully
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Exit Code: 0");
    expect(result.content[0].text).toContain("Hello from MCP!");
  });

  it("should handle command failure gracefully", async () => {
    // GIVEN a command that will fail
    const command = "invalid-command-that-does-not-exist";

    // WHEN we call the tool through the client
    const result = (await client.callTool({
      name: "execute_command",
      arguments: { command }
    })) as ToolCallResponse;

    // THEN we receive the error indication
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("command not found");
  });
});
