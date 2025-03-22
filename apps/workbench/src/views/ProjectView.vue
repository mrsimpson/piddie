<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, provide, computed } from "vue";
import { useRoute } from "vue-router";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { useFileSystemStore } from "@piddie/files-management-ui-vue";
import { storeToRefs } from "pinia";
import { FileExplorerPanel } from "@piddie/files-management-ui-vue";
import ChatPanel from "@/components/ChatPanel.vue";
import CodeEditor from "@/components/CodeEditor.vue";
import { settingsManager } from "@piddie/settings";
import "@piddie/files-management-ui-vue/style";

const route = useRoute();
const projectStore = useProjectStore();
const fileSystemStore = useFileSystemStore();
const error = ref<Error | null>(null);

const projectId = ref<string | null>(null);
const isFileExplorerCollapsed = ref(false);
const isChatPanelCollapsed = ref(false);

// Panel sizing
const fileExplorerWidth = ref(250);
const chatPanelWidth = ref(300);
const isResizingChat = ref(false);
const isResizingLeftPanel = ref(false);
const startX = ref(0);
const startWidth = ref(0);

// Computed total width of the left panel
const leftPanelWidth = computed(() => {
  if (isFileExplorerCollapsed.value && isChatPanelCollapsed.value) {
    return 80; // Both collapsed: 40px + 40px
  }

  const explorerWidth = isFileExplorerCollapsed.value
    ? 40
    : fileExplorerWidth.value;
  const chatWidth = isChatPanelCollapsed.value ? 40 : chatPanelWidth.value;

  return explorerWidth + chatWidth;
});

// Load panel widths from settings
async function loadPanelWidths() {
  try {
    console.group("ProjectView: Load Panel Widths");
    const settings = await settingsManager.getWorkbenchSettings();
    console.log("Loaded settings:", settings);

    fileExplorerWidth.value = settings.fileExplorerWidth as number;
    chatPanelWidth.value = settings.chatPanelWidth as number;
    isFileExplorerCollapsed.value = settings.isFileExplorerCollapsed as boolean;
    isChatPanelCollapsed.value = settings.isChatPanelCollapsed as boolean;

    console.log("Applied panel widths:", {
      fileExplorerWidth: fileExplorerWidth.value,
      chatPanelWidth: chatPanelWidth.value,
      isFileExplorerCollapsed: isFileExplorerCollapsed.value,
      isChatPanelCollapsed: isChatPanelCollapsed.value
    });
    console.groupEnd();
  } catch (err) {
    console.error("Failed to load panel widths:", err);
    console.groupEnd();
  }
}

// Save panel widths to settings
async function savePanelWidths() {
  try {
    console.group("ProjectView: Save Panel Widths");
    console.log("Saving panel widths:", {
      fileExplorerWidth: fileExplorerWidth.value,
      chatPanelWidth: chatPanelWidth.value,
      isFileExplorerCollapsed: isFileExplorerCollapsed.value,
      isChatPanelCollapsed: isChatPanelCollapsed.value
    });

    await settingsManager.updateWorkbenchSettings({
      fileExplorerWidth: fileExplorerWidth.value,
      chatPanelWidth: chatPanelWidth.value,
      isFileExplorerCollapsed: isFileExplorerCollapsed.value,
      isChatPanelCollapsed: isChatPanelCollapsed.value
    });

    console.log("Panel widths saved successfully");
    console.groupEnd();
  } catch (err) {
    console.error("Failed to save panel widths:", err);
    console.groupEnd();
  }
}

// Debounce function to avoid too many saves
let saveTimeout: number | null = null;
function debouncedSavePanelWidths() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = window.setTimeout(() => {
    savePanelWidths();
    saveTimeout = null;
  }, 500);
}

async function initializeFromRoute() {
  projectId.value = route.params.id as string;
  if (projectId.value) {
    try {
      error.value = null;
      await projectStore.setCurrentProject(projectId.value);

      // Provide sync manager to child components
      provide("syncManager", fileSystemStore.syncManager);
    } catch (err) {
      console.error("Failed to initialize project:", err);
      error.value = err as Error;
    }
  }
}

// Initialize when the component is mounted
onMounted(async () => {
  await loadPanelWidths();
  await initializeFromRoute();

  // Add event listeners for resizing
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
});

