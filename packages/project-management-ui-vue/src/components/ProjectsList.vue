<script setup lang="ts">
import { onMounted, watch, ref } from "vue";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import ProjectListItem from "./ProjectListItem.vue";
import { CollapsiblePanel } from "@piddie/common-ui-vue";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import { useRouter, useRoute } from "vue-router";

const projectStore = useProjectStore();
const { projects } = storeToRefs(projectStore);
const router = useRouter();
const isCollapsed = ref(false);

const props = defineProps<{
  currentPath?: string;
  activeProjectId?: string;
}>();

const emit = defineEmits<{
  collapse: [isCollapsed: boolean];
  createProject: [];
  refreshProjects: [];
  navigateToProject: [projectId: string];
  renameProject: [projectId: string, newName: string];
  deleteProject: [projectId: string];
}>();

// Handle panel collapse
function handleCollapse(collapsed: boolean) {
  isCollapsed.value = collapsed;
  emit("collapse", collapsed);
}

// Load projects when component is mounted
onMounted(() => {
  emit("refreshProjects");
});

// Refresh project list when path changes
watch(
  () => props.currentPath,
  () => {
    if (props.currentPath) {
      emit("refreshProjects");
    }
  }
);

function handleProjectNavigate(projectId: string) {
  emit("navigateToProject", projectId);
}

function handleProjectRename(projectId: string, newName: string) {
  emit("renameProject", projectId, newName);
}

function handleProjectDelete(projectId: string) {
  emit("deleteProject", projectId);
}
</script>

<template>
  <div class="projects-list" :class="{ collapsed: isCollapsed }">
    <CollapsiblePanel @collapse="handleCollapse" expand-icon="card-list">
      <template #header>
        <div class="header">
          <sl-button variant="primary" size="small" @click="$emit('createProject')">
            <sl-icon slot="prefix" name="plus-circle"></sl-icon>
            Start New Chat
          </sl-button>
        </div>
      </template>

      <template #content>
        <div class="list">
          <ProjectListItem
            v-for="project in projects"
            :key="project.id"
            :project="project"
            :is-active="project.id === activeProjectId"
            @navigate="handleProjectNavigate"
            @rename="handleProjectRename"
            @delete="handleProjectDelete"
          />
        </div>
      </template>
    </CollapsiblePanel>
  </div>
</template>

<style scoped>
.projects-list {
  height: 100vh;
  width: 350px;
  transition: width 0.3s ease;
  background: var(--sl-color-neutral-0);
  border-right: 1px solid var(--sl-color-neutral-200);
  flex-shrink: 0;
}

.projects-list.collapsed {
  width: 40px;
}

.header {
  padding: 1rem;
  border-bottom: 1px solid var(--sl-color-neutral-200);
}

.list {
  overflow-y: auto;
  height: calc(100% - 50px);
  padding: 0.5rem;
}
</style>
