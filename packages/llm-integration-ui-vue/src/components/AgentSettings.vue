<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useLlmStore } from "../stores/llm";
import { useChatStore } from "@piddie/chat-management-ui-vue";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/switch/switch.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/textarea/textarea.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";
import "@shoelace-style/shoelace/dist/components/divider/divider.js";

interface AgentConfig {
  enabled: boolean;
  maxRoundtrips: number;
  autoContinue: boolean;
  customSystemPrompt?: string;
}

const llmStore = useLlmStore();
const chatStore = useChatStore();

// Component props
const props = defineProps<{
  embedded?: boolean;
}>();

// Local state
const showAdvancedSettings = ref(false);
const settings = ref<AgentConfig>({
  enabled: false,
  maxRoundtrips: 10,
  autoContinue: true,
  customSystemPrompt: undefined
});

// Computed properties
const currentChatId = computed(() => chatStore.currentChat?.id);

// Load initial settings
onMounted(async () => {
  if (currentChatId.value) {
    try {
      const storedSettings = await llmStore.getAgentSettings(
        currentChatId.value
      );
      if (storedSettings) {
        settings.value = storedSettings;
      }
    } catch (error) {
      console.error("Error loading agent settings:", error);
    }
  }
});

// Update settings through the store
async function updateSettings(updates: Partial<AgentConfig>) {
  if (!currentChatId.value) return;

  const newSettings = {
    ...settings.value,
    ...updates
  };

  try {
    await llmStore.configureAgent(currentChatId.value, newSettings);
    settings.value = newSettings;
  } catch (error) {
    console.error("Error updating agent settings:", error);
  }
}

// Reset to defaults
async function resetToDefaults() {
  if (!currentChatId.value) return;

  const defaults: AgentConfig = {
    enabled: false,
    maxRoundtrips: 10,
    autoContinue: true,
    customSystemPrompt: undefined
  };

  try {
    await llmStore.configureAgent(currentChatId.value, defaults);
    settings.value = defaults;
  } catch (error) {
    console.error("Error resetting agent settings:", error);
  }
}
</script>

