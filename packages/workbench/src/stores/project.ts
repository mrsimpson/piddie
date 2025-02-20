import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { Project } from "../types/project";
import { createProjectManager } from "@piddie/project-management";
import { useChatStore } from "./chat"; // Assuming chatStore is defined in a separate file

export const useProjectStore = defineStore("project", () => {
  const projectManager = createProjectManager();
  const chatStore = useChatStore(); // Initialize chatStore
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
    await projectManager.updateProject(project);
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

  async function deleteProject(projectId: string) {
    // Find and delete associated chat first
    const chats = await chatStore.listChats();
    const projectChat = chats.find(chat => 
      chat.metadata && typeof chat.metadata === 'object' && 
      'projectId' in chat.metadata && 
      chat.metadata.projectId === projectId
    );
    
    if (projectChat) {
      await chatStore.deleteChat(projectChat.id);
    }

    // Delete the project
    await projectManager.deleteProject(projectId);
    await loadProjects();

    // Clear current project if it's the one being deleted
    if (currentProject.value?.id === projectId) {
      currentProject.value = null;
      isChatVisible.value = false;
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
    deleteProject,
    toggleChat
  };
});
