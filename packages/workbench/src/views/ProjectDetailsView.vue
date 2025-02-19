<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import { useChatStore } from "../stores/chat";
import ProjectsList from "../components/ProjectsList.vue";
import ChatPanel from "../components/ChatPanel.vue";
import FileExplorer from "../components/FileExplorer.vue";
import CodeEditor from "../components/CodeEditor.vue";

const route = useRoute();
const router = useRouter();
const projectStore = useProjectStore();
const chatStore = useChatStore();
const { currentProject } = storeToRefs(projectStore);

async function loadProject() {
  try {
    await projectStore.setCurrentProject(route.params.id as string);
  } catch (error) {
    // If project not found, redirect to projects list
    router.replace("/projects");
  }
}

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

onMounted(async () => {
  await loadProject();
  await loadProjectChat();
});

// Reload project when route changes
watch(
  () => route.params.id,
  async (newId) => {
    if (newId) {
      await loadProject();
      await loadProjectChat();
    }
  }
);
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
  padding: 1rem;
}
</style>
