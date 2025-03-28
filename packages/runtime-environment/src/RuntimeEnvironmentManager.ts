import {
  RuntimeEnvironmentProvider,
  CommandResult,
  CommandOptions
} from "./types";
import {
  RuntimeEnvironmentFactory,
  RuntimeType
} from "./factory/RuntimeEnvironmentFactory";
import { WebContainer } from "@webcontainer/api";
import { WebContainerProvider } from "./providers/WebContainerProvider";

/**
 * Manages the runtime environment for executing commands
 */
export class RuntimeEnvironmentManager {
  private provider: RuntimeEnvironmentProvider;

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
    await this.provider.initialize();
  }

  /**
   * Executes a command in the runtime environment
   * @param command The command to execute
   * @param options Command execution options
   * @returns Result of the command execution
   */
  public async executeCommand(
    command: string,
    options?: CommandOptions
  ): Promise<CommandResult> {
    if (!this.provider.isReady()) {
      await this.initialize();
    }

    return await this.provider.executeCommand(command, options);
  }

  /**
   * Checks if the runtime environment is ready
   */
  public isReady(): boolean {
    return this.provider.isReady();
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
}
