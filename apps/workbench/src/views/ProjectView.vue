<script setup lang="ts">
import {
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  provide,
  computed,
  shallowRef
} from "vue";
import { useRoute } from "vue-router";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { useFileSystemStore } from "@piddie/files-management-ui-vue";
import { FilesPanel } from "@piddie/files-management-ui-vue";
import ChatPanel from "@/components/ChatPanel.vue";
import RuntimePanel from "@/components/RuntimePanel.vue";
import { ResizablePanel } from "@piddie/common-ui-vue";
import { settingsManager, WorkbenchSettingKey } from "@piddie/settings";
import { WebContainer } from "@webcontainer/api";
import {
  WebContainerFileSystem,
  BrowserFileSystem,
  webContainerService
} from "@piddie/files-management";
import { RuntimeEnvironmentManager } from "@piddie/runtime-environment";
import "@piddie/files-management-ui-vue/style";
import "@piddie/project-management-ui-vue/style";

const route = useRoute();
const projectStore = useProjectStore();
const fileSystemStore = useFileSystemStore();
const error = ref<Error | null>(null);

const projectId = ref<string | null>(null);
const isFileExplorerCollapsed = ref(false);
const isChatPanelCollapsed = ref(false);
const isRuntimePanelCollapsed = ref(false);

// Panel widths
const fileExplorerWidth = ref(250);
const chatPanelWidth = ref(300);
const runtimePanelWidth = ref(500);

// WebContainer related refs
const webContainerInstance = ref<WebContainer | null>(null);
const containerFileSystem = ref<WebContainerFileSystem | null>(null);
const runtimeManager = ref<RuntimeEnvironmentManager | null>(null);
const containerInitializing = ref(false);
const containerError = ref<Error | null>(null);

// Create a reactive reference for the sync manager
const syncManagerRef = shallowRef(fileSystemStore.syncManager);

// Provide the sync manager reference
provide("syncManager", syncManagerRef);
// Provide WebContainer references
provide("webContainer", webContainerInstance);
provide("fileSystem", containerFileSystem);
provide("runtimeManager", runtimeManager);

// Determine which panel should fill available space
const filesPanel = {
  shouldFillSpace: computed(
    () => isRuntimePanelCollapsed.value && !isFileExplorerCollapsed.value
  )
};

const runtimePanel = {
  shouldFillSpace: computed(() => !isRuntimePanelCollapsed.value)
};

async function initializeFromRoute() {
  projectId.value = route.params.id as string;
  if (projectId.value) {
    try {
      error.value = null;
      await projectStore.setCurrentProject(projectId.value);

      // Initialize WebContainer for this project
      await initializeWebContainer();

      // Update the sync manager reference
      syncManagerRef.value = fileSystemStore.syncManager;
    } catch (err) {
      console.error("Failed to initialize project:", err);
      error.value = err as Error;
    }
  }
}

// Initialize WebContainer for the current project
async function initializeWebContainer() {
  containerInitializing.value = true;
  containerError.value = null;

  try {
    console.log("Initializing WebContainer for project:", projectId.value);

    // Initialize file system store - this will handle WebContainer creation/setup
    console.log("Initializing file system store for project");
    await fileSystemStore.initializeForProject({
      id: projectId.value as string,
      name: projectStore.currentProject?.name || "Unknown Project",
      created: projectStore.currentProject?.created || new Date(),
      lastAccessed: projectStore.currentProject?.lastAccessed || new Date(),
      chatId: projectStore.currentProject?.chatId || ""
    });

    // Get references to WebContainer and WebContainerFileSystem if available
    if (webContainerService.hasContainer()) {
      webContainerInstance.value = webContainerService.getContainer();
      containerFileSystem.value = fileSystemStore.getWebContainerFileSystem();

      // Initialize the RuntimeEnvironmentManager with the container
      console.log("Setting up RuntimeEnvironmentManager");
      runtimeManager.value = RuntimeEnvironmentManager.withWebContainer(
        webContainerInstance.value as any
      );

      if (runtimeManager.value) {
        await runtimeManager.value.initialize();
        console.log("RuntimeEnvironmentManager initialized successfully");
      }
    } else {
      console.warn("No WebContainer available after initialization");
      containerError.value = new Error("WebContainer initialization failed");
    }

    containerInitializing.value = false;
  } catch (err) {
    console.error("Failed to initialize WebContainer:", err);
    containerError.value = err as Error;
    containerInitializing.value = false;
  }
}

