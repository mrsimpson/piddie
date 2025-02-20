<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, provide } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import { useChatStore } from "../stores/chat";
import { useFileSystemStore } from "../stores/file-system";
import ProjectsList from "../components/ProjectsList.vue";
import ChatPanel from "../components/ChatPanel.vue";
import FileExplorer from "../components/FileExplorer.vue";
import CodeEditor from "../components/CodeEditor.vue";

const route = useRoute();
const projectStore = useProjectStore();
const chatStore = useChatStore();
const fileSystemStore = useFileSystemStore();
const { currentProject } = storeToRefs(projectStore);

async function loadProjectChat() {
  if (!currentProject.value) return;
  
  // Try to find a chat for this project
  const chats = await chatStore.listChats();
  const projectChat = chats.find(chat => 
    chat.metadata && typeof chat.metadata === 'object' && 
    'projectId' in chat.metadata && 
    chat.metadata.projectId === currentProject.value?.id
  );
  
  if (projectChat) {
    await chatStore.loadChat(projectChat.id);
  }
}

async function initializeProject() {
  const projectId = route.params.id as string;
  if (projectId) {
    await projectStore.setCurrentProject(projectId);
    await loadProjectChat();
    
    if (currentProject.value?.fileSystemRoot) {
      await fileSystemStore.initializeForProject(currentProject.value.fileSystemRoot);
      // Provide sync manager to child components
      provide("syncManager", fileSystemStore.syncManager);
    }
  }
}

onMounted(async () => {
  await initializeProject();
});

onBeforeUnmount(async () => {
  await fileSystemStore.cleanup();
});

// Reload project when route changes
watch(() => route.params.id, async (newId) => {
  if (newId) {
    await fileSystemStore.cleanup();
    await initializeProject();
  }
});
</script>

<template>
  <div class="project-details">
    <ChatPanel v-if="currentProject" />
    <FileExplorer />
    <CodeEditor />
  </div>
</template>

<style scoped>
.project-details {
  display: flex;
  height: 100%;
  gap: 1rem;
}
</style>
