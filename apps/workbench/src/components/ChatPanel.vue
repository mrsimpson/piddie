<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useChatStore } from "@piddie/chat-management-ui-vue";
import { AgentSettings, useLlmStore } from "@piddie/llm-integration-ui-vue";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { MessagesList, SimpleChatInput } from "@piddie/chat-management-ui-vue";
import { CollapsiblePanel } from "@piddie/common-ui-vue";
import { LlmSettings } from "@piddie/llm-integration-ui-vue";
import "@piddie/chat-management-ui-vue/style";
import "@piddie/llm-integration-ui-vue/style";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";

const props = defineProps<{
  initialCollapsed?: boolean;
}>();

const emit = defineEmits<{
  collapse: [isCollapsed: boolean];
}>();

const chatStore = useChatStore();
const llmStore = useLlmStore();
const projectStore = useProjectStore();

const isSubmitting = computed(() => llmStore.isProcessing);
const messages = computed(() => chatStore.messages);
const currentChat = computed(() => chatStore.currentChat);
const currentProject = computed(() => projectStore.currentProject);
const showSettings = ref(false);
const showAgentSettings = ref(false);

// Computed properties for LLM settings
const isModelSelected = computed(() => !!llmStore.config.defaultModel);
const selectedModelName = computed(() => {
  if (!llmStore.config.defaultModel) return "No model selected";

  // Find the model in available models
  const modelInfo = llmStore.availableModels.find(
    (m) => m.id === llmStore.config.defaultModel
  );
  return modelInfo ? modelInfo.name : llmStore.config.defaultModel;
});

// Auto-expand settings if no model is selected
watch(
  isModelSelected,
  (selected) => {
    if (!selected) {
      showSettings.value = true;
    }
  },
  { immediate: true }
);

// Watch for project changes to load the associated chat
watch(
  () => currentProject.value?.id,
  async (newProjectId) => {
    if (newProjectId) {
      // Try to load the chat associated with this project
      const projectChats = await chatStore.listProjectChats(newProjectId, 1);
      const projectChat = projectChats[0]; // Get the most recent chat for this project

      if (projectChat) {
        // Load existing chat if found
        await chatStore.loadChat(projectChat.id);
      } else {
        // Create a new chat if none exists for this project
        await chatStore.createChat(newProjectId);
      }
    }
  },
  { immediate: true }
);

// Add new ref for agent settings state
const agentEnabled = ref(false);

// Update the agent icon class computed
const agentIconClass = computed(() => {
  if (!currentChat.value) return "";
  return agentEnabled.value ? "agent-enabled" : "";
});

// Watch for chat changes to update agent state
watch(
  () => currentChat.value?.id,
  async (chatId) => {
    if (chatId) {
      try {
        const settings = await llmStore.getAgentSettings(chatId);
        agentEnabled.value = settings?.enabled ?? false;
      } catch (error) {
        console.error("Error loading agent settings:", error);
        agentEnabled.value = false;
      }
    } else {
      agentEnabled.value = false;
    }
  },
  { immediate: true }
);

// Watch for agent settings changes
watch(showAgentSettings, async (show) => {
  if (!show && currentChat.value?.id) {
    // When closing settings panel, refresh agent state
    try {
      const settings = await llmStore.getAgentSettings(currentChat.value.id);
      agentEnabled.value = settings?.enabled ?? false;
    } catch (error) {
      console.error("Error refreshing agent settings:", error);
    }
  }
});

// Send a message to the LLM
async function sendMessage(content: string) {
  if (
    !content.trim() ||
    isSubmitting.value ||
    !currentChat.value ||
    !isModelSelected.value
  )
    return;

  await llmStore.sendMessage(content, currentChat.value.id);
}

// Cancel the current streaming response
function cancelStreaming() {
  llmStore.cancelStreaming();
}

// Toggle LLM settings visibility
function toggleSettings() {
  showSettings.value = !showSettings.value;
  // Close agent settings if opening model settings
  if (showSettings.value) {
    showAgentSettings.value = false;
  }
}

// Toggle agent settings visibility
function toggleAgentSettings() {
  showAgentSettings.value = !showAgentSettings.value;
  // Close model settings if opening agent settings
  if (showAgentSettings.value) {
    showSettings.value = false;
  }
}

// Handle panel collapse
function handleCollapse(isCollapsed: boolean) {
  emit("collapse", isCollapsed);
}
</script>

