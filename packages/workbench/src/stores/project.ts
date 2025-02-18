import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { Project } from "../types/project";
import { DexieProjectManager } from "@piddie/project-management";

export const useProjectStore = defineStore("project", () => {
  const projectManager = new DexieProjectManager();
  const currentProject = ref<Project | null>(null);
  const projects = ref<Project[]>([]);
  const isChatVisible = ref(false);

  const hasActiveProject = computed(() => currentProject.value !== null);

  async function loadProjects() {
    projects.value = await projectManager.listProjects();
  }

  async function createProject(name: string) {
    const project = await projectManager.createProject(name);
    await loadProjects();
    await setCurrentProject(project.id);
    return project;
  }

  async function setCurrentProject(projectId: string) {
    currentProject.value = await projectManager.openProject(projectId);
    isChatVisible.value = true;
  }

  async function renameProject(projectId: string, newName: string) {
    const project = await projectManager.getProjectMetadata(projectId);
    project.name = newName;
    await projectManager.db.projects.put(project);
    await loadProjects();

    // Update current project if it's the one being renamed
    if (currentProject.value?.id === projectId) {
      currentProject.value = project;
    }
  }

  async function updateProject(project: Project) {
    await projectManager.updateProject(project);
    await loadProjects();

    // Update current project if it's the one being updated
    if (currentProject.value?.id === project.id) {
      currentProject.value = project;
    }
  }

  function toggleChat(visible?: boolean) {
    isChatVisible.value = visible ?? !isChatVisible.value;
  }

  return {
    currentProject,
    projects,
    hasActiveProject,
    isChatVisible,
    loadProjects,
    createProject,
    setCurrentProject,
    renameProject,
    updateProject,
    toggleChat
  };
});
