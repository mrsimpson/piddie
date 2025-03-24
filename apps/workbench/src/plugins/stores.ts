import type { App } from "vue";
import { createPinia } from "pinia";
import { useChatStore } from "@piddie/chat-management-ui-vue";
import { useFileSystemStore } from "@piddie/files-management-ui-vue";
import { useThemeStore } from "@piddie/common-ui-vue";
import { useLlmStore } from "@piddie/llm-integration-ui-vue";
import { useLayoutStore } from "../stores/layout";
import { useProjectStore } from "@piddie/project-management-ui-vue";

export function installStores(app: App) {
  const pinia = createPinia();
  app.use(pinia);

  // Create store instances with explicit pinia instance
  const chatStore = useChatStore(pinia);
  const fileSystemStore = useFileSystemStore(pinia);
  const themeStore = useThemeStore(pinia);
  const llmStore = useLlmStore(pinia);
  const layoutStore = useLayoutStore(pinia);
  const projectStore = useProjectStore(pinia);

  // Provide all stores
  app.provide("chatStore", chatStore);
  app.provide("fileSystemStore", fileSystemStore);
  app.provide("themeStore", themeStore);
  app.provide("llmStore", llmStore);
  app.provide("layoutStore", layoutStore);
  app.provide("projectStore", projectStore);

  return {
    pinia,
    stores: {
      chatStore,
      fileSystemStore,
      themeStore,
      llmStore,
      layoutStore,
      projectStore
    }
  };
}
