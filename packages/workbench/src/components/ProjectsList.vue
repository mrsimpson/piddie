<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import type { Project } from "../types/project";
import ProjectListItem from "./ProjectListItem.vue";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";

const router = useRouter();
const route = useRoute();
const searchQuery = ref("");
const projectStore = useProjectStore();
const { projects, currentProject } = storeToRefs(projectStore);
const isExpanded = ref(true);

const filteredProjects = computed(() => {
  const query = searchQuery.value.toLowerCase();
  return projects.value.filter((project: Project) =>
    project.name.toLowerCase().includes(query)
  );
});

async function createNewProject() {
  router.push("/projects/new");
}

const handleProjectSelect = async (projectId: string) => {
  await projectStore.setCurrentProject(projectId);
};

const handleProjectRename = async (projectId: string, newName: string) => {
  await projectStore.renameProject(projectId, newName);
};

function toggleExpanded() {
  isExpanded.value = !isExpanded.value;
  document
    .querySelector(".app-container")
    ?.classList.toggle("collapsed", !isExpanded.value);
}

onMounted(() => {
  projectStore.loadProjects();
  // Start collapsed if we're on the new project page
  isExpanded.value = route.path !== "/projects/new";
  document
    .querySelector(".app-container")
    ?.classList.toggle("collapsed", !isExpanded.value);
});
</script>

<template>
  <div class="projects-container">
    <div class="projects-list" :class="{ expanded: isExpanded }">
      <div class="projects-content" v-if="isExpanded">
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

        <div class="list">
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

      <sl-icon-button
        :name="isExpanded ? 'chevron-left' : 'folder2-open'"
        :label="isExpanded ? 'Collapse projects' : 'Show projects'"
        class="toggle-button"
        @click="toggleExpanded"
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

.projects-list {
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  background: var(--sl-color-neutral-0);
  border-right: 1px solid var(--sl-color-neutral-200);
  transition: width 0.3s ease;
  display: flex;
  z-index: 100;
}

.projects-list.expanded {
  width: 250px;
}

.projects-list:not(.expanded) {
  width: 48px; /* Just enough for the icon button */
}

.projects-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.header {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

.header h2 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--sl-color-neutral-900);
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.toggle-button {
  font-size: 1.2rem;
  position: absolute;
  bottom: 1rem;
  left: 0.5rem;
}
</style>
