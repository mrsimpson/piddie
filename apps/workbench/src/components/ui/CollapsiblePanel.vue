<template>
  <div class="panel-container" :class="{ collapsed: isCollapsed }">
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
        :name="isCollapsed ? expandIcon : collapseIcon"
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

interface Props {
  /** Initial collapsed state of the panel */
  initialCollapsed?: boolean;
  /** Display toggle button */
  displayToggle?: boolean;
  /** Icon to show when panel is collapsed (for expanding) */
  expandIcon?: string;
  /** Icon to show when panel is expanded (for collapsing) */
  collapseIcon?: string;
}

const props = withDefaults(defineProps<Props>(), {
  initialCollapsed: false,
  displayToggle: true,
  expandIcon: "chevron-right",
  collapseIcon: "chevron-left"
});

const emit = defineEmits<{
  /** Emitted when panel collapse state changes */
  collapse: [isCollapsed: boolean];
}>();

const isCollapsed = ref(props.initialCollapsed);

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
}

.panel-container.collapsed {
  width: 40px;
  border-right: 1px solid var(--sl-color-neutral-200);
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  width: 100%;
  box-sizing: border-box;
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
  font-size: 1.2rem;
}
</style>
