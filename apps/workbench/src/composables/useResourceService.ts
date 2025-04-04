import { ref } from "vue";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ActionsManager } from "@piddie/actions";
import {
  RuntimeEnvironmentManager,
  WebContainerProvider,
  RuntimeEnvironmentMCPServer
} from "@piddie/runtime-environment";
import {
  FileSyncManager,
  FileManagementMcpServer
} from "@piddie/files-management";
import { useFileSystemStore } from "@piddie/files-management-ui-vue";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { useChatStore } from "@piddie/chat-management-ui-vue";

/**
 * Manages project-specific MCP servers and runtime environments
 */
class ResourceService {
  private static instance: ResourceService;
  private actionsManager: ActionsManager;
  private currentProjectId = ref<string | null>(null);

  // Current active managers
  private currentRuntimeManager: RuntimeEnvironmentManager | null = null;

  // we'll be manipulating the stores, so reference them
  private fileSystemStore = useFileSystemStore();
  private projectStore = useProjectStore();
  private chatStore = useChatStore();

  // MCP servers by project and name
  private servers = new Map<string, Map<string, McpServer>>();

  private constructor() {
    this.actionsManager = ActionsManager.getInstance();
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): ResourceService {
    if (!ResourceService.instance) {
      ResourceService.instance = new ResourceService();
    }
    return ResourceService.instance;
  }

  /**
   * Register an MCP server for a project
   * @param projectId The project ID
   * @param serverName The server name
   * @param server The MCP server instance
   */
  public async registerServer(
    projectId: string,
    serverName: string,
    server: McpServer
  ): Promise<void> {
    // Get or create the map of servers for this project
    if (!this.servers.has(projectId)) {
      this.servers.set(projectId, new Map());
    }

    const projectServers = this.servers.get(projectId)!;

    // Store the server reference
    projectServers.set(serverName, server);

    // If this is the active project, register with ActionsManager
    if (projectId === this.currentProjectId.value) {
      await this.actionsManager.registerServer(server, serverName);
    }
  }

  /**
   * Set the active project and initialize its resources
   * @param projectId The project ID to activate
   */
  public async activateProject(projectId: string): Promise<void> {
    // Skip if already the active project
    if (projectId === this.currentProjectId.value) return;

    if (this.projectStore.currentProject?.id !== projectId) {
      console.error(
        `Resources of ${projectId} shall be loaded but it's not the current project`
      );
      return;
    }

    console.log(`Activating project: ${projectId}`);

    // Cleanup current project's resources
    if (this.currentProjectId.value) {
      await this.deactivateCurrentProject();
    }

    // Set the new project as active
    this.currentProjectId.value = projectId;

    try {
      // Ensure the chat is loaded as the current chat
      await this.chatStore.loadChat(this.projectStore.currentProject?.chatId);

      // Initialize RuntimeEnvironment first
      this.currentRuntimeManager = new RuntimeEnvironmentManager();
      const provider = new WebContainerProvider();
      this.currentRuntimeManager.setProvider(provider);
      await this.currentRuntimeManager.initialize();
      console.log(
        `RuntimeEnvironmentManager initialized for project ${projectId}`
      );

      // Get the runtime filesystem
      const runtimeFs = this.currentRuntimeManager.getFileSystem();

      // Initialize FileSystemStore with runtime filesystem

      await this.fileSystemStore.initializeForProject({
        projectId,
        runtimeFileSystem: runtimeFs
      });
      console.log(`FileSystemStore initialized for project ${projectId}`);

      // Create and register MCP servers
      const runtimeServer = new RuntimeEnvironmentMCPServer(
        this.currentRuntimeManager
      );
      await this.registerServer(
        projectId,
        "runtime_environment",
        runtimeServer
      );

      const fileServer = new FileManagementMcpServer(runtimeFs);
      await this.registerServer(projectId, "file_management", fileServer);

      console.log(`MCP servers registered for project ${projectId}`);
    } catch (error) {
      console.error(
        `Failed to initialize resources for project ${projectId}:`,
        error
      );
      // Cleanup on failure
      await this.deactivateCurrentProject();
      throw error;
    }
  }

  /**
   * Deactivate the current project and cleanup resources
   */
  public async deactivateCurrentProject(): Promise<void> {
    if (!this.currentProjectId.value) return;

    // Unregister MCP servers
    const projectServers = this.servers.get(this.currentProjectId.value);
    if (projectServers) {
      for (const name of projectServers.keys()) {
        await this.actionsManager.unregisterServer(name);
      }
    }

    // Reset FileSystemStore
    try {
      await this.fileSystemStore.resetStoreState();
    } catch (error) {
      console.error("Failed to reset FileSystemStore:", error);
    }

    // Cleanup RuntimeEnvironmentManager
    if (this.currentRuntimeManager) {
      try {
        await this.currentRuntimeManager.dispose();
        this.currentRuntimeManager = null;
      } catch (error) {
        console.error("Failed to dispose RuntimeEnvironmentManager:", error);
      }
    }

    this.currentProjectId.value = null;
  }

  /**
   * Get a server for the current project
   * @param serverName The server name
   * @returns The MCP server or undefined if not found
   */
  public getActiveServer(serverName: string): McpServer | undefined {
    if (!this.currentProjectId.value) return undefined;
    return this.getProjectServer(this.currentProjectId.value, serverName);
  }

  /**
   * Get a server for a specific project
   * @param projectId The project ID
   * @param serverName The server name
   * @returns The MCP server or undefined if not found
   */
  public getProjectServer(
    projectId: string,
    serverName: string
  ): McpServer | undefined {
    const projectServers = this.servers.get(projectId);
    if (!projectServers) return undefined;
    return projectServers.get(serverName);
  }

  /**
   * Get the active project ID
   * @returns The active project ID or null
   */
  public getCurrentProjectId(): string | null {
    return this.currentProjectId.value;
  }

  /**
   * Get the RuntimeEnvironmentManager for the active project
   * @returns The RuntimeEnvironmentManager or null if not available
   */
  public getRuntimeEnvironmentManager(): RuntimeEnvironmentManager | null {
    return this.currentRuntimeManager;
  }

  /**
   * Get the current FileSyncManager
   * @returns The FileSyncManager or null if not set
   */
  public getFileSyncManager(): FileSyncManager | null {
    return this.fileSystemStore.syncManager as unknown as FileSyncManager;
  }
}

/**
 * Composable to access the resource service
 * @returns The ResourceService instance
 */
export function useResourceService() {
  return ResourceService.getInstance();
}
