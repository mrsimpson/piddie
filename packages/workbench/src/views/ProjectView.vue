<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, provide } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "@/stores/project";
import { useChatStore } from "@/stores/chat";
import { useFileSystemStore } from "@/stores/file-system";
import ChatPanel from "@/components/ChatPanel.vue";
import FileExplorerPanel from "@/components/FileExplorerPanel.vue";
import CodeEditor from "@/components/CodeEditor.vue";

const route = useRoute();
const projectStore = useProjectStore();
const chatStore = useChatStore();
const fileSystemStore = useFileSystemStore();
const { currentProject } = storeToRefs(projectStore);

async function loadProjectChat() {
  if (!currentProject.value) return;

  // Try to find a chat for this project
  const chats = await chatStore.listChats();
  const projectChat = chats.find(
    (chat) =>
      chat.metadata &&
      typeof chat.metadata === "object" &&
      "projectId" in chat.metadata &&
      chat.metadata.projectId === currentProject.value?.id
  );

  if (projectChat) {
    await chatStore.loadChat(projectChat.id);
  } else {
    // Create a new chat for this project if none exists
    await chatStore.createChat({ projectId: currentProject.value.id });
  }
}

async function initializeProject() {
  const projectId = route.params.id as string;
  if (projectId) {
    await projectStore.setCurrentProject(projectId);
    await loadProjectChat();

    if (currentProject.value) {
      await fileSystemStore.initializeForProject(currentProject.value);
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
watch(
  () => route.params.id,
  async (newId) => {
    if (newId) {
      await fileSystemStore.cleanup();
      await initializeProject();
    }
  }
);
</script>

<template>
  <div class="project-details" v-if="currentProject">
    <ChatPanel :style="{ minWidth: '300px', maxWidth: '400px' }" />
    <FileExplorerPanel :style="{ minWidth: '300px', maxWidth: '400px' }"
      :systems="fileSystemStore.systems"
    />
    <CodeEditor :style="{ minWidth: '40%' }" />
  </div>
</template>

<style scoped>
.project-details {
  display: flex;
  height: 100%;
  gap: 1rem;
}
</style>
