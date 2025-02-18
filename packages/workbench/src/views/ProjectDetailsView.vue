<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import ProjectsList from "../components/ProjectsList.vue";
import ChatPanel from "../components/ChatPanel.vue";
import FileExplorer from "../components/FileExplorer.vue";
import CodeEditor from "../components/CodeEditor.vue";

const route = useRoute();
const router = useRouter();
const projectStore = useProjectStore();
const { currentProject } = storeToRefs(projectStore);

async function loadProject() {
  try {
    await projectStore.setCurrentProject(route.params.id as string);
  } catch (error) {
    // If project not found, redirect to projects list
    router.replace("/projects");
  }
}

onMounted(() => {
  loadProject();
});

// Reload project when route changes
watch(
  () => route.params.id,
  () => {
    loadProject();
  }
);
</script>

<template>
  <div class="project-details">
    <ProjectsList />
    <ChatPanel v-if="currentProject" />
    <FileExplorer />
    <CodeEditor />
  </div>
</template>

<style scoped>
.project-details {
  display: grid;
  grid-template-columns: 250px 300px 250px 1fr;
  grid-template-areas: "projects chat files editor";
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
</style>
