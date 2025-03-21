<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useProjectStore } from "./stores/project";
import { ThemeToggle } from "@piddie/common-ui-vue";

const projectStore = useProjectStore();
const { isChatVisible } = storeToRefs(projectStore);
const isProjectsListCollapsed = ref(false);

function handleSidePanelCollapse(collapsed: boolean) {
  isProjectsListCollapsed.value = collapsed;
}
</script>

<template>
  <div
    class="app-container"
    :class="{
      'chat-hidden': !isChatVisible,
      'projects-list-collapsed': isProjectsListCollapsed
    }"
  >
    <div class="theme-toggle">
      <ThemeToggle />
    </div>
    <div class="app-layout">
      <router-view
        name="sidepanelLeft"
        class="side-panel"
        @collapse="handleSidePanelCollapse"
      />
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

.side-panel {
  transition: width 0.3s ease;
  width: 300px;
}

.projects-list-collapsed .side-panel {
  width: 40px;
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
