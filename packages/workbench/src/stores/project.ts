import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { Project } from '../types/project'
import { DexieProjectManager } from '@piddie/project-management'

export const useProjectStore = defineStore('project', () => {
  const projectManager = new DexieProjectManager()
  const currentProject = ref<Project | null>(null)
  const projects = ref<Project[]>([])

  const hasActiveProject = computed(() => currentProject.value !== null)

  async function loadProjects() {
    projects.value = await projectManager.listProjects()
  }

  async function createProject(name: string) {
    const project = await projectManager.createProject(name)
    await loadProjects()
    await setCurrentProject(project.id)
    return project
  }

  async function setCurrentProject(projectId: string) {
    currentProject.value = await projectManager.openProject(projectId)
  }

  return {
    currentProject,
    projects,
    hasActiveProject,
    loadProjects,
    createProject,
    setCurrentProject
  }
})
