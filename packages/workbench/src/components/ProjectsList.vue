<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '../stores/project'
import type { Project } from '../types/project'
import '@shoelace-style/shoelace/dist/components/button/button.js'
import '@shoelace-style/shoelace/dist/components/input/input.js'
import '@shoelace-style/shoelace/dist/components/card/card.js'
import '@shoelace-style/shoelace/dist/components/icon/icon.js'
import '@shoelace-style/shoelace/dist/components/relative-time/relative-time.js'

const searchQuery = ref('')
const projectStore = useProjectStore()
const { projects, currentProject } = storeToRefs(projectStore)

const filteredProjects = computed(() => {
  const query = searchQuery.value.toLowerCase()
  return projects.value.filter((project: Project) => 
    project.name.toLowerCase().includes(query)
  )
})

const createNewProject = async () => {
  await projectStore['createProject']('New Project')
}

const openProject = async (projectId: string) => {
  await projectStore['setCurrentProject'](projectId)
}

onMounted(() => {
  projectStore['loadProjects']()
})
</script>

<template>
  <div class="projects-container">
    <div class="header">
      <sl-button variant="primary" size="small" @click="createNewProject">
        <sl-icon slot="prefix" name="plus-circle"></sl-icon>
        Start New Chat
      </sl-button>
      <sl-input 
        v-model="searchQuery"
        placeholder="Search"
        size="small"
        clearable
      >
        <sl-icon slot="prefix" name="search"></sl-icon>
      </sl-input>
    </div>
    <div class="projects-list">
      <sl-card 
        v-for="project in filteredProjects" 
        :key="project.id"
        class="project-card"
        :class="{ active: currentProject?.id === project.id }"
        @click="openProject(project.id)"
      >
        <div class="project-name">{{ project.name }}</div>
        <div class="project-meta">
          Last accessed <sl-relative-time :date="project.lastAccessed" />
        </div>
      </sl-card>
    </div>
  </div>
</template>

<style scoped>
.projects-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1rem;
  gap: 1rem;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.projects-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

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

.project-name {
  font-weight: 500;
  margin-bottom: 0.25rem;
}

.project-meta {
  font-size: 0.875rem;
  color: var(--sl-color-neutral-600);
}
</style>
