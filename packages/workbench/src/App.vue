<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useProjectStore } from "./stores/project";
import ProjectsList from "./components/ProjectsList.vue";
import ChatPanel from "./components/ChatPanel.vue";
import FileExplorer from "./components/FileExplorer.vue";
import CodeEditor from "./components/CodeEditor.vue";

const projectStore = useProjectStore();
const { isChatVisible } = storeToRefs(projectStore);
</script>

<template>
  <div class="app-container" :class="{ 'chat-hidden': !isChatVisible }">
    <ProjectsList class="projects-list" />
    <ChatPanel v-if="isChatVisible" class="chat-panel" />
    <FileExplorer class="file-explorer" />
    <CodeEditor class="code-editor" />
  </div>
</template>

<style scoped>
.app-container {
  display: grid;
  grid-template-columns: 250px 300px 250px 1fr;
  grid-template-areas: "projects chat files editor";
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.app-container.chat-hidden {
  grid-template-columns: 250px 0 250px 1fr;
}

.projects-list {
  grid-area: projects;
  border-right: 1px solid var(--sl-color-neutral-200);
}

.chat-panel {
  grid-area: chat;
  border-right: 1px solid var(--sl-color-neutral-200);
}

.file-explorer {
  grid-area: files;
  border-right: 1px solid var(--sl-color-neutral-200);
}

.code-editor {
  grid-area: editor;
}
</style>
