import { RuntimeEnvironmentProvider } from "../types";

/**
 * Enum defining the types of runtime environments available
 */
export enum RuntimeType {
  WEB_CONTAINER = "web-container"
  // Future types can be added here (e.g., DOCKER = 'docker')
}

/**
 * Factory for creating runtime environment providers
 */
export class RuntimeEnvironmentFactory {
  private static providerImplementations: Record<
    RuntimeType,
    new () => RuntimeEnvironmentProvider
  > = {} as any;

  /**
   * Register a provider implementation for a runtime type
   * @param type The runtime type
   * @param implementation The provider implementation class
   */
  public static registerProvider(
    type: RuntimeType,
    implementation: new () => RuntimeEnvironmentProvider
  ): void {
    this.providerImplementations[type] = implementation;
  }

  /**
   * Creates the appropriate runtime environment provider
   * @param type The type of runtime environment to create
   * @returns A new instance of the runtime environment provider
   * @throws Error if the requested provider type is not registered
   */
  public static createProvider(type: RuntimeType): RuntimeEnvironmentProvider {
    const ProviderClass = this.providerImplementations[type];

    if (!ProviderClass) {
      throw new Error(`No provider registered for runtime type: ${type}`);
    }

    return new ProviderClass();
  }
}
