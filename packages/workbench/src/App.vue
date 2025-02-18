<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useProjectStore } from "./stores/project";
import ThemeToggle from "./components/ui/ThemeToggle.vue";

const projectStore = useProjectStore();
const { isChatVisible } = storeToRefs(projectStore);
</script>

<template>
  <div class="app-container" :class="{ 'chat-hidden': !isChatVisible }">
    <div class="theme-toggle">
      <ThemeToggle />
    </div>
    <router-view name="sidepanelLeft" />
    <div class="main-content">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.app-container {
  background: var(--sl-color-neutral-0);
  color: var(--sl-color-neutral-900);
  min-height: 100vh;
  padding-left: 250px; /* Space for expanded ProjectsList */
  transition: padding-left 0.3s ease;
}

.app-container.chat-hidden {
  grid-template-columns: 250px 0 250px 1fr;
}

.app-container.chat-hidden.collapsed {
  padding-left: 48px; /* Space for collapsed ProjectsList */
}

.theme-toggle {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 100;
}

.main-content {
  height: 100vh;
  overflow-y: auto;
}
</style>
