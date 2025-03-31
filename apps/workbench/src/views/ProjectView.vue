<script setup lang="ts">
import { ref, computed, shallowRef, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { useFileSystemStore } from "@piddie/files-management-ui-vue";
import { FilesPanel } from "@piddie/files-management-ui-vue";
import ChatPanel from "@/components/ChatPanel.vue";
import RuntimePanel from "@/components/RuntimePanel.vue";
import { ResizablePanel } from "@piddie/common-ui-vue";
import { WorkbenchSettingKey } from "@piddie/settings";
import { useResourceService } from "@/composables/useResourceService";
import type { RuntimeEnvironmentManager } from "@piddie/runtime-environment";
import "@piddie/files-management-ui-vue/style";
import "@piddie/project-management-ui-vue/style";

const route = useRoute();
const projectStore = useProjectStore();
const fileSystemStore = useFileSystemStore();
const resourceService = useResourceService();
const error = ref<Error | null>(null);

const projectId = computed(() => route.params.id as string);
const isFileExplorerCollapsed = ref(false);
const isChatPanelCollapsed = ref(false);
const isRuntimePanelCollapsed = ref(false);

// Create reactive references for runtime resources
const runtimeManager = shallowRef<RuntimeEnvironmentManager | undefined>(
  undefined
);
const syncManagerRef = shallowRef(fileSystemStore.syncManager);

// Panel widths
const fileExplorerWidth = ref(250);
const chatPanelWidth = ref(300);
const runtimePanelWidth = ref(500);

// Initialize project resources
onMounted(async () => {
  if (projectId.value) {
    try {
      await projectStore.setCurrentProject(projectId.value);
      await resourceService.activateProject(projectId.value);
      // Update runtime manager reference
      runtimeManager.value =
        resourceService.getRuntimeEnvironmentManager() ?? undefined;
      // Update sync manager reference
      syncManagerRef.value = resourceService.getFileSyncManager() ?? undefined;
    } catch (err) {
      console.error("Failed to initialize project resources:", err);
      error.value =
        err instanceof Error
          ? err
          : new Error("Failed to initialize project resources");
    }
  }
});

// Cleanup resources when component is unmounted
onUnmounted(async () => {
  await resourceService.deactivateCurrentProject();
  runtimeManager.value = undefined;
  syncManagerRef.value = undefined;
});

// Determine which panel should fill available space
const filesPanel = {
  shouldFillSpace: computed(
    () => isRuntimePanelCollapsed.value && !isFileExplorerCollapsed.value
  )
};

const runtimePanel = {
  shouldFillSpace: computed(() => !isRuntimePanelCollapsed.value)
};

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
        :fill-available="isFileExplorerCollapsed && isRuntimePanelCollapsed"
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
          :runtime-manager="runtimeManager"
          :sync-manager="syncManagerRef"
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
          :runtime-manager="runtimeManager"
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
