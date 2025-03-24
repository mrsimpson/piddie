import type { App } from "vue";
import { useChatStore } from "@piddie/chat-management-ui-vue";
import { useFileSystemStore } from "@piddie/files-management-ui-vue";
import { useThemeStore } from "@piddie/common-ui-vue";
import { useLlmStore } from "@piddie/llm-integration-ui-vue";
import { useLayoutStore } from "../stores/layout";

export function installStores(app: App) {
  // Create store instances
  const chatStore = useChatStore();
  const fileSystemStore = useFileSystemStore();
  const themeStore = useThemeStore();
  const llmStore = useLlmStore();
  const layoutStore = useLayoutStore();

  // Provide all stores
  app.provide("chatStore", chatStore);
  app.provide("fileSystemStore", fileSystemStore);
  app.provide("themeStore", themeStore);
  app.provide("llmStore", llmStore);
  app.provide("layoutStore", layoutStore);
}
