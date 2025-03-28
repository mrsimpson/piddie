<template>
  <div
    class="resizable-panel-wrapper"
    :class="{ 'is-resizing': isResizing }"
    :style="wrapperStyle"
  >
    <div
      v-if="!isCollapsed && resizable"
      class="resize-handle"
      :class="[direction]"
      @mousedown="startResize"
    ></div>

    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { settingsManager, WorkbenchSettingKey } from "@piddie/settings";

type Direction = "left" | "right";

interface Props {
  /** Whether the panel is collapsed */
  collapsed?: boolean;
  /** Direction of the resize handle */
  direction?: Direction;
  /** Whether the panel is resizable */
  resizable?: boolean;
  /** Width of the panel */
  width?: number;
  /** Minimum width of the panel */
  minWidth?: number;
  /** Settings key for persisting width (from WorkbenchSettingKey) */
  settingsWidthKey?: WorkbenchSettingKey;
  /** Settings key for persisting collapsed state (from WorkbenchSettingKey) */
  settingsCollapsedKey?: WorkbenchSettingKey;
  /** Whether the panel should fill available space */
  fillAvailable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  collapsed: false,
  direction: "left",
  resizable: true,
  width: 250,
  minWidth: 100,
  settingsWidthKey: undefined,
  settingsCollapsedKey: undefined,
  fillAvailable: false
});

const emit = defineEmits<{
  /** Emitted when panel collapse state changes */
  "update:collapsed": [collapsed: boolean];
  /** Emitted when panel width changes */
  "update:width": [width: number];
  /** Resize start event */
  "resize-start": [];
  /** Resize end event */
  "resize-end": [];
}>();

const panelWidth = ref(props.width);
const isCollapsed = ref(props.collapsed);
const isResizing = ref(false);
const startX = ref(0);
const startWidth = ref(0);

// Computed styles for wrapper
const wrapperStyle = computed(() => {
  const styles: Record<string, string> = {};

  if (isCollapsed.value) {
    styles.width = "40px";
    styles.flex = "0 0 40px";
    styles.minWidth = "40px";
    styles.maxWidth = "40px";
  } else if (props.fillAvailable) {
    styles.flex = "1 1 auto";
    styles.width = "auto";
    styles.minWidth = `${props.minWidth}px`;
  } else {
    styles.width = `${panelWidth.value}px`;
    styles.flex = "0 0 auto";
    styles.minWidth = `${props.minWidth}px`;
  }

  return styles;
});

// Watch for width prop changes
watch(
  () => props.width,
  (newWidth) => {
    if (!isResizing.value && panelWidth.value !== newWidth) {
      panelWidth.value = newWidth;
    }
  }
);

// Watch for collapsed prop changes
watch(
  () => props.collapsed,
  (newValue) => {
    if (isCollapsed.value !== newValue) {
      isCollapsed.value = newValue;
    }
  }
);

// Debounce function to avoid too many saves
let saveTimeout: number | null = null;
function debouncedSaveSettings() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = window.setTimeout(() => {
    saveSettings();
    saveTimeout = null;
  }, 500);
}

// Load settings on mount
onMounted(async () => {
  try {
    // Load values from settings if setting keys are provided
    if (props.settingsWidthKey || props.settingsCollapsedKey) {
      const settings = await settingsManager.getWorkbenchSettings();

      // Update width if available
      if (
        props.settingsWidthKey &&
        settings[props.settingsWidthKey] !== undefined
      ) {
        panelWidth.value = settings[props.settingsWidthKey] as number;
        emit("update:width", panelWidth.value);
      }

      // Update collapsed state if available
      if (
        props.settingsCollapsedKey &&
        settings[props.settingsCollapsedKey] !== undefined
      ) {
        isCollapsed.value = settings[props.settingsCollapsedKey] as boolean;
        emit("update:collapsed", isCollapsed.value);
      }
    }
  } catch (err) {
    console.error("Failed to load panel settings:", err);
  }

  // Add event listeners for resize
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp);

  // Save settings one last time
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
    saveSettings();
  }
});

async function saveSettings() {
  try {
    if (!props.settingsWidthKey && !props.settingsCollapsedKey) {
      return;
    }

    const updates: Partial<Record<WorkbenchSettingKey, unknown>> = {};

    if (props.settingsWidthKey) {
      updates[props.settingsWidthKey] = panelWidth.value;
    }

    if (props.settingsCollapsedKey) {
      updates[props.settingsCollapsedKey] = isCollapsed.value;
    }

    await settingsManager.updateWorkbenchSettings(updates);
  } catch (err) {
    console.error("Failed to save panel settings:", err);
  }
}

function startResize(e: MouseEvent) {
  if (isCollapsed.value) return;

  isResizing.value = true;
  startX.value = e.clientX;
  startWidth.value = panelWidth.value;
  emit("resize-start");
  e.preventDefault();
}

function handleMouseMove(e: MouseEvent) {
  if (!isResizing.value) return;

  let delta = e.clientX - startX.value;

  // Reverse delta direction if resize handle is on right side
  if (props.direction === "right") {
    delta = -delta;
  }

  const newWidth = Math.max(props.minWidth, startWidth.value + delta);
  panelWidth.value = newWidth;
  emit("update:width", newWidth);
}

function handleMouseUp() {
  if (isResizing.value) {
    isResizing.value = false;
    emit("resize-end");
    debouncedSaveSettings();
  }
}

// Listen for collapse events from an external component
function setCollapsed(collapsed: boolean) {
  isCollapsed.value = collapsed;
  emit("update:collapsed", isCollapsed.value);
  debouncedSaveSettings();
}

// Watch for changes and save
watch([panelWidth, isCollapsed], () => {
  debouncedSaveSettings();
});
</script>

<style scoped>
.resizable-panel-wrapper {
  position: relative;
  height: 100%;
  transition: width 0.3s ease;
}

.is-resizing {
  transition: none;
  user-select: none;
}

.resize-handle {
  position: absolute;
  width: 5px;
  height: 100%;
  top: 0;
  z-index: 10;
  cursor: col-resize;
  opacity: 0;
  transition: opacity 0.2s;
  background-color: transparent;
}

.resize-handle:hover,
.resize-handle.active {
  opacity: 1;
  background-color: var(--sl-color-primary-200);
}

.resize-handle.left {
  right: 0;
}

.resize-handle.right {
  left: 0;
}
</style>