onBeforeUnmount(async () => {
  // Clean up resources when the component is unmounted
  // This will be called when navigating away from the project view entirely,
  // but not when switching between projects (which is handled by the file system store)

  // Save panel widths before unmounting
  await savePanelWidths();

  // Remove event listeners
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp);

  // Clear any pending save
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
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

// Watch for panel width changes and save them
watch(
  [
    fileExplorerWidth,
    chatPanelWidth,
    isFileExplorerCollapsed,
    isChatPanelCollapsed
  ],
  () => {
    debouncedSavePanelWidths();
  }
);

// Handle panel collapse events
function onFileExplorerCollapse(collapsed: boolean) {
  isFileExplorerCollapsed.value = collapsed;
  if (collapsed) {
    // Store the width before collapsing
    fileExplorerWidth.value = fileExplorerWidth.value || 250;
  }
  debouncedSavePanelWidths();
}

function onChatPanelCollapse(collapsed: boolean) {
  isChatPanelCollapsed.value = collapsed;
  if (collapsed) {
    // Store the width before collapsing
    chatPanelWidth.value = chatPanelWidth.value || 300;
  }
  debouncedSavePanelWidths();
}

// Resizing functions
function startResizingChat(e: MouseEvent) {
  if (isChatPanelCollapsed.value) return;

  isResizingChat.value = true;
  startX.value = e.clientX;
  startWidth.value = chatPanelWidth.value;
  e.preventDefault();
}

function startResizingLeftPanel(e: MouseEvent) {
  if (isFileExplorerCollapsed.value && isChatPanelCollapsed.value) return;

  isResizingLeftPanel.value = true;
  startX.value = e.clientX;
  startWidth.value = fileExplorerWidth.value + chatPanelWidth.value;
  e.preventDefault();
}

function handleMouseMove(e: MouseEvent) {
  if (isResizingChat.value) {
    const delta = e.clientX - startX.value;
    const newWidth = Math.max(100, startWidth.value + delta);
    chatPanelWidth.value = newWidth;
  } else if (isResizingLeftPanel.value) {
    const delta = e.clientX - startX.value;
    const newTotalWidth = Math.max(200, startWidth.value + delta);

    // If file explorer is collapsed, adjust only chat panel
    if (isFileExplorerCollapsed.value) {
      chatPanelWidth.value = newTotalWidth - 40; // 40px for collapsed file explorer
    }
    // If chat panel is collapsed, adjust only file explorer
    else if (isChatPanelCollapsed.value) {
      fileExplorerWidth.value = newTotalWidth - 40; // 40px for collapsed chat panel
    }
    // If neither is collapsed, maintain proportions
    else {
      const ratio =
        fileExplorerWidth.value /
        (fileExplorerWidth.value + chatPanelWidth.value);
      fileExplorerWidth.value = Math.max(
        100,
        Math.floor(newTotalWidth * ratio)
      );
      chatPanelWidth.value = Math.max(
        100,
        newTotalWidth - fileExplorerWidth.value
      );
    }
  }
}

function handleMouseUp() {
  if (isResizingChat.value || isResizingLeftPanel.value) {
    debouncedSavePanelWidths();
  }
  isResizingChat.value = false;
  isResizingLeftPanel.value = false;
}
</script>

<template>
  <div
    class="project-view"
    :style="{ gridTemplateColumns: `${leftPanelWidth}px 1fr` }"
  >
    <div class="left-panel">
      <div
        class="chat-container"
        :class="{ collapsed: isChatPanelCollapsed }"
        :style="{
          width: isChatPanelCollapsed ? '40px' : `${chatPanelWidth}px`
        }"
      >
        <ChatPanel
          :initial-collapsed="isChatPanelCollapsed"
          @collapse="onChatPanelCollapse"
        />
      </div>

      <!-- Resizer between file explorer and chat panel -->
      <div
        class="resizer file-explorer-resizer"
        :class="{ hidden: isFileExplorerCollapsed }"
        @mousedown="startResizingChat"
      ></div>

      <div
        class="file-explorer-container"
        :class="{ collapsed: isFileExplorerCollapsed }"
        :style="{
          width: isFileExplorerCollapsed ? '40px' : `${fileExplorerWidth}px`
        }"
      >
        <FileExplorerPanel
          :systems="fileSystemStore.systems"
          :error="error"
          :initial-collapsed="isFileExplorerCollapsed"
          @collapse="onFileExplorerCollapse"
        />
      </div>

      <!-- Resizer between left panel and main panel -->
      <div
        class="resizer left-panel-resizer"
        @mousedown="startResizingLeftPanel"
      ></div>
    </div>
    <div class="main-panel">
      <CodeEditor />
    </div>
  </div>
</template>

<style scoped>
.project-view {
  display: grid;
  grid-template-rows: 100vh;
  grid-template-areas: "left main";
  overflow: hidden;
  transition: grid-template-columns 0.3s ease;
}

.left-panel {
  grid-area: left;
  border-right: 1px solid var(--sl-color-neutral-200);
  display: flex;
  flex-direction: row;
  height: 100%;
  overflow: hidden;
  position: relative;
  width: 100%;
}

.file-explorer-container {
  flex: 0 0 auto;
  overflow-y: auto;
  min-width: 0;
  transition: width 0.3s ease;
}

.file-explorer-container.collapsed {
  flex: 0 0 40px;
  width: 40px !important;
  min-width: 40px;
}

.chat-container {
  flex: 0 0 auto;
  overflow-y: auto;
  min-width: 0;
  transition: width 0.3s ease;
}

.chat-container.collapsed {
  flex: 0 0 40px;
  width: 40px !important;
  min-width: 40px;
}

.main-panel {
  grid-area: main;
  overflow: hidden;
  width: 100%;
}

/* When a panel is collapsed, ensure it takes minimal space */
:deep(.panel-container.collapsed) {
  width: 40px !important;
  min-width: 40px !important;
  max-width: 40px !important;
}

/* Resizer styles */
.resizer {
  width: 5px;
  height: 100%;
  background-color: transparent;
  cursor: col-resize;
  transition: background-color 0.2s;
  z-index: 10;
}

.resizer:hover,
.resizer:active {
  background-color: var(--sl-color-primary-200);
}

.resizer.hidden {
  display: none;
}

.file-explorer-resizer {
  border-right: 1px solid var(--sl-color-neutral-200);
}

.left-panel-resizer {
  position: absolute;
  right: 0;
  top: 0;
}
</style>
