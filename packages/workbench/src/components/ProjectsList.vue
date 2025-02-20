<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import type { Project } from "../types/project";
import ProjectListItem from "./ProjectListItem.vue";
import ConfirmationDialog from "./ConfirmationDialog.vue";
import CollapsiblePanel from "./ui/CollapsiblePanel.vue";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";

const router = useRouter();
const route = useRoute();
const searchQuery = ref("");
const projectStore = useProjectStore();
const { projects, currentProject } = storeToRefs(projectStore);
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

onMounted(() => {
  projectStore.loadProjects();
});
</script>

<template>
  <div class="projects-list">
    <CollapsiblePanel>
      <template #header>
        <div class="header">
          <sl-button variant="primary" size="small" @click="createNewProject">
            <sl-icon slot="prefix" name="plus-circle"></sl-icon>
            Start New Chat
          </sl-button>
        </div>
      </template>

      <template #content>
        <div class="list">
          <ProjectListItem
            v-for="project in filteredProjects"
            :key="project.id"
            :project="project"
            @name-change="handleProjectRename"
            @confirm-delete="handleConfirmDelete"
            @select="handleProjectSelect"
          />
        </div>
      </template>
    </CollapsiblePanel>

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
  height: 100vh;
  background: var(--sl-color-neutral-0);
  border-right: 1px solid var(--sl-color-neutral-200);
  transition: width 0.3s ease;
}

.header {
  padding: 1rem;
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

.list {
  padding: 0.5rem;
}

.toggle-button {
  font-size: 1.2rem;
}
</style>
