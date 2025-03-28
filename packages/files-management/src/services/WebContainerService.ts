import { WebContainer } from "@webcontainer/api";

/**
 * Service for managing WebContainer instances across the application.
 * This service follows a strict pattern that requires explicit creation
 * of WebContainer instances rather than automatic creation on demand.
 */
export class WebContainerService {
  private static instance: WebContainerService;
  private containerInstance: WebContainer | null = null;

  private constructor() {}

  /**
   * Get the singleton instance of WebContainerService
   */
  public static getInstance(): WebContainerService {
    if (!WebContainerService.instance) {
      WebContainerService.instance = new WebContainerService();
    }
    return WebContainerService.instance;
  }

  /**
   * Get the current WebContainer instance
   * @throws Error if no container has been initialized
   */
  public getContainer(): WebContainer {
    if (!this.containerInstance) {
      throw new Error(
        "WebContainer not initialized. Call createContainer first."
      );
    }
    return this.containerInstance;
  }

  /**
   * Check if a WebContainer instance exists
   */
  public hasContainer(): boolean {
    return this.containerInstance !== null;
  }

  /**
   * Create a new WebContainer instance
   * @throws Error if a container already exists
   */
  public async createContainer(): Promise<WebContainer> {
    if (this.containerInstance) {
      throw new Error(
        "WebContainer already exists. Call reset() before creating a new one."
      );
    }

    console.log("Creating new WebContainer instance");
    try {
      this.containerInstance = await WebContainer.boot();
      await this.containerInstance.mount({});
      console.log("WebContainer created and mounted successfully");
      return this.containerInstance;
    } catch (error) {
      console.error("Failed to create WebContainer:", error);
      this.containerInstance = null;
      throw error;
    }
  }

  /**
   * Reset the WebContainer service, tearing down any existing container
   */
  public async reset(): Promise<void> {
    if (this.containerInstance) {
      try {
        console.log("Tearing down WebContainer");
        await this.containerInstance.teardown();
        console.log("WebContainer torn down successfully");
      } catch (error) {
        console.warn("Error during WebContainer teardown:", error);
      } finally {
        this.containerInstance = null;
      }
    }
  }

  /**
   * Set an existing WebContainer instance
   * @throws Error if a container already exists
   */
  public setContainer(container: WebContainer): void {
    if (this.containerInstance) {
      throw new Error(
        "WebContainer already exists. Call reset() before setting a new one."
      );
    }
    this.containerInstance = container;
    console.log("Existing WebContainer set in service");
  }
}

// Export a singleton instance
export const webContainerService = WebContainerService.getInstance();
