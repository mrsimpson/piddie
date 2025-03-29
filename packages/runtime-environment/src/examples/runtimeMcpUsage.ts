import { RuntimeEnvironmentManager } from "../RuntimeEnvironmentManager";
import { RuntimeEnvironmentMCPServer } from "../mcp/RuntimeEnvironmentMCPServer";

/**
 * Example of how to use the RuntimeEnvironmentMCPServer
 * with the McpHost for command execution capabilities
 */
async function main() {
  try {
    // Import the McpHost class dynamically to handle missing dependencies gracefully
    let McpHost;
    try {
      const mcpModule = await import("@piddie/llm-integration/src/mcp/McpHost");
      McpHost = mcpModule.McpHost;
    } catch (error) {
      console.error("Error importing McpHost:", error);
      console.log(
        "This example requires @piddie/llm-integration to be installed."
      );
      console.log(
        "Please make sure the package is available in your workspace."
      );
      return;
    }

    // Create a standalone MCP host
    const mcpHost = new McpHost();

    // Initialize a RuntimeEnvironmentManager
    console.log("Initializing runtime environment...");
    const runtimeManager = new RuntimeEnvironmentManager();
    try {
      await runtimeManager.initialize();
      console.log("Runtime environment initialized");
    } catch (error) {
      console.error("Failed to initialize runtime environment:", error);
      console.log("Make sure the required runtime provider is registered.");
      return;
    }

    // Create an MCP server that uses the runtime manager
    const runtimeServer = new RuntimeEnvironmentMCPServer(runtimeManager);

    // Register the server with the MCP host
    console.log("Registering runtime environment server...");
    try {
      await mcpHost.registerLocalServer(runtimeServer, "runtime-environment");
      console.log("Runtime environment server registered");
    } catch (error) {
      console.error("Failed to register server:", error);
      return;
    }

    // List available tools
    console.log("Available tools:");
    const tools = await mcpHost.listTools();
    console.log(tools);

    // Example: Execute a command through the MCP host
    console.log("Executing command...");
    try {
      const result = await mcpHost.callTool("execute_command", {
        command: "echo 'Hello, MCP runtime environment!'"
      });
      console.log("Command result:", result);
    } catch (error) {
      console.error("Error executing command:", error);
    }

    // Clean up
    console.log("Cleaning up...");
    mcpHost.unregisterServer("runtime-environment");
    console.log("Runtime environment server unregistered");
  } catch (error) {
    console.error("Unexpected error:", error);
  }
}

// Run the example if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Error in main:", error);
    process.exit(1);
  });
}

export { main };
