import type { FileSystem } from "@piddie/shared-types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * MCP server for file management operations
 * Provides tools for reading, writing, listing, and manipulating files
 *
 * This class extends the McpServer from the MCP SDK.
 */
export class FileManagementMcpServer extends McpServer {
  /**
   * The file system used for operations
   */
  private fileSystem: FileSystem | null;

  /**
   * Creates a new FileManagementMcpServer
   * @param fileSystem The file system to use for operations
   */
  constructor(fileSystem: FileSystem | null) {
    super({
      name: "file_management",
      version: "1.0.0",
      description:
        "File management operations for reading, writing, and manipulating files"
    });

    this.fileSystem = fileSystem;
    this.initializeServer();
  }

  /**
   * Initializes the MCP server with tools for file operations
   */
  private initializeServer(): void {
    // Add read_file tool
    this.tool(
      "read_file",
      "Read the contents of a file",
      {
        path: z
          .string()
          .describe("The path to the file, relative to the project root")
      },
      async (params) => {
        try {
          if (!this.fileSystem) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const content = await this.fileSystem.readFile(params.path);

          return {
            content: [{ type: "text", text: content }],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );

    // Add write_file tool
    this.tool(
      "write_file",
      "Write content to a file",
      {
        path: z
          .string()
          .describe("The path to the file, relative to the project root"),
        content: z.string().describe("The content to write to the file")
      },
      async (params) => {
        try {
          if (!this.fileSystem) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          await this.fileSystem.writeFile(params.path, params.content);

          return {
            content: [
              { type: "text", text: `Successfully wrote to ${params.path}` }
            ],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error writing file: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );

    // Add list_files tool
    this.tool(
      "list_files",
      "List files in a directory",
      {
        path: z
          .string()
          .describe("The path to the directory, relative to the project root")
      },
      async (params) => {
        try {
          if (!this.fileSystem) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const entries = await this.fileSystem.listDirectory(params.path);

          return {
            content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error listing files: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );

    // Add delete_item tool
    this.tool(
      "delete_item",
      "Delete a file or directory",
      {
        path: z
          .string()
          .describe(
            "The path to the item to delete, relative to the project root"
          ),
        recursive: z
          .boolean()
          .optional()
          .describe("Whether to recursively delete directories")
      },
      async (params) => {
        try {
          if (!this.fileSystem) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const recursive = params.recursive || false;
          await this.fileSystem.deleteItem(params.path, { recursive });

          return {
            content: [
              { type: "text", text: `Successfully deleted ${params.path}` }
            ],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error deleting item: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );

    // Add create_directory tool
    this.tool(
      "create_directory",
      "Create a new directory",
      {
        path: z
          .string()
          .describe(
            "The path to the directory to create, relative to the project root"
          ),
        recursive: z
          .boolean()
          .optional()
          .describe("Whether to create parent directories if they don't exist")
      },
      async (params) => {
        try {
          if (!this.fileSystem) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const recursive = params.recursive || false;
          await this.fileSystem.createDirectory(params.path, { recursive });

          return {
            content: [
              {
                type: "text",
                text: `Successfully created directory ${params.path}`
              }
            ],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error creating directory: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );

    // Add stat tool
    this.tool(
      "stat",
      "Get information about a file or directory",
      {
        path: z
          .string()
          .describe("The path to the item, relative to the project root")
      },
      async (params) => {
        try {
          if (!this.fileSystem) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const metadata = await this.fileSystem.getMetadata(params.path);

          return {
            content: [
              { type: "text", text: JSON.stringify(metadata, null, 2) }
            ],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting metadata: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );
  }

  /**
   * Updates the file system
   * @param fileSystem The new file system to use
   */
  updateFileSystem(fileSystem: FileSystem | null): void {
    this.fileSystem = fileSystem;
  }

  /**
   * Gets the current file system
   * @returns The current file system or null if not available
   */
  getFileSystem(): FileSystem | null {
    return this.fileSystem;
  }
}
