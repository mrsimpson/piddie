<script setup lang="ts">
import { ref, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { ThemeToggle } from "@piddie/common-ui-vue";
import "@piddie/common-ui-vue/style";

const isProjectsListCollapsed = ref(false);
const isChatVisible = ref(false);

onMounted(() => {
  const projectStore = useProjectStore();
  console.log("Project store:", projectStore);

  try {
    // @ts-expect-error - Known type mismatch with Pinia stores exported from the ui-lib-package
    const { isChatVisible: visibleFromStore } = storeToRefs(projectStore);
    console.log("isChatVisible:", visibleFromStore);
    isChatVisible.value = visibleFromStore.value;
  } catch (error) {
    console.error("Error accessing store:", error);
  }
});

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
