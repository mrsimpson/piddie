import { ref, computed } from "vue";
import { defineStore, getActivePinia } from "pinia";
import type { Project } from "@piddie/shared-types";
import { createProjectManager } from "@piddie/project-management";
import { useChatStore } from "@piddie/chat-management-ui-vue";
import { useFileSystemStore } from "@piddie/files-management-ui-vue";

export type ChatStore = ReturnType<typeof useChatStore>;

export const useProjectStore = defineStore("project", () => {
  const projectManager = createProjectManager();
  const currentProject = ref<Project | null>(null);
  const projects = ref<Project[]>([]);
  const isChatVisible = ref(false);
  const isInitializing = ref(false);

  const hasActiveProject = computed(() => currentProject.value !== null);
  const isLoading = computed(() => isInitializing.value);

  async function loadProjects() {
    projects.value = await projectManager.listProjects();
  }

  async function createProject(name: string) {
    const project = await projectManager.createProject(name);
    await loadProjects();
    await initializeProject(project.id);
    return project;
  }

  async function initializeProject(projectId: string) {
    if (isInitializing.value) return;

    const chatStore = useChatStore(getActivePinia());

    try {
      isInitializing.value = true;

      // Check if the current chat is associated with the project
      const currentChat = chatStore.currentChat;
      const currentChatIsForProject =
        !!currentChat?.projectId && currentChat?.projectId === projectId;

      // Only clean up chat if it's not already associated with the project
      if (!!currentChat?.projectId && !currentChatIsForProject) {
        await chatStore.cleanup();
      }

      // Initialize chat only if it's not already associated with the project
      if (!currentChatIsForProject) {
        // Try to find an existing chat for this project
        const projectChats = await chatStore.listProjectChats(projectId);

        if (projectChats.length > 0) {
          // Use the most recent chat
          await chatStore.loadChat(projectChats[0].id);
        } else {
          // Create a new chat for this project
          await chatStore.createChat(projectId);
        }
      }

      // Load project
      currentProject.value = await projectManager.openProject(projectId);

      isChatVisible.value = true;
    } finally {
      isInitializing.value = false;
    }
  }

  async function setCurrentProject(projectId: string) {
    await initializeProject(projectId);
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
    const chatStore = useChatStore();
    const fileSystemStore = useFileSystemStore();

    // Check if we're deleting the current project
    const isDeletingCurrentProject = currentProject.value?.id === projectId;

    // Find and delete associated chats
    const projectChats = await chatStore.listProjectChats(projectId);

    for (const chat of projectChats) {
      await chatStore.deleteChat(chat.id);
    }

    // Clean up file systems
    if (isDeletingCurrentProject) {
      // If we're deleting the current project, clean up all file systems
      await fileSystemStore.cleanup();
    }
    await fileSystemStore.cleanupProjectFileSystem(projectId);

    // Delete the project
    await projectManager.deleteProject(projectId);

    await loadProjects();

    // Clear current project if it's the one being deleted
    if (isDeletingCurrentProject) {
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
    isLoading,
    loadProjects,
    createProject,
    setCurrentProject,
    renameProject,
    updateProject,
    deleteProject,
    toggleChat
  };
});
