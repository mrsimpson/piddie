<script setup lang="ts">
import { onMounted, watch, ref } from "vue";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import ProjectListItem from "./ProjectListItem.vue";
import CollapsiblePanel from "./ui/CollapsiblePanel.vue";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import { useRouter, useRoute } from "vue-router";

const projectStore = useProjectStore();
const { projects } = storeToRefs(projectStore);
const router = useRouter();
const route = useRoute();
const isCollapsed = ref(false);

const emit = defineEmits<{
  collapse: [isCollapsed: boolean];
}>();

const createNewProject = async () => {
  await router.push("/projects/new");
};

// Handle panel collapse
function handleCollapse(collapsed: boolean) {
  isCollapsed.value = collapsed;
  emit("collapse", collapsed);
}

// Load projects when component is mounted
onMounted(() => {
  projectStore.loadProjects();
});

// Refresh project list when route changes
watch(
  () => route.path,
  () => {
    projectStore.loadProjects();
  }
);
</script>

<template>
  <div class="projects-list" :class="{ collapsed: isCollapsed }">
    <CollapsiblePanel @collapse="handleCollapse" expand-icon="card-list">
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
