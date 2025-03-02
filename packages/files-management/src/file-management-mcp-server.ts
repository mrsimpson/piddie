import type { FileSystem } from "@piddie/shared-types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Interface for the file system store
 */
interface FileSystemStore {
  getActiveFileSystem(): FileSystem | null;
}

/**
 * MCP server for file management operations
 * Provides tools for reading, writing, listing, and manipulating files
 *
 * This class implements the MCP server functionality using the MCP SDK.
 */
export class FileManagementMcpServer {
  private fileSystem: FileSystem | null = null;
  public mcpServer: McpServer;

  /**
   * Creates a new FileManagementMcpServer
   * @param fileSystemStore The file system store to use
   */
  constructor(private fileSystemStore: FileSystemStore) {
    this.initializeServer();
  }

  /**
   * Initializes the MCP server with tools for file operations
   */
  private initializeServer(): void {
    // Create a new MCP server
    this.mcpServer = new McpServer({
      name: "file_management",
      version: "1.0.0",
      description:
        "File management operations for reading, writing, and manipulating files"
    });

    // Add read_file tool
    this.mcpServer.tool(
      "read_file",
      "Read the contents of a file",
      {
        path: z
          .string()
          .describe("The path to the file, relative to the project root")
      },
      async (params, _extra) => {
        try {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const content = await fs.readFile(params.path);

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
    this.mcpServer.tool(
      "write_file",
      "Write content to a file",
      {
        path: z
          .string()
          .describe("The path to the file, relative to the project root"),
        content: z.string().describe("The content to write to the file")
      },
      async (params, _extra) => {
        try {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          await fs.writeFile(params.path, params.content);

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
    this.mcpServer.tool(
      "list_files",
      "List files in a directory",
      {
        path: z
          .string()
          .describe("The path to the directory, relative to the project root")
      },
      async (params, _extra) => {
        try {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const entries = await fs.listDirectory(params.path);

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
    this.mcpServer.tool(
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
      async (params, _extra) => {
        try {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const recursive = params.recursive || false;
          await fs.deleteItem(params.path, { recursive });

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
    this.mcpServer.tool(
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
      async (params, _extra) => {
        try {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const recursive = params.recursive || false;
          await fs.createDirectory(params.path, { recursive });

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
    this.mcpServer.tool(
      "stat",
      "Get information about a file or directory",
      {
        path: z
          .string()
          .describe("The path to the item, relative to the project root")
      },
      async (params, _extra) => {
        try {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          const metadata = await fs.getMetadata(params.path);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    isFile: metadata.type === "file",
                    isDirectory: metadata.type === "directory",
                    size: metadata.size,
                    modified: metadata.lastModified
                  },
                  null,
                  2
                )
              }
            ],
            isError: false
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting stat: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );
  }

  /**
   * Gets the active file system from the store
   * @returns The active file system or null if not available
   */
  private async getFileSystem(): Promise<FileSystem | null> {
    if (this.fileSystem) {
      return this.fileSystem;
    }

    const activeFs = this.fileSystemStore.getActiveFileSystem();
    if (!activeFs) {
      console.error("No active file system available");
      return null;
    }

    this.fileSystem = activeFs;
    return this.fileSystem;
  }

  /**
   * Handles an MCP request
   * @param request The request to handle
   * @returns The response to the request
   */
  async handleRequest(request: any): Promise<any> {
    try {
      // Convert from Orchestrator format to MCP format
      const operation = request.operation;
      const params = request.params || {};

      // Find the tool handler for this operation
      const toolHandler = this.findToolHandler(operation);
      if (!toolHandler) {
        return {
          success: false,
          error: `Operation not found: ${operation}`
        };
      }

      // Call the tool handler directly
      const result = await toolHandler(params, {});

      // Convert from MCP format to Orchestrator format
      return {
        success: !result.isError,
        result: result.isError
          ? undefined
          : result.content[0]?.text || "Operation completed successfully",
        error: result.isError
          ? result.content[0]?.text || "Unknown error"
          : undefined
      };
    } catch (error) {
      return {
        success: false,
        error: `Error handling request: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Finds a tool handler for the given operation
   * @param operation The operation name
   * @returns The tool handler function or undefined if not found
   */
  private findToolHandler(
    operation: string
  ): ((params: any, extra: any) => Promise<any>) | undefined {
    // This is a simplified implementation
    // In a real implementation, you would need to access the registered tools from the McpServer

    // For now, we'll use a direct mapping approach
    const handlers: Record<string, (params: any, extra: any) => Promise<any>> =
      {
        read_file: async (params) => {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          try {
            const content = await fs.readFile(params.path);
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
        },
        write_file: async (params) => {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          try {
            await fs.writeFile(params.path, params.content);
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
        },
        list_files: async (params) => {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          try {
            const entries = await fs.listDirectory(params.path);
            return {
              content: [
                { type: "text", text: JSON.stringify(entries, null, 2) }
              ],
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
        },
        delete_item: async (params) => {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          try {
            const recursive = params.recursive || false;
            await fs.deleteItem(params.path, { recursive });
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
        },
        create_directory: async (params) => {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          try {
            const recursive = params.recursive || false;
            await fs.createDirectory(params.path, { recursive });
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
        },
        stat: async (params) => {
          const fs = await this.getFileSystem();
          if (!fs) {
            return {
              content: [{ type: "text", text: "File system not available" }],
              isError: true
            };
          }

          try {
            const metadata = await fs.getMetadata(params.path);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      isFile: metadata.type === "file",
                      isDirectory: metadata.type === "directory",
                      size: metadata.size,
                      modified: metadata.lastModified
                    },
                    null,
                    2
                  )
                }
              ],
              isError: false
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error getting stat: ${error instanceof Error ? error.message : String(error)}`
                }
              ],
              isError: true
            };
          }
        }
      };

    return handlers[operation];
  }

  /**
   * Gets the schema for this MCP server
   * @returns The schema describing the operations supported by this server
   */
  getSchema(): any {
    return {
      name: "file_management",
      description:
        "File management operations for reading, writing, and manipulating files",
      operations: {
        read_file: {
          description: "Read the contents of a file",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "The path to the file, relative to the project root"
              }
            },
            required: ["path"]
          }
        },
        write_file: {
          description: "Write content to a file",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "The path to the file, relative to the project root"
              },
              content: {
                type: "string",
                description: "The content to write to the file"
              }
            },
            required: ["path", "content"]
          }
        },
        list_files: {
          description: "List files in a directory",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "The path to the directory, relative to the project root"
              }
            },
            required: ["path"]
          }
        },
        delete_item: {
          description: "Delete a file or directory",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "The path to the item to delete, relative to the project root"
              },
              recursive: {
                type: "boolean",
                description: "Whether to recursively delete directories"
              }
            },
            required: ["path"]
          }
        },
        create_directory: {
          description: "Create a new directory",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "The path to the directory to create, relative to the project root"
              },
              recursive: {
                type: "boolean",
                description:
                  "Whether to create parent directories if they don't exist"
              }
            },
            required: ["path"]
          }
        },
        stat: {
          description: "Get information about a file or directory",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "The path to the item, relative to the project root"
              }
            },
            required: ["path"]
          }
        }
      }
    };
  }
}
