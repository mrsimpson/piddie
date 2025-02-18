<script setup lang="ts">
import type { Project } from "../types/project";
import EditableText from "./ui/EditableText.vue";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/relative-time/relative-time.js";

const props = defineProps<{
  project: Project;
  isActive: boolean;
}>();

const emit = defineEmits<{
  select: [projectId: string];
  nameChange: [projectId: string, newName: string];
}>();

function handleNameChange(newName: string) {
  emit('nameChange', props.project.id, newName);
}

function handleClick(event: MouseEvent) {
  // Don't trigger project selection when clicking input or edit button
  if (!(event.target as HTMLElement).closest('sl-input, sl-icon-button')) {
    emit('select', props.project.id);
  }
}
</script>

<template>
  <sl-card 
    class="project-card" 
    :class="{ active: isActive }"
    @click="handleClick"
  >
    <div class="project-content">
      <EditableText
        :value="project.name"
        size="small"
        @change="handleNameChange"
      />
      <div class="project-meta">
        Last accessed <sl-relative-time :date="project.lastAccessed" />
      </div>
    </div>
  </sl-card>
</template>

<style scoped>
.project-card {
  cursor: pointer;
  --padding: 0.75rem;
  transition: background-color 0.2s ease;
}

.project-card:hover {
  background-color: var(--sl-color-neutral-50);
}

.project-card.active {
  background-color: var(--sl-color-primary-50);
  border-color: var(--sl-color-primary-200);
}

.project-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.project-meta {
  font-size: 0.875rem;
  color: var(--sl-color-neutral-600);
}
</style>
