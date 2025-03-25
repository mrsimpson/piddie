<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { ProjectsList } from "@piddie/project-management-ui-vue";

const router = useRouter();
const route = useRoute();
const projectStore = useProjectStore();

function handleCreateProject() {
  router.push("/projects/new");
}

function handleRefreshProjects() {
  projectStore.loadProjects();
}

function handleCollapse(collapsed: boolean) {
  // Handle collapse if needed
}

async function handleNavigateToProject(projectId: string) {
  await router.push(`/projects/${projectId}`);
}

async function handleRenameProject(projectId: string, newName: string) {
  await projectStore.renameProject(projectId, newName);
  await projectStore.loadProjects();
}

async function handleDeleteProject(projectId: string) {
  await projectStore.deleteProject(projectId);
  await projectStore.loadProjects();
  await router.push("/projects/new");
}
</script>

<template>
  <ProjectsList
    :current-path="route.path"
    :active-project-id="route.params.id as string"
    @create-project="handleCreateProject"
    @refresh-projects="handleRefreshProjects"
    @collapse="handleCollapse"
    @navigate-to-project="handleNavigateToProject"
    @rename-project="handleRenameProject"
    @delete-project="handleDeleteProject"
  />
</template>
