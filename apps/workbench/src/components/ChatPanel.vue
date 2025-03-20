<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { useChatStore } from "../stores/chat";
import { useLlmStore } from "../stores/llm";
import { useProjectStore } from "../stores/project";
import { MessageStatus } from "@piddie/chat-management";
import { MessagesList, SimpleChatInput } from "@piddie/chat-management-ui-vue";
import CollapsiblePanel from "./ui/CollapsiblePanel.vue";
import LlmSettings from "./LlmSettings.vue";
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
      const chats = await chatStore.listChats();
      const projectChat = chats.find((chat) => chat.projectId === newProjectId);

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

        <!-- Chat Input -->
        <div class="chat-input-wrapper">
          <SimpleChatInput
            @send-message="sendMessage"
            :disabled="isSubmitting || !currentProject || !isModelSelected"
          />
        </div>

        <!-- Model Selection and Actions Row -->
        <div class="model-and-actions-row">
          <!-- Model Selection Button -->
          <div
            class="model-selector"
            @click="toggleSettings"
            :class="{ 'model-not-selected': !isModelSelected }"
          >
            <sl-icon name="cpu" class="model-icon"></sl-icon>
            <span class="model-name">{{ selectedModelName }}</span>
            <sl-icon
              :name="showSettings ? 'chevron-down' : 'chevron-right'"
              class="expand-icon"
            ></sl-icon>
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

.model-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background-color: var(--sl-color-neutral-100);
  border-radius: var(--sl-border-radius-medium);
  cursor: pointer;
  transition: background-color 0.2s;
  max-width: 60%;
  overflow: hidden;
  box-sizing: border-box;
}

.model-selector:hover {
  background-color: var(--sl-color-neutral-200);
}

.model-not-selected {
  background-color: var(--sl-color-warning-100);
  color: var(--sl-color-warning-700);
}

.model-icon {
  font-size: 1rem;
  color: var(--sl-color-primary-600);
  flex-shrink: 0;
}

.model-name {
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
</style>
