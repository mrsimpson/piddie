<script setup lang="ts">
import type { Project } from "../types/project";
import EditableText from "./ui/EditableText.vue";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/relative-time/relative-time.js";
import { useRoute } from "vue-router";

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  nameChange: [projectId: string, newName: string];
}>();

const route = useRoute();

function handleNameChange(newName: string) {
  emit("nameChange", props.project.id, newName);
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
        <EditableText
          :value="project.name"
          size="small"
          @change="handleNameChange"
        />

      </div>
    </sl-card>
  </router-link>
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
  padding: 4px;
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
