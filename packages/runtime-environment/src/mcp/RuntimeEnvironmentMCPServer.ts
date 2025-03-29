import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RuntimeEnvironmentManager } from "../RuntimeEnvironmentManager";
import { CommandOptions } from "../types";

/**
 * MCP server for runtime environment operations
 * Provides tools for executing commands in the runtime environment
 */
export class RuntimeEnvironmentMCPServer extends McpServer {
  /**
   * The runtime environment manager used for operations
   */
  private runtimeManager: RuntimeEnvironmentManager;

  /**
   * Creates a new RuntimeEnvironmentMCPServer
   * @param runtimeManager The runtime environment manager to use for operations
   */
  constructor(runtimeManager: RuntimeEnvironmentManager) {
    super({
      name: "runtime_environment",
      version: "1.0.0",
      description: "Runtime environment operations for executing commands"
    });

    this.runtimeManager = runtimeManager;

    // Initialize the runtime if needed
    if (!this.runtimeManager.isReady()) {
      this.runtimeManager.initialize().catch((error) => {
        console.error("Failed to initialize runtime environment:", error);
      });
    }

    this.initializeServer();
  }

  /**
   * Initializes the MCP server with tools for runtime operations
   */
  private initializeServer(): void {
    // Add execute_command tool
    this.tool(
      "execute_command",
      "Execute a command in the runtime environment",
      {
        command: z.string().describe("The command to execute"),
        cwd: z
          .string()
          .optional()
          .describe("The working directory for the command"),
        env: z
          .record(z.string())
          .optional()
          .describe("Environment variables for the command"),
        timeout: z.number().optional().describe("Timeout in milliseconds")
      },
      async (params) => {
        try {
          if (!this.runtimeManager.isReady()) {
            return {
              content: [
                { type: "text", text: "Runtime environment not ready" }
              ],
              isError: true
            };
          }

          const options: CommandOptions = {};
          if (params.cwd) options.cwd = params.cwd;
          if (params.env) options.env = params.env;
          if (params.timeout) options.timeout = params.timeout;

          const result = await this.runtimeManager.executeCommand(
            params.command,
            options
          );

          // Format the result in a user-friendly way
          const formattedOutput = [
            `Exit Code: ${result.exitCode}`,
            result.stdout ? `\nStdout:\n${result.stdout}` : "",
            result.stderr ? `\nStderr:\n${result.stderr}` : ""
          ].join("");

          return {
            content: [{ type: "text", text: formattedOutput }],
            isError: !result.success
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error executing command: ${
                  error instanceof Error ? error.message : String(error)
                }`
              }
            ],
            isError: true
          };
        }
      }
    );
  }

  /**
   * Updates the runtime environment manager
   * @param runtimeManager The new runtime environment manager to use
   */
  updateRuntimeManager(runtimeManager: RuntimeEnvironmentManager): void {
    this.runtimeManager = runtimeManager;
  }

  /**
   * Gets the current runtime environment manager
   * @returns The current runtime environment manager
   */
  getRuntimeManager(): RuntimeEnvironmentManager {
    return this.runtimeManager;
  }
}
