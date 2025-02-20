<script setup lang="ts">
import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import ProjectListItem from "./ProjectListItem.vue";
import CollapsiblePanel from "./ui/CollapsiblePanel.vue";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";

const projectStore = useProjectStore();
const { projects } = storeToRefs(projectStore);

const createNewProject = async () => {
  await projectStore.createProject("untitled");
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
            v-for="project in projects"
            :key="project.id"
            :project="project"
          />
        </div>
      </template>
    </CollapsiblePanel>
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
</style>
