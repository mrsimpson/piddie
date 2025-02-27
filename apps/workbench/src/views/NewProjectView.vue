<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useProjectStore } from "../stores/project";
import { useChatStore } from "../stores/chat";
import { useLlmStore } from "../stores/llm";
import "@shoelace-style/shoelace/dist/components/textarea/textarea.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";

const router = useRouter();
const projectStore = useProjectStore();
const chatStore = useChatStore();
const llmStore = useLlmStore();
const projectPrompt = ref("");

const samplePrompts = [
  {
    title: "Build a Todo App",
    shortPrompt: "Create a simple todo app with Vue 3",
    fullPrompt:
      "Help me create a todo application using Vue 3 and TypeScript. It should support adding, completing, and deleting tasks, with local storage persistence."
  },
  {
    title: "Browser game",
    shortPrompt: "Build a browser-based jump'n run",
    fullPrompt:
      "Help me build a classical platform jump'n run game using Phaser 3 and TypeScript. It should have a simple level design, with collectibles and enemies. The game should be responsive and optimized for mobile."
  },
  {
    title: "Weather Dashboard",
    shortPrompt: "Create a weather dashboard",
    fullPrompt:
      "Let's build a weather dashboard that shows current conditions and forecasts. Use the OpenWeather API and add charts for temperature trends."
  }
];

async function createProject() {
  if (!projectPrompt.value.trim()) return;

  // Generate a project name from the prompt
  const promptLines = projectPrompt.value.trim().split("\n");
  const firstLine = promptLines[0].trim();
  // Use the first line (up to 30 chars) as the project name, or fallback to "New Project"
  const projectName =
    firstLine.length > 0
      ? firstLine.length > 30
        ? firstLine.substring(0, 30) + "..."
        : firstLine
      : "New Project";

  try {
    // Create the project
    const project = await projectStore.createProject(projectName);

    // Create a chat and explicitly set it as the current chat
    const chat = await chatStore.createChat({ projectId: project.id });

    // Ensure the chat is loaded as the current chat
    await chatStore.loadChat(chat.id);

    // Use the LLM store to send the message, which will trigger the LLM interaction
    // Wait for the message to be sent before navigating
    await llmStore.sendMessage(projectPrompt.value, chat.id);

    // Navigate to the project page
    router.push(`/projects/${project.id}`);
  } catch (error) {
    console.error("Error creating project:", error);
    // Handle error (could add error display to the UI)
  }
}

function useTemplate(prompt: string) {
  projectPrompt.value = prompt;
}
</script>

<template>
  <div class="new-project">
    <div class="prompt-container">
      <sl-textarea
        v-model="projectPrompt"
        placeholder="What would you like to build?"
        resize="auto"
        rows="10"
      />
      <sl-button variant="primary" size="large" @click="createProject">
        Start Project
      </sl-button>
    </div>

    <div class="templates">
      <h2>Quick Start Templates</h2>
      <div class="template-cards">
        <sl-tooltip
          v-for="template in samplePrompts"
          :key="template.title"
          :content="template.fullPrompt"
          placement="top"
        >
          <sl-card
            class="template-card"
            @click="useTemplate(template.fullPrompt)"
          >
            <h3>{{ template.title }}</h3>
            <p>{{ template.shortPrompt }}</p>
          </sl-card>
        </sl-tooltip>
      </div>
    </div>
  </div>
</template>

<style scoped>
.new-project {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem 2rem;
  gap: 4rem;
}

.prompt-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 600px;
}

sl-textarea::part(base) {
  min-height: 300px;
  font-size: 1.1rem;
}

.templates {
  width: 100%;
  max-width: 600px;
}

.templates h2 {
  text-align: center;
  margin-bottom: 1.5rem;
  font-size: 1.2rem;
  color: var(--sl-color-neutral-600);
}

.template-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
}

.template-card {
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  height: 100%;
}

.template-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--sl-shadow-medium);
}

.template-card h3 {
  margin: 0 0 0.5rem 0;
  color: var(--sl-color-primary-600);
}

.template-card p {
  margin: 0;
  color: var(--sl-color-neutral-700);
  font-size: 0.9rem;
  line-height: 1.4;
}
</style>
