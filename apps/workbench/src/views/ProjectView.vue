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
import { settingsManager } from "@piddie/settings";
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

// Panel sizing
const fileExplorerWidth = ref(250);
const chatPanelWidth = ref(300);
const runtimePanelWidth = ref(500);
const isResizingChat = ref(false);
const isResizingFiles = ref(false);
const isResizingRuntime = ref(false);
const startX = ref(0);
const startWidth = ref(0);

// Load runtime panel settings from localStorage
function loadRuntimePanelSettings() {
  try {
    const widthStr = localStorage.getItem("runtimePanelWidth");
    const collapsedStr = localStorage.getItem("isRuntimePanelCollapsed");

    if (widthStr) {
      runtimePanelWidth.value = parseInt(widthStr, 10);
    }

    if (collapsedStr) {
      isRuntimePanelCollapsed.value = collapsedStr === "true";
    }
  } catch (err) {
    console.error(
      "Failed to load runtime panel settings from localStorage:",
      err
    );
  }
}

// Save runtime panel settings to localStorage
function saveRuntimePanelSettings() {
  try {
    localStorage.setItem(
      "runtimePanelWidth",
      runtimePanelWidth.value.toString()
    );
    localStorage.setItem(
      "isRuntimePanelCollapsed",
      isRuntimePanelCollapsed.value.toString()
    );
  } catch (err) {
    console.error(
      "Failed to save runtime panel settings to localStorage:",
      err
    );
  }
}

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

    // Load runtime panel settings from localStorage
    loadRuntimePanelSettings();

    console.log("Applied panel widths:", {
      fileExplorerWidth: fileExplorerWidth.value,
      chatPanelWidth: chatPanelWidth.value,
      runtimePanelWidth: runtimePanelWidth.value,
      isFileExplorerCollapsed: isFileExplorerCollapsed.value,
      isChatPanelCollapsed: isChatPanelCollapsed.value,
      isRuntimePanelCollapsed: isRuntimePanelCollapsed.value
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
      runtimePanelWidth: runtimePanelWidth.value,
      isFileExplorerCollapsed: isFileExplorerCollapsed.value,
      isChatPanelCollapsed: isChatPanelCollapsed.value,
      isRuntimePanelCollapsed: isRuntimePanelCollapsed.value
    });

    await settingsManager.updateWorkbenchSettings({
      fileExplorerWidth: fileExplorerWidth.value,
      chatPanelWidth: chatPanelWidth.value,
      isFileExplorerCollapsed: isFileExplorerCollapsed.value,
      isChatPanelCollapsed: isChatPanelCollapsed.value
    });

    // Save runtime panel settings to localStorage
    saveRuntimePanelSettings();

    console.log("Panel widths saved successfully");
    console.groupEnd();
  } catch (err) {
    console.error("Failed to save panel widths:", err);
    console.groupEnd();
  }
}

