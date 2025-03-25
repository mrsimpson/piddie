<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { useChatStore } from "@piddie/chat-management-ui-vue";
import { useLlmStore } from "@piddie/llm-integration-ui-vue";
import { LlmSettings } from "@piddie/llm-integration-ui-vue";
import "@piddie/llm-integration-ui-vue/style";
import "@shoelace-style/shoelace/dist/components/textarea/textarea.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import type { ModelInfo } from "@piddie/settings";

const router = useRouter();
const projectStore = useProjectStore();
const chatStore = useChatStore();
const llmStore = useLlmStore();
const projectPrompt = ref("");
const errorMessage = ref("");
const showSettings = ref(false);
const isCreating = ref(false);
const isInitializing = ref(true);

// Computed property to check if a model is selected
const isModelSelected = computed(() => !!llmStore.config.defaultModel);

// Computed property to get the selected model name
const selectedModelName = computed(() => {
  if (!llmStore.config.defaultModel) return "";

  // Find the model in available models
  const modelInfo = llmStore.availableModels.find(
    (m: ModelInfo) => m.id === llmStore.config.defaultModel
  );
  return modelInfo ? modelInfo.name : llmStore.config.defaultModel;
});

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

// Initialize LLM store and verify connection on mount
onMounted(async () => {
  try {
    isInitializing.value = true;
    await llmStore.initializeStore();

    // If we have an API key and provider set, verify the connection
    if (llmStore.config.apiKey && llmStore.config.provider !== "mock") {
      await llmStore.verifyConnection();
    }

    // If no model is selected but we have available models, select the first one
    if (!llmStore.config.defaultModel && llmStore.availableModels.length > 0) {
      await llmStore.updateConfig({
        ...llmStore.config,
        defaultModel: llmStore.availableModels[0].id,
        selectedModel: llmStore.availableModels[0].id
      });
    }
  } catch (error) {
    console.error("Error initializing LLM store:", error);
    errorMessage.value =
      "Failed to initialize LLM settings. Please configure the model settings.";
  } finally {
    isInitializing.value = false;
  }
});

async function createProject() {
  if (!projectPrompt.value.trim()) {
    errorMessage.value = "Please enter a project description";
    return;
  }

  // Check if a model is selected
  if (!isModelSelected.value) {
    errorMessage.value = "Please select an LLM model before starting a project";
    return;
  }

  errorMessage.value = ""; // Clear any previous error
  isCreating.value = true; // Set loading state

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
    const chat = await chatStore.createChat(project.id);

    // Ensure the chat is loaded as the current chat
    await chatStore.loadChat(chat.id);

    // Store the message content to send
    const messageContent = projectPrompt.value;

    // Navigate to the project page immediately
    router.push(`/projects/${project.id}`);

    // Start the LLM interaction in the background without awaiting it
    // This allows the navigation to happen immediately
    llmStore.sendMessage(messageContent, chat.id).catch((error: Error) => {
      console.error("Error sending message to LLM:", error);
      // We don't need to set errorMessage here since we've already navigated away
    });
  } catch (error) {
    console.error("Error creating project:", error);
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "An error occurred while creating the project";
    isCreating.value = false; // Reset loading state on error
  }
}

function useTemplate(prompt: string) {
  projectPrompt.value = prompt;
}

function toggleSettings() {
  showSettings.value = !showSettings.value;
}
</script>

<template>
  <div class="new-project">
    <div v-if="isInitializing" class="loading-state">
      <sl-spinner></sl-spinner>
      <p>Initializing LLM settings...</p>
    </div>
    <div v-else class="prompt-container">
      <sl-textarea
        v-model="projectPrompt"
        placeholder="What would you like to build?"
        resize="auto"
        rows="10"
      />

      <!-- Error message display -->
      <div v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>

      <sl-button
        variant="primary"
        size="large"
        @click="createProject"
        :disabled="!isModelSelected || !projectPrompt.trim() || isCreating"
      >
        <span v-if="isCreating">
          <sl-spinner></sl-spinner>
          Creating project...
        </span>
        <span v-else-if="isModelSelected">
          Start developing with {{ selectedModelName }}
        </span>
        <span v-else> Start Project </span>
      </sl-button>

      <!-- LLM Settings Component - only show if no model selected or settings toggled -->
      <div
        v-if="!isModelSelected || showSettings"
        class="llm-settings-container"
      >
        <LlmSettings :embedded="true" />
      </div>

      <!-- Model selection status or change link -->
      <div v-if="!isModelSelected" class="model-status-message">
        Please select a model in the settings above before starting a project
      </div>
      <div v-else class="change-model-link">
        <a href="#" @click.prevent="toggleSettings">
          <span v-if="!showSettings">Change model</span>
          <span v-else>Hide model settings</span>
        </a>
      </div>
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

.llm-settings-container {
  margin: 1rem 0;
  border-radius: var(--sl-border-radius-medium);
  overflow: hidden;
}

.model-selected-info {
  margin: 1rem 0;
  padding: 0.75rem;
  background-color: var(--sl-color-success-100);
  border-radius: var(--sl-border-radius-medium);
  display: flex;
  align-items: center;
  justify-content: center;
}

.model-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--sl-color-success-700);
  font-weight: var(--sl-font-weight-semibold);
}

.model-badge sl-icon {
  font-size: 1.2rem;
}

.error-message {
  margin: 1rem 0;
  padding: 0.75rem;
  background-color: var(--sl-color-danger-100);
  color: var(--sl-color-danger-700);
  border-radius: var(--sl-border-radius-medium);
  font-size: 0.9rem;
}

.model-status-message {
  margin-top: 0.75rem;
  color: var(--sl-color-warning-700);
  font-size: 0.9rem;
  text-align: center;
}

.change-model-link {
  margin-top: 0.5rem;
  text-align: center;
  font-size: 0.75rem;
}

.change-model-link a {
  color: var(--sl-color-neutral-500);
  text-decoration: none;
}

.change-model-link a:hover {
  text-decoration: underline;
  color: var(--sl-color-primary-600);
}

sl-button::part(base) {
  min-width: 200px;
}

sl-button sl-spinner {
  margin-right: 0.5rem;
  font-size: 1rem;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--sl-color-neutral-500);
  gap: 1rem;
}
</style>
