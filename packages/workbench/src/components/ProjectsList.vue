<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import type { Project } from "../types/project";
import ProjectListItem from "./ProjectListItem.vue";
import ConfirmationDialog from "./ConfirmationDialog.vue";
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
const projectToDelete = ref<string | null>(null);

const filteredProjects = computed(() => {
  const query = searchQuery.value.toLowerCase();
  return projects.value.filter((project: Project) =>
    project.name.toLowerCase().includes(query)
  ).sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());
});

async function createNewProject() {
  router.push(`/projects/new`);
}

const handleProjectSelect = async (projectId: string) => {
  await projectStore.setCurrentProject(projectId);
};

const handleProjectRename = async (projectId: string, newName: string) => {
  await projectStore.renameProject(projectId, newName);
};

const handleProjectDelete = async (projectId: string) => {
  await projectStore.deleteProject(projectId);
  if (route.params.id === projectId) {
    router.push("/projects/new");
  }
};

const handleConfirmDelete = (projectId: string) => {
  projectToDelete.value = projectId;
};

const handleCancelDelete = () => {
  projectToDelete.value = null;
};

const handleConfirmDeleteAction = async () => {
  if (projectToDelete.value) {
    await handleProjectDelete(projectToDelete.value);
    projectToDelete.value = null;
  }
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
  <div class="projects-list" :class="{ expanded: isExpanded }">
    <template v-if="isExpanded">
      <div class="header">
        <sl-button variant="primary" size="small" @click="createNewProject">
          <sl-icon slot="prefix" name="plus-circle"></sl-icon>
          Start New Chat
        </sl-button>
      </div>

      <div class="scrollable-container">
        <div class="list">
          <ProjectListItem
            v-for="project in filteredProjects"
            :key="project.id"
            :project="project"
            @name-change="handleProjectRename"
            @confirm-delete="handleConfirmDelete"
          />
        </div>
      </div>
    </template>

    <div class="footer">
      <sl-icon-button
        class="toggle-button"
        :name="isExpanded ? 'chevron-left' : 'chevron-right'"
        :label="isExpanded ? 'Collapse' : 'Expand'"
        @click="toggleExpanded"
      />
    </div>

    <ConfirmationDialog
      v-if="projectToDelete"
      message="Are you sure you want to delete this project? This action cannot be undone."
      @confirm="handleConfirmDeleteAction"
      @cancel="handleCancelDelete"
    />
  </div>
</template>

<style scoped>
.projects-list {
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  background: var(--sl-color-neutral-0);
  border-right: 1px solid var(--sl-color-neutral-200);
  transition: width 0.3s ease;
  display: flex;
  flex-direction: column;
  z-index: 100;
}

.projects-list.expanded {
  width: 250px;
}

.projects-list:not(.expanded) {
  width: 48px;
}

.header {
  padding: 1rem;
  border-bottom: 1px solid var(--sl-color-neutral-200);
  flex-shrink: 0;
}

.scrollable-container {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
}

.list {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow-y: auto;
  padding: 0.5rem;
}

.footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0.5rem;
  border-top: 1px solid var(--sl-color-neutral-200);
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--sl-color-neutral-0);
}

.toggle-button {
  font-size: 1.2rem;
}
</style>
