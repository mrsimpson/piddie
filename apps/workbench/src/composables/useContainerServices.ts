import { inject } from "vue";
import type { Ref } from "vue";
import type { WebContainer } from "@webcontainer/api";
import type { WebContainerFileSystem } from "@piddie/files-management";
import type { RuntimeEnvironmentManager } from "@piddie/runtime-environment";

/**
 * Composable to access the shared container services
 * @returns Object containing references to WebContainer, FileSystem, and RuntimeEnvironmentManager
 */
export function useContainerServices() {
  const webContainer = inject<Ref<WebContainer | null>>("webContainer");
  const fileSystem = inject<Ref<WebContainerFileSystem | null>>("fileSystem");
  const runtimeManager =
    inject<Ref<RuntimeEnvironmentManager | null>>("runtimeManager");
  const switchProject =
    inject<(projectId: string) => Promise<void>>("switchProject");

  /**
   * Executes a command in the runtime environment
   * @param command The command to execute
   * @param options Optional command options (cwd, env, timeout)
   * @returns Result of the command execution or null if runtime manager not available
   */
  const executeCommand = async (command: string, options = {}) => {
    if (!runtimeManager?.value) {
      console.error("Runtime manager not initialized");
      return null;
    }

    return await runtimeManager.value.executeCommand(command, options);
  };

  return {
    webContainer,
    fileSystem,
    runtimeManager,
    switchProject,
    executeCommand
  };
}
