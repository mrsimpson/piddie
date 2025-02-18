<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import type { Project } from "../types/project";
import ProjectListItem from "./ProjectListItem.vue";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";

const searchQuery = ref("");
const projectStore = useProjectStore();
const { projects, currentProject } = storeToRefs(projectStore);

const filteredProjects = computed(() => {
  const query = searchQuery.value.toLowerCase();
  return projects.value.filter((project: Project) =>
    project.name.toLowerCase().includes(query)
  );
});

const createNewProject = async () => {
  await projectStore.createProject("New Project");
};

const handleProjectSelect = async (projectId: string) => {
  await projectStore.setCurrentProject(projectId);
};

const handleProjectRename = async (projectId: string, newName: string) => {
  await projectStore.renameProject(projectId, newName);
};

onMounted(() => {
  projectStore.loadProjects();
});
</script>

<template>
  <div class="projects-container">
    <div class="header">
      <sl-button variant="primary" size="small" @click="createNewProject">
        <sl-icon slot="prefix" name="plus-circle"></sl-icon>
        Start New Chat
      </sl-button>
      <sl-input
        v-model="searchQuery"
        placeholder="Search"
        size="small"
        clearable
      >
        <sl-icon slot="prefix" name="search"></sl-icon>
      </sl-input>
    </div>
    <div class="projects-list">
      <ProjectListItem
        v-for="project in filteredProjects"
        :key="project.id"
        :project="project"
        :is-active="currentProject?.id === project.id"
        @select="handleProjectSelect"
        @name-change="handleProjectRename"
      />
    </div>
  </div>
</template>

<style scoped>
.projects-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1rem;
  gap: 1rem;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.projects-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
