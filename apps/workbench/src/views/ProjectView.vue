<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, provide, ref } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "@/stores/project";
import { useFileSystemStore } from "@/stores/file-system";
import ChatPanel from "@/components/ChatPanel.vue";
import FileExplorerPanel from "@/components/FileExplorerPanel.vue";
import CodeEditor from "@/components/CodeEditor.vue";

const route = useRoute();
const projectStore = useProjectStore();
const fileSystemStore = useFileSystemStore();
const { currentProject } = storeToRefs(projectStore);
const error = ref<Error | null>(null);

async function initializeFromRoute() {
  const projectId = route.params.id as string;
  if (projectId) {
    try {
      error.value = null;
      await projectStore.setCurrentProject(projectId);

      // Provide sync manager to child components
      provide("syncManager", fileSystemStore.syncManager);
    } catch (err) {
      console.error("Failed to initialize project:", err);
      error.value = err as Error;
    }
  }
}

onMounted(async () => {
  await initializeFromRoute();
});

onBeforeUnmount(async () => {
  await fileSystemStore.cleanup();
});

// Reload project when route changes
watch(
  () => route.params.id,
  async (newId, oldId) => {
    if (newId && newId !== oldId) {
      await initializeFromRoute();
    }
  }
);
</script>

<template>
  <div class="project-details" v-if="currentProject">
    <ChatPanel :style="{ minWidth: '300px', maxWidth: '400px' }" />
    <FileExplorerPanel
      :style="{ minWidth: '300px', maxWidth: '400px' }"
      :systems="fileSystemStore.systems"
      :error="error"
    />
    <CodeEditor :style="{ minWidth: '40%' }" />
  </div>
</template>

<style scoped>
.project-details {
  display: flex;
  height: 100%;
  gap: 1rem;
}
</style>