// Initialize when the component is mounted
onMounted(async () => {
  await initializeFromRoute();
});

// Watch for route changes
watch(
  () => route.params.id,
  async (newId, oldId) => {
    if (newId && newId !== oldId) {
      console.log(`Switching from project ${oldId} to ${newId}`);
      projectId.value = newId as string;
      await initializeFromRoute();
    }
  }
);

// Watch for changes in RuntimePanel collapse state
watch(
  () => isRuntimePanelCollapsed.value,
  (collapsed) => {
    // When runtime panel is collapsed, we need to update the width of files panel
    // to ensure it takes the full available space
    if (collapsed && !isFileExplorerCollapsed.value) {
      console.log("Runtime panel collapsed, adjusting layout...");
    }
  }
);

// Handle panel collapse events
function onFileExplorerCollapse(collapsed: boolean) {
  isFileExplorerCollapsed.value = collapsed;
}

function onChatPanelCollapse(collapsed: boolean) {
  isChatPanelCollapsed.value = collapsed;
}

function onRuntimePanelCollapse(collapsed: boolean) {
  isRuntimePanelCollapsed.value = collapsed;
}
</script>

<template>
  <div class="project-view">
    <div class="panels-container">
      <!-- Chat Panel -->
      <ResizablePanel
        v-model:width="chatPanelWidth"
        v-model:collapsed="isChatPanelCollapsed"
        direction="left"
        :min-width="100"
        :settings-width-key="WorkbenchSettingKey.CHAT_PANEL_WIDTH"
        :settings-collapsed-key="WorkbenchSettingKey.IS_CHAT_PANEL_COLLAPSED"
      >
        <ChatPanel
          :initial-collapsed="isChatPanelCollapsed"
          @collapse="onChatPanelCollapse"
        />
      </ResizablePanel>

      <!-- Files Panel -->
      <ResizablePanel
        v-model:width="fileExplorerWidth"
        v-model:collapsed="isFileExplorerCollapsed"
        direction="left"
        :min-width="100"
        :settings-width-key="WorkbenchSettingKey.FILE_EXPLORER_WIDTH"
        :settings-collapsed-key="WorkbenchSettingKey.IS_FILE_EXPLORER_COLLAPSED"
        :fill-available="filesPanel.shouldFillSpace.value"
      >
        <FilesPanel
          :systems="fileSystemStore.systems"
          :error="error"
          :initial-collapsed="isFileExplorerCollapsed"
          @collapse="onFileExplorerCollapse"
        />
      </ResizablePanel>

      <!-- Runtime Panel -->
      <ResizablePanel
        v-model:width="runtimePanelWidth"
        v-model:collapsed="isRuntimePanelCollapsed"
        direction="left"
        :min-width="100"
        :settings-width-key="WorkbenchSettingKey.RUNTIME_PANEL_WIDTH"
        :settings-collapsed-key="WorkbenchSettingKey.IS_RUNTIME_PANEL_COLLAPSED"
        :fill-available="runtimePanel.shouldFillSpace.value"
      >
        <RuntimePanel
          :initial-collapsed="isRuntimePanelCollapsed"
          @collapse="onRuntimePanelCollapse"
        />
      </ResizablePanel>
    </div>
  </div>
</template>

<style scoped>
.project-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  overflow: hidden;
}

.panels-container {
  display: flex;
  flex-direction: row;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

/* Ensure the Runtime panel takes up all available space by default */
.panels-container > :last-child {
  flex: 1 1 auto !important;
}
</style>
