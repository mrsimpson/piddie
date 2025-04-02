import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileManagementMcpServer } from "../FileManagementMcpServer";
import type { FileSystem, FileSystemItem } from "@piddie/shared-types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Define the response type for tool calls
interface ToolCallResponse {
  content: Array<{ type: string; text: string }>;
  isError: boolean;
}

describe("FileManagementMcpServer", () => {
  let server: FileManagementMcpServer;
  let fileSystem: FileSystem;
  let client: Client;

  beforeEach(async () => {
    // Create a FileSystem with mocked methods
    fileSystem = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      listDirectory: vi.fn(),
      deleteItem: vi.fn(),
      createDirectory: vi.fn(),
      getMetadata: vi.fn(),
      initialize: vi.fn(),
      exists: vi.fn(),
      lock: vi.fn(),
      unlock: vi.fn(),
      forceUnlock: vi.fn(),
      getState: vi.fn(),
      validateStateTransition: vi.fn(),
      getCurrentState: vi.fn(),
      transitionTo: vi.fn(),
      getLockState: vi.fn(),
      dispose: vi.fn()
    } as unknown as FileSystem;

    // Initialize the server with the file system
    server = new FileManagementMcpServer(fileSystem);

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

  describe("read_file tool", () => {
    it("should read a file and return its contents", async () => {
      // GIVEN a file to read
      const path = "test.txt";
      const expectedContent = "file content";

      // WHEN the file system returns content
      (fileSystem.readFile as any).mockResolvedValue(expectedContent);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "read_file",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that readFile was called with the right path
      expect(fileSystem.readFile).toHaveBeenCalledWith(path);

      // Check that the result contains the file content
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe(expectedContent);
    });

    it("should handle file read errors", async () => {
      // GIVEN a file that will cause an error
      const path = "nonexistent.txt";
      const error = new Error("File not found");

      // WHEN the file system throws an error
      (fileSystem.readFile as any).mockRejectedValue(error);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "read_file",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that the result indicates an error
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Error reading file: File not found"
      );
    });
  });

  describe("write_file tool", () => {
    it("should write content to a file", async () => {
      // GIVEN a file and content to write
      const path = "test.txt";
      const content = "new content";

      // WHEN the file system successfully writes
      (fileSystem.writeFile as any).mockResolvedValue(undefined);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "write_file",
        arguments: { path, content }
      })) as ToolCallResponse;

      // Check that writeFile was called with the right parameters
      expect(fileSystem.writeFile).toHaveBeenCalledWith(path, content);

      // Check that the result indicates success
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain(`Successfully wrote to ${path}`);
    });

    it("should handle file write errors", async () => {
      // GIVEN a file write that will fail
      const path = "test.txt";
      const content = "new content";
      const error = new Error("Permission denied");

      // WHEN the file system throws an error
      (fileSystem.writeFile as any).mockRejectedValue(error);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "write_file",
        arguments: { path, content }
      })) as ToolCallResponse;

      // Check that the result indicates an error
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Error writing file: Permission denied"
      );
    });
  });

  describe("list_files tool", () => {
    it("should list directory contents", async () => {
      // GIVEN a directory to list
      const path = "test-dir";
      const expectedEntries: FileSystemItem[] = [
        { path: "file1.txt", type: "file", lastModified: Date.now() },
        { path: "subdir", type: "directory", lastModified: Date.now() }
      ];

      // WHEN the file system returns directory contents
      (fileSystem.listDirectory as any).mockResolvedValue(expectedEntries);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "list_files",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that listDirectory was called with the right path
      expect(fileSystem.listDirectory).toHaveBeenCalledWith(path);

      // Check that the result contains the directory entries
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe(
        JSON.stringify(expectedEntries, null, 2)
      );
    });

    it("should handle directory listing errors", async () => {
      // GIVEN a directory listing that will fail
      const path = "nonexistent-dir";
      const error = new Error("Directory not found");

      // WHEN the file system throws an error
      (fileSystem.listDirectory as any).mockRejectedValue(error);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "list_files",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that the result indicates an error
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Error listing files: Directory not found"
      );
    });
  });

  describe("file system methods", () => {
    it("should allow updating the file system", () => {
      // GIVEN a new file system
      const newFileSystem = {} as FileSystem;

      // WHEN updating the file system
      server.updateFileSystem(newFileSystem);

      // THEN the file system should be updated
      expect(server.getFileSystem()).toBe(newFileSystem);
    });
  });

  describe("delete_item tool", () => {
    it("should delete a file", async () => {
      // GIVEN a file to delete
      const path = "test.txt";

      // WHEN the file system successfully deletes
      (fileSystem.deleteItem as any).mockResolvedValue(undefined);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "delete_item",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that deleteItem was called with the right parameters
      expect(fileSystem.deleteItem).toHaveBeenCalledWith(path, {
        recursive: false
      });

      // Check that the result indicates success
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain(`Successfully deleted ${path}`);
    });

    it("should delete a directory recursively", async () => {
      // GIVEN a directory to delete recursively
      const path = "test-dir";

      // WHEN the file system successfully deletes
      (fileSystem.deleteItem as any).mockResolvedValue(undefined);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "delete_item",
        arguments: { path, recursive: true }
      })) as ToolCallResponse;

      // Check that deleteItem was called with recursive option
      expect(fileSystem.deleteItem).toHaveBeenCalledWith(path, {
        recursive: true
      });

      // Check that the result indicates success
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain(`Successfully deleted ${path}`);
    });

    it("should handle deletion errors", async () => {
      // GIVEN a deletion that will fail
      const path = "protected.txt";
      const error = new Error("Permission denied");

      // WHEN the file system throws an error
      (fileSystem.deleteItem as any).mockRejectedValue(error);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "delete_item",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that the result indicates an error
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Error deleting item: Permission denied"
      );
    });
  });

  describe("create_directory tool", () => {
    it("should create a directory", async () => {
      // GIVEN a directory to create
      const path = "new-dir";

      // WHEN the file system successfully creates the directory
      (fileSystem.createDirectory as any).mockResolvedValue(undefined);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "create_directory",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that createDirectory was called with the right parameters
      expect(fileSystem.createDirectory).toHaveBeenCalledWith(path, {
        recursive: false
      });

      // Check that the result indicates success
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain(
        `Successfully created directory ${path}`
      );
    });

    it("should create a directory recursively", async () => {
      // GIVEN a nested directory to create
      const path = "parent/child/dir";

      // WHEN the file system successfully creates the directory
      (fileSystem.createDirectory as any).mockResolvedValue(undefined);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "create_directory",
        arguments: { path, recursive: true }
      })) as ToolCallResponse;

      // Check that createDirectory was called with recursive option
      expect(fileSystem.createDirectory).toHaveBeenCalledWith(path, {
        recursive: true
      });

      // Check that the result indicates success
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain(
        `Successfully created directory ${path}`
      );
    });

    it("should handle directory creation errors", async () => {
      // GIVEN a directory creation that will fail
      const path = "invalid/path";
      const error = new Error("Parent directory does not exist");

      // WHEN the file system throws an error
      (fileSystem.createDirectory as any).mockRejectedValue(error);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "create_directory",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that the result indicates an error
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Error creating directory: Parent directory does not exist"
      );
    });
  });

  describe("stat tool", () => {
    it("should get file metadata", async () => {
      // GIVEN a file to get metadata for
      const path = "test.txt";
      const expectedMetadata = {
        path: "test.txt",
        type: "file",
        hash: "abc123",
        size: 1024,
        lastModified: Date.now(),
        mimeType: "text/plain"
      };

      // WHEN the file system returns metadata
      (fileSystem.getMetadata as any).mockResolvedValue(expectedMetadata);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "stat",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that getMetadata was called with the right path
      expect(fileSystem.getMetadata).toHaveBeenCalledWith(path);

      // Check that the result contains the metadata
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe(
        JSON.stringify(expectedMetadata, null, 2)
      );
    });

    it("should handle metadata retrieval errors", async () => {
      // GIVEN a metadata request that will fail
      const path = "nonexistent.txt";
      const error = new Error("File not found");

      // WHEN the file system throws an error
      (fileSystem.getMetadata as any).mockRejectedValue(error);

      // THEN call the tool through the client
      const result = (await client.callTool({
        name: "stat",
        arguments: { path }
      })) as ToolCallResponse;

      // Check that the result indicates an error
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Error getting metadata: File not found"
      );
    });
  });
});
