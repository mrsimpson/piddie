<template>
  <div
    class="panel-container"
    :class="{
      collapsed: isCollapsed,
      'direction-left': direction === 'left',
      'direction-right': direction === 'right'
    }"
  >
    <template v-if="!isCollapsed">
      <header v-if="$slots.header">
        <slot name="header"></slot>
      </header>
      <div class="panel-content">
        <slot name="content"></slot>
      </div>
      <footer v-if="$slots.footer">
        <slot name="footer"></slot>
      </footer>
    </template>
    <div class="toggle-container" v-if="props.displayToggle">
      <sl-icon-button
        class="toggle-button"
        :name="toggleIcon"
        :label="isCollapsed ? 'Expand' : 'Collapse'"
        @click="toggleCollapse"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import type SlIconButton from "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";

type Direction = "left" | "right";

interface Props {
  /** Initial collapsed state of the panel */
  initialCollapsed?: boolean;
  /** Display toggle button */
  displayToggle?: boolean;
  /** Icon to show when panel is collapsed (for expanding) */
  expandIcon?: string;
  /** Icon to show when panel is expanded (for collapsing) */
  collapseIcon?: string;
  /** Direction of the panel (affects icons and animations) */
  direction?: Direction;
}

const props = withDefaults(defineProps<Props>(), {
  initialCollapsed: false,
  displayToggle: true,
  expandIcon: "chevron-right",
  collapseIcon: "chevron-left",
  direction: "left"
});

const emit = defineEmits<{
  /** Emitted when panel collapse state changes */
  collapse: [isCollapsed: boolean];
}>();

const isCollapsed = ref(props.initialCollapsed);

// Compute the correct icon based on collapse state and direction
const toggleIcon = computed(() => {
  if (isCollapsed.value) {
    // When collapsed, always show the expand icon based on direction
    return props.direction === "right" ? "chevron-left" : "chevron-right";
  } else {
    // When expanded, show the collapse icon based on direction
    return props.direction === "right" ? "chevron-right" : "chevron-left";
  }
});

// Watch for changes to initialCollapsed prop
watch(
  () => props.initialCollapsed,
  (newValue) => {
    if (isCollapsed.value !== newValue) {
      isCollapsed.value = newValue;
    }
  }
);

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
  emit("collapse", isCollapsed.value);
}
</script>

<style scoped>
.panel-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  transition: width 0.3s ease;
  width: 100%;
  overflow: hidden;
  box-sizing: border-box;
  border-right: 1px solid var(--sl-color-neutral-200);
}

.panel-container.direction-right {
  border-right: none;
  border-left: 1px solid var(--sl-color-neutral-200);
}

.panel-container.collapsed {
  width: 40px;
}

/* Content animation based on direction */
.panel-content {
  flex: 1;
  overflow-y: auto;
  width: 100%;
  box-sizing: border-box;
  animation-duration: 0.3s;
  animation-fill-mode: forwards;
  animation-timing-function: ease;
}

.direction-left.collapsed .panel-content {
  animation-name: slide-in-left;
}

.direction-right.collapsed .panel-content {
  animation-name: slide-in-right;
}

@keyframes slide-in-left {
  from {
    transform: translateX(-10px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slide-in-right {
  from {
    transform: translateX(10px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

header,
footer {
  width: 100%;
  box-sizing: border-box;
}

.toggle-container {
  margin-top: auto;
  display: flex;
  justify-content: center;
  padding: 0.5rem;
  width: 100%;
  box-sizing: border-box;
}

.toggle-button {
  font-size: 1rem;
}
</style>