<template>
  <div class="agent-settings" :class="{ embedded: props.embedded }">
    <sl-card v-if="!props.embedded" class="settings-card">
      <div slot="header" class="card-header">
        <h3>Agent Settings</h3>
      </div>

      <div class="settings-content">
        <!-- Enable/Disable Agent -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">
              <span>Enable Agent</span>
              <sl-tooltip
                content="When enabled, the AI can execute multiple tool calls in succession without user interaction"
              >
                <sl-icon name="info-circle"></sl-icon>
              </sl-tooltip>
            </div>
            <div class="setting-description">
              Allow the AI to autonomously execute tool calls based on previous
              results
            </div>
          </div>
          <div class="setting-control">
            <sl-switch
              :checked="settings.enabled"
              @sl-change="updateSettings({ enabled: $event.target.checked })"
              :disabled="!currentChatId"
            ></sl-switch>
          </div>
        </div>

        <!-- Advanced Settings Toggle -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">
              <span>Advanced Settings</span>
            </div>
          </div>
          <div class="setting-control">
            <sl-switch
              :checked="showAdvancedSettings"
              @sl-change="showAdvancedSettings = $event.target.checked"
            ></sl-switch>
          </div>
        </div>

        <!-- Advanced Settings Section -->
        <div v-if="showAdvancedSettings" class="advanced-settings">
          <sl-divider></sl-divider>

          <!-- Maximum Roundtrips -->
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">
                <span>Maximum Roundtrips</span>
                <sl-tooltip
                  content="The maximum number of consecutive tool calls the agent can make"
                >
                  <sl-icon name="info-circle"></sl-icon>
                </sl-tooltip>
              </div>
              <div class="setting-description">
                Limits how many automated actions the agent can take
              </div>
            </div>
            <div class="setting-control">
              <sl-input
                type="number"
                min="1"
                max="50"
                :value="settings.maxRoundtrips"
                @sl-input="
                  updateSettings({
                    maxRoundtrips: parseInt($event.target.value)
                  })
                "
                :disabled="!settings.enabled"
              ></sl-input>
            </div>
          </div>

          <!-- Auto Continue -->
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">
                <span>Auto Continue</span>
                <sl-tooltip
                  content="Automatically continue the conversation after tool calls"
                >
                  <sl-icon name="info-circle"></sl-icon>
                </sl-tooltip>
              </div>
              <div class="setting-description">
                Continue the AI conversation automatically after tools are
                executed
              </div>
            </div>
            <div class="setting-control">
              <sl-switch
                :checked="settings.autoContinue"
                @sl-change="
                  updateSettings({ autoContinue: $event.target.checked })
                "
                :disabled="!settings.enabled"
              ></sl-switch>
            </div>
          </div>

          <!-- Custom System Prompt -->
          <div class="setting-row custom-prompt-row">
            <div class="setting-info">
              <div class="setting-label">
                <span>Custom System Prompt</span>
                <sl-tooltip
                  content="Custom instructions to guide the agent's behavior"
                >
                  <sl-icon name="info-circle"></sl-icon>
                </sl-tooltip>
              </div>
              <div class="setting-description">
                Special instructions for how the agent should behave (optional)
              </div>
            </div>
            <div class="setting-control full-width">
              <sl-textarea
                rows="4"
                :value="settings.customSystemPrompt"
                @sl-input="
                  updateSettings({ customSystemPrompt: $event.target.value })
                "
                placeholder="Enter custom instructions for the agent..."
                :disabled="!settings.enabled"
              ></sl-textarea>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="action-buttons">
            <sl-button
              variant="neutral"
              @click="resetToDefaults"
              :disabled="!currentChatId"
            >
              Reset to Defaults
            </sl-button>
          </div>
        </div>
      </div>
    </sl-card>

    <div v-else class="embedded-content">
      <!-- Same content as above but for embedded view -->
      <!-- Enable/Disable Agent -->
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">
            <span>Enable Agent</span>
            <sl-tooltip
              content="When enabled, the AI can execute multiple tool calls in succession without user interaction"
            >
              <sl-icon name="info-circle"></sl-icon>
            </sl-tooltip>
          </div>
          <div class="setting-description">
            Allow the AI to autonomously execute tool calls based on previous
            results
          </div>
        </div>
        <div class="setting-control">
          <sl-switch
            :checked="settings.enabled"
            @sl-change="updateSettings({ enabled: $event.target.checked })"
            :disabled="!currentChatId"
          ></sl-switch>
        </div>
      </div>

      <!-- Advanced Settings Toggle -->
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">
            <span>Advanced Settings</span>
          </div>
        </div>
        <div class="setting-control">
          <sl-switch
            :checked="showAdvancedSettings"
            @sl-change="showAdvancedSettings = $event.target.checked"
          ></sl-switch>
        </div>
      </div>

      <!-- Advanced Settings Section -->
      <div v-if="showAdvancedSettings" class="advanced-settings">
        <sl-divider></sl-divider>

        <!-- Same advanced settings as above -->
        <!-- Maximum Roundtrips -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">
              <span>Maximum Roundtrips</span>
              <sl-tooltip
                content="The maximum number of consecutive tool calls the agent can make"
              >
                <sl-icon name="info-circle"></sl-icon>
              </sl-tooltip>
            </div>
            <div class="setting-description">
              Limits how many automated actions the agent can take
            </div>
          </div>
          <div class="setting-control">
            <sl-input
              type="number"
              min="1"
              max="50"
              :value="settings.maxRoundtrips"
              @sl-input="
                updateSettings({ maxRoundtrips: parseInt($event.target.value) })
              "
              :disabled="!settings.enabled"
            ></sl-input>
          </div>
        </div>

        <!-- Auto Continue -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">
              <span>Auto Continue</span>
              <sl-tooltip
                content="Automatically continue the conversation after tool calls"
              >
                <sl-icon name="info-circle"></sl-icon>
              </sl-tooltip>
            </div>
            <div class="setting-description">
              Continue the AI conversation automatically after tools are
              executed
            </div>
          </div>
          <div class="setting-control">
            <sl-switch
              :checked="settings.autoContinue"
              @sl-change="
                updateSettings({ autoContinue: $event.target.checked })
              "
              :disabled="!settings.enabled"
            ></sl-switch>
          </div>
        </div>

        <!-- Custom System Prompt -->
        <div class="setting-row custom-prompt-row">
          <div class="setting-info">
            <div class="setting-label">
              <span>Custom System Prompt</span>
              <sl-tooltip
                content="Custom instructions to guide the agent's behavior"
              >
                <sl-icon name="info-circle"></sl-icon>
              </sl-tooltip>
            </div>
            <div class="setting-description">
              Special instructions for how the agent should behave (optional)
            </div>
          </div>
          <div class="setting-control full-width">
            <sl-textarea
              rows="4"
              :value="settings.customSystemPrompt"
              @sl-input="
                updateSettings({ customSystemPrompt: $event.target.value })
              "
              placeholder="Enter custom instructions for the agent..."
              :disabled="!settings.enabled"
            ></sl-textarea>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="action-buttons">
          <sl-button
            variant="neutral"
            @click="resetToDefaults"
            :disabled="!currentChatId"
          >
            Reset to Defaults
          </sl-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-settings {
  width: 100%;
}

.settings-card {
  margin-bottom: 1rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  font-size: 1.2rem;
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
  width: 100%;
}

.setting-info {
  flex: 1;
}

.setting-label {
  display: flex;
  align-items: center;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.setting-label sl-icon {
  margin-left: 0.5rem;
  font-size: 0.9rem;
  color: var(--sl-color-neutral-500);
}

.setting-description {
  font-size: 0.85rem;
  color: var(--sl-color-neutral-600);
}

.setting-control {
  display: flex;
  align-items: center;
  min-width: 80px;
  justify-content: flex-end;
}

.advanced-settings {
  margin-top: 1rem;
  padding-top: 0.5rem;
}

.custom-prompt-row {
  flex-direction: column;
}

.full-width {
  width: 100%;
  margin-top: 0.5rem;
}

.action-buttons {
  display: flex;
  justify-content: space-between;
  margin-top: 1.5rem;
}

.embedded .settings-content {
  padding: 0;
}

sl-alert {
  margin-top: 1rem;
}
</style>
