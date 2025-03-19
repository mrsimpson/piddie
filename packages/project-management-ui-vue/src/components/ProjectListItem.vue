<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProjectStore } from "../stores/project";
import type { Project } from "../types/project";
import EditableText from "./ui/EditableText.vue";
import ConfirmationDialog from "./ConfirmationDialog.vue";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/relative-time/relative-time.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";

const router = useRouter();

const props = defineProps<{
  project: Project;
}>();

const route = useRoute();
const projectStore = useProjectStore();
const showDeleteConfirmation = ref(false);

async function handleNameChange(newName: string) {
  await projectStore.renameProject(props.project.id, newName);
}

function handleDelete() {
  showDeleteConfirmation.value = true;
}

async function handleConfirmDelete() {
  await projectStore.deleteProject(props.project.id);
  showDeleteConfirmation.value = false;

  // Explicitly refresh the project list
  await projectStore.loadProjects();

  router.push("/projects/new");
}

function handleCancelDelete() {
  showDeleteConfirmation.value = false;
}
</script>

<template>
  <router-link
    :to="`/projects/${project.id}`"
    class="project-link"
    custom
    v-slot="{ navigate }"
  >
    <sl-card
      class="project-card"
      :class="{ active: route.params.id === project.id }"
      @click="navigate"
    >
      <div class="project-content">
        <div class="project-header">
          <EditableText
            :value="project.name"
            size="small"
            @change="handleNameChange"
          />
          <sl-icon-button
            name="trash"
            label="Delete"
            @click.stop="handleDelete"
          />
        </div>
      </div>
    </sl-card>
  </router-link>

  <ConfirmationDialog
    v-if="showDeleteConfirmation"
    message="Are you sure you want to delete this project? This action cannot be undone."
    @confirm="handleConfirmDelete"
    @cancel="handleCancelDelete"
  />
</template>

<style scoped>
.project-link {
  text-decoration: none;
  color: inherit;
}

.project-card {
  cursor: pointer;
  --padding: 0.75rem;
  transition: background-color 0.2s ease;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 4px;
}

.project-card:hover {
  background-color: var(--sl-color-neutral-50);
}

.project-card.active::part(base) {
  background-color: var(--sl-color-primary-200);
}

.project-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.project-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.project-meta {
  font-size: 0.875rem;
  color: var(--sl-color-neutral-600);
}
</style>
