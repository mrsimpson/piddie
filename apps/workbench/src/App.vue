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
    <div class="app-layout">
      <router-view name="sidepanelLeft" class="side-panel" />
      <div class="main-content">
        <router-view />
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  background: var(--sl-color-neutral-0);
  color: var(--sl-color-neutral-900);
  min-height: 100vh;
}

.app-layout {
  display: flex;
  min-height: 100vh;
}

.main-content {
  flex: 1;
  height: 100vh;
  overflow-y: auto;
}

.theme-toggle {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 100;
}
</style>