// Initialize WebContainer for the current project
async function initializeWebContainer() {
  containerInitializing.value = true;
  containerError.value = null;

  try {
    console.log("Initializing WebContainer for project:", projectId.value);

    // Reset WebContainer service if it has a container
    if (webContainerService.hasContainer()) {
      console.log("Resetting existing WebContainer");
      await webContainerService.reset();
    }

    // Always create a new WebContainer using the service
    console.log("Creating new WebContainer");
    const container = await webContainerService.createContainer();
    webContainerInstance.value = container;

    // Initialize the file system with the container
    containerFileSystem.value = new WebContainerFileSystem(container);

    // Initialize the file system store with our WebContainer
    console.log("Initializing file system store with WebContainer");
    await fileSystemStore.initializeForProject(
      {
        id: projectId.value as string
      },
      container
    );

    // Initialize the RuntimeEnvironmentManager with the same container
    console.log("Initializing RuntimeEnvironmentManager");
    runtimeManager.value =
      RuntimeEnvironmentManager.withWebContainer(container);

    // Make sure to initialize the runtime manager
    if (runtimeManager.value) {
      console.log("Initializing RuntimeEnvironmentManager...");
      await runtimeManager.value.initialize();
      console.log("RuntimeEnvironmentManager initialized successfully!");
    }

    console.log(
      "WebContainer initialized successfully for project:",
      projectId.value
    );
    containerInitializing.value = false;
  } catch (err) {
    console.error("Failed to initialize WebContainer:", err);
    containerError.value = err as Error;
    containerInitializing.value = false;
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
    runtimePanelWidth,
    isFileExplorerCollapsed,
    isChatPanelCollapsed,
    isRuntimePanelCollapsed
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

function onRuntimePanelCollapse(collapsed: boolean) {
  isRuntimePanelCollapsed.value = collapsed;
  if (collapsed) {
    // Store the width before collapsing
    runtimePanelWidth.value = runtimePanelWidth.value || 500;
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

function startResizingFiles(e: MouseEvent) {
  if (isFileExplorerCollapsed.value) return;

  isResizingFiles.value = true;
  startX.value = e.clientX;
  startWidth.value = fileExplorerWidth.value;
  e.preventDefault();
}

function startResizingRuntime(e: MouseEvent) {
  if (isRuntimePanelCollapsed.value) return;

  isResizingRuntime.value = true;
  startX.value = e.clientX;
  startWidth.value = runtimePanelWidth.value;
  e.preventDefault();
}

function handleMouseMove(e: MouseEvent) {
  if (isResizingChat.value) {
    const delta = e.clientX - startX.value;
    chatPanelWidth.value = Math.max(100, startWidth.value + delta);
  } else if (isResizingFiles.value) {
    const delta = e.clientX - startX.value;
    fileExplorerWidth.value = Math.max(100, startWidth.value + delta);
  } else if (isResizingRuntime.value) {
    const delta = e.clientX - startX.value;
    runtimePanelWidth.value = Math.max(100, startWidth.value + delta);
  }
}

function handleMouseUp() {
  if (
    isResizingChat.value ||
    isResizingFiles.value ||
    isResizingRuntime.value
  ) {
    debouncedSavePanelWidths();
  }
  isResizingChat.value = false;
  isResizingFiles.value = false;
  isResizingRuntime.value = false;
}
</script>

<template>
  <div class="project-view">
    <div class="panels-container">
      <!-- Chat Panel -->
      <div
        class="panel-wrapper chat-panel-wrapper"
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

      <!-- Resizer between chat and files panel -->
      <div
        class="resizer chat-files-resizer"
        :class="{ hidden: isChatPanelCollapsed }"
        @mousedown="startResizingChat"
      ></div>

      <!-- Files Panel -->
      <div
        class="panel-wrapper files-panel-wrapper"
        :class="{
          collapsed: isFileExplorerCollapsed,
          'runtime-collapsed': isRuntimePanelCollapsed
        }"
        :style="{
          width: isFileExplorerCollapsed
            ? '40px'
            : isRuntimePanelCollapsed
              ? 'auto'
              : `${fileExplorerWidth}px`,
          flex: isFileExplorerCollapsed
            ? '0 0 40px'
            : isRuntimePanelCollapsed
              ? '1 1 auto'
              : '0 0 auto'
        }"
      >
        <FilesPanel
          :systems="fileSystemStore.systems"
          :error="error"
          :initial-collapsed="isFileExplorerCollapsed"
          @collapse="onFileExplorerCollapse"
        />
      </div>

      <!-- Resizer between files and runtime panel -->
      <div
        class="resizer files-runtime-resizer"
        :class="{ hidden: isFileExplorerCollapsed }"
        @mousedown="startResizingFiles"
      ></div>

      <!-- Runtime Panel -->
      <div
        class="panel-wrapper runtime-panel-wrapper"
        :class="{ collapsed: isRuntimePanelCollapsed }"
        :style="{
          width: isRuntimePanelCollapsed ? '40px' : `${runtimePanelWidth}px`,
          flex: isRuntimePanelCollapsed ? '0 0 40px' : '1 1 auto'
        }"
      >
        <RuntimePanel
          :initial-collapsed="isRuntimePanelCollapsed"
          @collapse="onRuntimePanelCollapse"
        />
      </div>
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
}

.panel-wrapper {
  height: 100%;
  overflow: hidden;
}

.panel-wrapper.collapsed {
  flex: 0 0 40px !important;
  width: 40px !important;
  min-width: 40px !important;
}

.chat-panel-wrapper {
  flex: 0 0 auto;
}

.files-panel-wrapper {
  flex: 0 0 auto;
}

.files-panel-wrapper.runtime-collapsed:not(.collapsed) {
  flex: 1 1 auto !important;
}

.runtime-panel-wrapper {
  flex: 1 1 auto;
  min-width: 0;
}

/* Resizer styles */
.resizer {
  width: 1px;
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
</style>
