<script setup lang="ts">
import { ref } from "vue";
import type { Project } from "@piddie/shared-types";
import { EditableText } from "@piddie/common-ui-vue";
import { ConfirmationDialog } from "@piddie/common-ui-vue";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/relative-time/relative-time.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";

const props = defineProps<{
  project: Project;
  isActive: boolean;
}>();

const emit = defineEmits<{
  navigate: [projectId: string];
  rename: [projectId: string, newName: string];
  delete: [projectId: string];
}>();

const showDeleteConfirmation = ref(false);

function handleNameChange(newName: string) {
  emit("rename", props.project.id, newName);
}

function handleDelete() {
  showDeleteConfirmation.value = true;
}

function handleConfirmDelete() {
  emit("delete", props.project.id);
  showDeleteConfirmation.value = false;
}

function handleCancelDelete() {
  showDeleteConfirmation.value = false;
}

function handleNavigate() {
  emit("navigate", props.project.id);
}
</script>

<template>
  <div class="project-link">
    <sl-card
      class="project-card"
      :class="{ active: isActive }"
      @click="handleNavigate"
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
  </div>

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