<template>
  <CollapsiblePanel
    title="Chat"
    expand-icon="chat-left"
    :initial-collapsed="props.initialCollapsed"
    @collapse="handleCollapse"
  >
    <template #content>
      <div class="chat-content">
        <div v-if="!currentProject" class="empty-state">
          <p>Select or create a project to start chatting</p>
        </div>
        <div v-else-if="messages.length === 0" class="empty-state">
          <p>No messages yet. Start a conversation!</p>
        </div>

        <MessagesList v-else :messages="messages" />
      </div>
    </template>

    <template #footer>
      <div class="input-container">
        <!-- LLM Settings Panel (conditionally shown) -->
        <div v-if="showSettings" class="settings-container">
          <LlmSettings :embedded="true" />
        </div>

        <!-- Agent Settings Panel (conditionally shown) -->
        <div v-if="showAgentSettings" class="settings-container">
          <AgentSettings :embedded="true" />
        </div>

        <!-- Chat Input -->
        <div class="chat-input-wrapper">
          <SimpleChatInput
            @send-message="sendMessage"
            :disabled="isSubmitting || !currentProject || !isModelSelected"
          />
        </div>

        <!-- Model Selection and Actions Row -->
        <div class="model-and-actions-row">
          <!-- Selectors Container -->
          <div class="selectors-container">
            <!-- Model Selection Button -->
            <div
              class="model-selector"
              @click="toggleSettings"
              :class="{
                'model-not-selected': !isModelSelected,
                active: showSettings
              }"
            >
              <sl-icon name="cpu" class="model-icon"></sl-icon>
              <span class="model-name">{{ selectedModelName }}</span>
              <sl-icon
                :name="showSettings ? 'chevron-down' : 'chevron-right'"
                class="expand-icon"
              ></sl-icon>
            </div>

            <!-- Agent Settings Button -->
            <div
              class="agent-selector"
              @click="toggleAgentSettings"
              :class="{ active: showAgentSettings }"
            >
              <sl-icon
                name="robot"
                class="agent-icon"
                :class="agentIconClass"
              ></sl-icon>
              <span class="agent-name">Agent</span>
              <sl-icon
                :name="showAgentSettings ? 'chevron-down' : 'chevron-right'"
                class="expand-icon"
              ></sl-icon>
            </div>
          </div>

          <!-- Cancel Button -->
          <div class="chat-actions" v-if="llmStore.isStreaming">
            <button @click="cancelStreaming" class="cancel-button">
              Cancel
            </button>
          </div>

          <!-- Processing Indicator -->
          <div class="chat-actions" v-if="isSubmitting">
            <div class="processing-indicator">
              <sl-spinner class="send-spinner"></sl-spinner>
              Sending...
            </div>
          </div>
        </div>
      </div>
    </template>
  </CollapsiblePanel>
</template>

<style scoped>
.chat-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  width: 100%;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--sl-color-neutral-500);
}

.input-container {
  display: flex;
  flex-direction: column;
  padding: var(--sl-spacing-small);
  border-top: 1px solid var(--sl-color-neutral-200);
  background-color: var(--sl-color-neutral-50);
  width: 100%;
  box-sizing: border-box;
}

.settings-container {
  margin-bottom: var(--sl-spacing-small);
  width: 100%;
  box-sizing: border-box;
}

.chat-input-wrapper {
  margin-bottom: 0.5rem;
}

.model-and-actions-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 40px;
  width: 100%;
  box-sizing: border-box;
}

.selectors-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 60%;
  overflow: hidden;
  box-sizing: border-box;
}

.model-selector,
.agent-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background-color: var(--sl-color-neutral-100);
  border-radius: var(--sl-border-radius-medium);
  cursor: pointer;
  transition: background-color 0.2s;
  box-sizing: border-box;
}

.model-selector:hover,
.agent-selector:hover {
  background-color: var(--sl-color-neutral-200);
}

.model-selector.active,
.agent-selector.active {
  background-color: var(--sl-color-primary-100);
  color: var(--sl-color-primary-700);
}

.model-not-selected {
  background-color: var(--sl-color-warning-100);
  color: var(--sl-color-warning-700);
}

.model-icon,
.agent-icon {
  font-size: 1rem;
  color: var(--sl-color-primary-600);
  flex-shrink: 0;
}

.model-name,
.agent-name {
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.expand-icon {
  font-size: 0.875rem;
  color: var(--sl-color-neutral-500);
  flex-shrink: 0;
}

.chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
}

.processing-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--sl-color-neutral-700);
}

button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: var(--sl-border-radius-medium);
  font-weight: bold;
  cursor: pointer;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
}

.cancel-button {
  background-color: var(--sl-color-neutral-300);
  color: var(--sl-color-neutral-900);
}

.cancel-button:hover {
  background-color: var(--sl-color-neutral-400);
}

.send-spinner {
  font-size: 1rem;
}

:deep(.panel-content) {
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

:deep(.panel-footer) {
  width: 100%;
  box-sizing: border-box;
  padding: 0;
}

.agent-icon.agent-enabled {
  color: var(--sl-color-primary-600);
}

.agent-icon:not(.agent-enabled) {
  color: var(--sl-color-neutral-600);
}
</style>
