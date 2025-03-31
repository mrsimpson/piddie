import {
  RuntimeEnvironmentProvider,
  CommandResult,
  CommandOptions,
  RuntimeEnvironment,
  ExecuteCommandRequest
} from "./types";
import {
  RuntimeEnvironmentFactory,
  RuntimeType
} from "./factory/RuntimeEnvironmentFactory";
import { WebContainer } from "@webcontainer/api";
import { WebContainerProvider } from "./providers/WebContainerProvider";
import type { FileSystem } from "@piddie/shared-types";

/**
 * Manages the runtime environment for executing commands
 */
export class RuntimeEnvironmentManager implements RuntimeEnvironment {
  private provider: RuntimeEnvironmentProvider | null = null;
  private isInitialized = false;

  /**
   * Creates a new RuntimeEnvironmentManager
   * @param provider Optional existing provider instance
   * @param runtimeType Optional type of runtime to use (if provider not specified)
   */
  constructor(
    provider?: RuntimeEnvironmentProvider,
    runtimeType: RuntimeType = RuntimeType.WEB_CONTAINER
  ) {
    if (provider) {
      this.provider = provider;
    } else {
      this.provider = RuntimeEnvironmentFactory.createProvider(runtimeType);
    }
  }

  /**
   * Creates a RuntimeEnvironmentManager with an existing WebContainer instance
   * @param webContainer The WebContainer instance to use
   * @returns A new RuntimeEnvironmentManager using the provided WebContainer
   */
  public static withWebContainer(
    webContainer: WebContainer
  ): RuntimeEnvironmentManager {
    const provider = new WebContainerProvider(webContainer);
    return new RuntimeEnvironmentManager(provider);
  }

  /**
   * Initializes the runtime environment
   */
  public async initialize(): Promise<void> {
    if (!this.provider) {
      throw new Error("No runtime environment provider set");
    }
    await this.provider.initialize();
    this.isInitialized = true;
  }

  /**
   * Executes a command in the runtime environment
   * Implementation for the RuntimeEnvironment interface
   * @param requestOrCommand The command execution request or command string
   * @param options Command execution options (when first param is a string)
   * @returns Result of the command execution
   */
  public async executeCommand(
    requestOrCommand: ExecuteCommandRequest | string,
    options?: CommandOptions
  ): Promise<CommandResult> {
    if (!this.provider) {
      throw new Error("No runtime environment provider set");
    }

    if (typeof requestOrCommand === "string") {
      return await this.provider.executeCommand(requestOrCommand, options);
    } else {
      return await this.provider.executeCommand(
        requestOrCommand.command,
        requestOrCommand.options
      );
    }
  }

  /**
   * Checks if the runtime environment is ready
   */
  public isReady(): boolean {
    return this.provider?.isReady() || false;
  }

  /**
   * Changes the runtime environment provider
   * @param providerOrType New provider instance or runtime type
   */
  public setProvider(
    providerOrType: RuntimeEnvironmentProvider | RuntimeType
  ): void {
    if (typeof providerOrType === "string") {
      this.provider = RuntimeEnvironmentFactory.createProvider(providerOrType);
    } else {
      this.provider = providerOrType;
    }
  }

  public getFileSystem(): FileSystem {
    if (!this.provider) {
      throw new Error("No runtime environment provider set");
    }
    return this.provider.getFileSystem();
  }

  /**
   * Disposes of the runtime environment and its resources
   */
  public async dispose(): Promise<void> {
    if (this.provider) {
      try {
        await this.provider.dispose();
      } catch (error) {
        console.error("Error disposing runtime environment provider:", error);
      }
      this.provider = null;
    }
    this.isInitialized = false;
  }
}
