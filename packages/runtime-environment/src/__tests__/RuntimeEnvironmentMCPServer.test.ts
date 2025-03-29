import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeEnvironmentMCPServer } from "../mcp/RuntimeEnvironmentMCPServer";
import { RuntimeEnvironmentManager } from "../RuntimeEnvironmentManager";
import { CommandResult } from "../types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Define the response type for tool calls
interface ToolCallResponse {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
}

// Mock the RuntimeEnvironmentManager
vi.mock("../RuntimeEnvironmentManager");

describe("RuntimeEnvironmentMCPServer", () => {
  let server: RuntimeEnvironmentMCPServer;
  let runtimeManager: RuntimeEnvironmentManager;
  let client: Client;

  beforeEach(async () => {
    // Create a RuntimeEnvironmentManager with mocked methods
    runtimeManager = {
      executeCommand: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined)
    } as unknown as RuntimeEnvironmentManager;

    // Initialize the server with the runtime manager
    server = new RuntimeEnvironmentMCPServer(runtimeManager);

    // Create a linked pair of transports
    const transports = InMemoryTransport.createLinkedPair();
    const clientTransport = transports[0];
    const serverTransport = transports[1];

    // Set up the client
    client = new Client({
      name: "test-client",
      version: "1.0.0"
    });

    // Connect the server and client
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  describe("execute_command tool", () => {
    it("should execute a command and return the result", async () => {
      // GIVEN a command to execute
      const command = "npm install";
      const options = { cwd: "/project" };
      const expectedResult: CommandResult = {
        exitCode: 0,
        stdout: "Success",
        stderr: "",
        success: true
      };

      // WHEN the runtime manager returns a successful result
      (runtimeManager.executeCommand as any).mockResolvedValue(expectedResult);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "execute_command",
        arguments: {
          command,
          cwd: options.cwd
        }
      })) as ToolCallResponse;

      // Check that the command was executed with the right parameters
      expect(runtimeManager.executeCommand).toHaveBeenCalledWith(
        command,
        expect.objectContaining({ cwd: options.cwd })
      );

      // Check that the result is formatted correctly
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Exit Code: 0");
      expect(result.content[0].text).toContain("Success");
    });

    it("should handle command failures", async () => {
      // GIVEN a command that will fail
      const command = "invalid-command";
      const expectedResult: CommandResult = {
        exitCode: 1,
        stdout: "",
        stderr: "Command not found",
        success: false
      };

      // WHEN the runtime manager returns a failed result
      (runtimeManager.executeCommand as any).mockResolvedValue(expectedResult);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "execute_command",
        arguments: { command }
      })) as ToolCallResponse;

      // Check that the command was executed
      expect(runtimeManager.executeCommand).toHaveBeenCalledWith(
        command,
        expect.any(Object)
      );

      // Check that the result indicates an error
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Exit Code: 1");
      expect(result.content[0].text).toContain("Command not found");
    });

    it("should handle runtime errors", async () => {
      // GIVEN a command execution that throws an error
      const command = "failing-command";
      const error = new Error("Runtime error");

      // WHEN the runtime manager throws an error
      (runtimeManager.executeCommand as any).mockRejectedValue(error);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "execute_command",
        arguments: { command }
      })) as ToolCallResponse;

      // Check that the command was executed
      expect(runtimeManager.executeCommand).toHaveBeenCalledWith(
        command,
        expect.any(Object)
      );

      // Check that the result indicates an error
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Error executing command: Runtime error"
      );
    });
  });

  describe("runtime manager methods", () => {
    it("should allow updating the runtime manager", () => {
      // GIVEN a new runtime manager
      const newRuntimeManager = {} as RuntimeEnvironmentManager;

      // WHEN updating the runtime manager
      server.updateRuntimeManager(newRuntimeManager);

      // THEN the runtime manager should be updated
      expect(server.getRuntimeManager()).toBe(newRuntimeManager);
    });
  });
});
