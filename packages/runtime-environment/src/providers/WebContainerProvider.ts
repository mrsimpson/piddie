import {
  RuntimeEnvironmentProvider,
  CommandResult,
  CommandOptions
} from "../types";
import { WebContainer } from "@webcontainer/api";
import { WebContainerFileSystem } from "@piddie/files-management";
import type { FileSystem } from "@piddie/shared-types";

/**
 * Implementation of the WebContainer runtime environment provider
 */
export class WebContainerProvider implements RuntimeEnvironmentProvider {
  private isInitialized = false;
  private container: WebContainer | null = null;
  private fileSystem: WebContainerFileSystem | null = null;

  /**
   * Creates a new WebContainerProvider
   * @param existingContainer Optional existing WebContainer instance to use
   */
  constructor(existingContainer?: WebContainer) {
    if (existingContainer) {
      this.container = existingContainer;
      this.fileSystem = new WebContainerFileSystem(existingContainer);
      this.isInitialized = true;
    }
  }

  /**
   * Get the file system associated with this runtime environment
   */
  public getFileSystem(): FileSystem {
    if (!this.fileSystem) {
      throw new Error("WebContainer file system is not initialized");
    }
    return this.fileSystem;
  }

  /**
   * Initializes the web container instance
   */
  public async initialize(): Promise<void> {
    // Skip initialization if already initialized with an existing container
    if (this.isInitialized) {
      return;
    }

    try {
      // Create new container instance
      this.container = await WebContainer.boot();
      this.fileSystem = new WebContainerFileSystem(this.container);
      await this.fileSystem.initialize();
      this.isInitialized = true;
    } catch (error: unknown) {
      console.error("Failed to initialize web container:", error);
      throw new Error("Web container initialization failed");
    }
  }

  /**
   * Checks if web container is ready
   */
  public isReady(): boolean {
    return this.isInitialized && this.container !== null;
  }

  /**
   * Executes a command in the web container
   */
  public async executeCommand(
    command: string,
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    if (!this.isReady()) {
      throw new Error("Web container is not initialized");
    }

    try {
      // Parse command to get command name and args
      const parts = command.split(" ").filter((part) => part.trim() !== "");
      const cmd = parts[0];
      const args = parts.slice(1);

      // Execute the command
      const process = await this.container!.spawn(cmd, args, {
        cwd: options.cwd,
        env: options.env
      });

      // Collect stdout and stderr
      let stdout = "";

      // Create a writer for standard output
      const stdoutWriter = new WritableStream({
        write(chunk) {
          stdout += chunk;
        }
      });

      // Pipe the output stream
      process.output.pipeTo(stdoutWriter).catch((error: unknown) => {
        console.error("Error processing output:", error);
      });

      // Wait for process to exit
      const exitCode = await process.exit;

      return {
        exitCode,
        stdout,
        stderr: "", // WebContainer API doesn't provide separate stderr in the current version
        success: exitCode === 0
      };
    } catch (error: unknown) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        success: false
      };
    }
  }

  /**
   * Disposes of the web container and its resources
   */
  public async dispose(): Promise<void> {
    this.container?.teardown();
    this.container = null;
    this.isInitialized = false;
  }
}
