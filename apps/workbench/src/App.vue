<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { ThemeToggle } from "@piddie/common-ui-vue";
import "@piddie/common-ui-vue/style";

const projectStore = useProjectStore();
const isProjectsListCollapsed = ref(false);

function handleSidePanelCollapse(collapsed: boolean) {
  isProjectsListCollapsed.value = collapsed;
}
</script>

<template>
  <div
    class="app-container"
    :class="{
      'projects-list-collapsed': isProjectsListCollapsed
    }"
  >
    <div class="app-layout">
      <router-view
        name="sidepanelLeft"
        class="side-panel"
        @collapse="handleSidePanelCollapse"
      />
      <div class="main-content">
        <router-view />
      </div>
      <div class="side-panel-right">
        <ThemeToggle />
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  background: var(--sl-color-neutral-0);
  color: var(--sl-color-neutral-900);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-layout {
  display: flex;
  flex: 1;
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
  height: 100%;
  overflow-y: auto;
}

.side-panel-right {
  width: 50px;
  display: flex;
  justify-content: center;
  padding-top: 1rem;
  background-color: var(--sl-color-neutral-0);
  border-left: 1px solid var(--sl-color-neutral-200);
}
</style>
