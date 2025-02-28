<script setup lang="ts">
import { ref, onMounted, computed, watch, defineProps } from "vue";
import { useLlmStore } from "../stores/llm";
import CollapsiblePanel from "./ui/CollapsiblePanel.vue";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/select/select.js";
import "@shoelace-style/shoelace/dist/components/option/option.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";

const props = defineProps({
  embedded: {
    type: Boolean,
    default: false
  }
});

const llmStore = useLlmStore();

// Form state
const apiKey = ref("");
const baseUrl = ref("");
const model = ref("");
const provider = ref<"openai" | "mock">("openai");
const isSaved = ref(false);
const showApiKey = ref(false);
const isSaving = ref(false);
const verificationMessage = ref("");

// Default values from environment variables
const defaultBaseUrl =
  import.meta.env.VITE_OPENAI_BASE_URL || "https://api.openai.com/v1";
const defaultModel = import.meta.env.VITE_OPENAI_MODEL || "gpt-3.5-turbo";

// Computed properties
const isApiKeySet = computed(() => !!apiKey.value);
const hasAvailableModels = computed(() => llmStore.availableModels.length > 0);
const availableModels = computed(() => {
  // Always include the mock model
  const mockModel = { id: "mock-model", name: "Mock Model (Development)" };

  if (provider.value === "mock") {
    return [mockModel];
  }

  if (hasAvailableModels.value) {
    return [...llmStore.availableModels];
  }

  // Fallback to default models if none are available from the API
  return [
    { id: "gpt-3.5-turbo", name: "GPT 3.5 Turbo" },
    { id: "gpt-4", name: "GPT 4" },
    { id: "gpt-4-turbo", name: "GPT 4 Turbo" }
  ];
});

// Watch for changes in the store config
watch(
  () => llmStore.config,
  (newConfig) => {
    apiKey.value = newConfig.apiKey;
    baseUrl.value = newConfig.baseUrl;
    provider.value = newConfig.provider || "openai";
    model.value = newConfig.selectedModel || newConfig.defaultModel;
  },
  { deep: true }
);

// Watch for provider changes to update model selection
watch(
  () => provider.value,
  (newProvider) => {
    if (newProvider === "mock") {
      // Use the previously selected mock model or default to "mock-model"
      model.value = "mock-model";
    } else if (model.value === "mock-model") {
      // If switching from mock to openai, use the previously selected OpenAI model
      model.value = "gpt-3.5-turbo";
    }
  }
);

// Watch for connection status changes
watch(
  () => llmStore.connectionStatus,
  (status) => {
    if (status === "success") {
      verificationMessage.value = "Connection successful! Models retrieved.";
    } else if (status === "error") {
      verificationMessage.value = llmStore.error
        ? llmStore.error.message
        : "Connection failed. Please check your settings.";
    } else {
      verificationMessage.value = "";
    }
  }
);

// Load settings from store on mount
onMounted(() => {
  apiKey.value = llmStore.config.apiKey;
  baseUrl.value = llmStore.config.baseUrl;
  provider.value = llmStore.config.provider || "openai";

  // Get the selected model for the current provider
  model.value = llmStore.config.selectedModel || llmStore.config.defaultModel;
});

// Save settings to store
async function saveSettings() {
  isSaving.value = true;

  try {
    const success = await llmStore.updateConfig({
      apiKey: apiKey.value,
      baseUrl: baseUrl.value,
      defaultModel: model.value,
      selectedModel: model.value,
      provider: provider.value
    });

    if (success) {
      isSaved.value = true;
      setTimeout(() => {
        isSaved.value = false;
      }, 3000);
    }
  } catch (error) {
    console.error("Error saving settings:", error);
  } finally {
    isSaving.value = false;
  }
}

// Verify connection and retrieve models
async function verifyConnection() {
  // Skip verification for mock provider
  if (provider.value === "mock") {
    verificationMessage.value = "Mock provider is always available.";
    return;
  }

  verificationMessage.value = "";

  try {
    // First save the current settings to ensure consistency
    isSaving.value = true;

    // Update the store with current form values
    await llmStore.updateConfig({
      apiKey: apiKey.value,
      baseUrl: baseUrl.value,
      defaultModel: model.value,
      selectedModel: model.value,
      provider: provider.value // This will be saved to workbench settings
    });

    // Now verify with the saved config
    await llmStore.verifyConnection();
  } catch (error) {
    console.error("Error during verification:", error);
    verificationMessage.value =
      error instanceof Error ? error.message : "An unknown error occurred";
  } finally {
    isSaving.value = false;
  }
}

// Toggle API key visibility
function toggleApiKeyVisibility() {
  showApiKey.value = !showApiKey.value;
}

// Reset to defaults
async function resetToDefaults() {
  isSaving.value = true;

  try {
    const success = await llmStore.resetConfig();

    if (success) {
      // The config in the store will be updated, and our watch will update the form
      isSaved.value = true;
      setTimeout(() => {
        isSaved.value = false;
      }, 3000);
    }
  } catch (error) {
    console.error("Error resetting settings:", error);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <!-- Use CollapsiblePanel when not embedded -->
  <CollapsiblePanel
    v-if="!embedded"
    title="LLM Settings"
    icon="gear"
    :expanded="false"
  >
    <template #content>
      <div v-if="llmStore.isLoading" class="loading-state">
        <sl-spinner></sl-spinner>
        <p>Loading settings...</p>
      </div>

      <div v-else class="settings-form">
        <div
          v-if="!isApiKeySet && provider === 'openai'"
          class="api-key-warning"
        >
          <p>
            ⚠️ API key not set. Chat functionality will not work without an API
            key.
          </p>
        </div>

        <div class="form-group">
          <label for="provider">Provider</label>
          <select id="provider" v-model="provider">
            <option value="openai">OpenAI</option>
            <option value="mock">Mock (Development)</option>
          </select>
          <p class="help-text">
            Select the LLM provider to use. Mock provider is for development and
            testing.
          </p>
        </div>

        <div class="form-group" v-if="provider === 'openai'">
          <label for="api-key">OpenAI API Key</label>
          <div class="api-key-input">
            <input
              :type="showApiKey ? 'text' : 'password'"
              id="api-key"
              v-model="apiKey"
              placeholder="Enter your OpenAI API key"
            />
            <button
              type="button"
              class="toggle-visibility"
              @click="toggleApiKeyVisibility"
            >
              {{ showApiKey ? "Hide" : "Show" }}
            </button>
          </div>
          <p class="help-text">
            Your API key is stored securely in your browser's database.
          </p>
        </div>

        <div class="form-group" v-if="provider === 'openai'">
          <label for="base-url">API Base URL</label>
          <input
            type="text"
            id="base-url"
            v-model="baseUrl"
            placeholder="https://api.openai.com/v1"
          />
          <p class="help-text">
            Change this if you're using a proxy or alternative endpoint.
          </p>
        </div>

        <div class="verify-connection" v-if="provider === 'openai'">
          <button
            type="button"
            class="verify-button"
            @click="verifyConnection"
            :disabled="!apiKey || llmStore.isVerifying || isSaving"
          >
            <span v-if="llmStore.isVerifying || isSaving">
              <sl-spinner class="verify-spinner"></sl-spinner>
              {{ isSaving ? "Saving settings..." : "Verifying connection..." }}
            </span>
            <span v-else>
              <sl-icon name="check-circle"></sl-icon>
              Verify Connection
            </span>
          </button>

          <div
            v-if="verificationMessage || llmStore.isVerifying"
            class="verification-message"
            :class="{
              success: llmStore.connectionStatus === 'success',
              error: llmStore.connectionStatus === 'error',
              info:
                llmStore.connectionStatus === 'none' &&
                (llmStore.isVerifying || isSaving)
            }"
          >
            <span v-if="llmStore.isVerifying && !verificationMessage">
              Connecting to {{ baseUrl }}...
            </span>
            <span v-else-if="isSaving && !verificationMessage">
              Saving settings before verification...
            </span>
            <span v-else>
              {{ verificationMessage }}
            </span>
          </div>
        </div>

        <div class="form-group">
          <label for="model">Model</label>
          <select id="model" v-model="model">
            <option
              v-for="modelOption in availableModels"
              :key="modelOption.id"
              :value="modelOption.id"
            >
              {{ modelOption.name }}
            </option>
          </select>
          <p
            class="help-text"
            v-if="provider === 'openai' && hasAvailableModels"
          >
            Models retrieved from OpenAI API.
            <span class="refresh-link" @click="verifyConnection">Refresh</span>
          </p>
          <p class="help-text" v-else-if="provider === 'openai'">
            Default models shown. Verify connection to retrieve available
            models.
          </p>
          <p class="help-text" v-else>
            Mock model for development and testing.
          </p>
        </div>

        <div class="form-actions">
          <button
            type="button"
            class="reset-button"
            @click="resetToDefaults"
            :disabled="isSaving"
          >
            Reset to Defaults
          </button>

          <button
            type="button"
            class="save-button"
            @click="saveSettings"
            :disabled="isSaving"
          >
            {{ isSaving ? "Saving..." : "Save Settings" }}
          </button>
        </div>

        <div v-if="isSaved" class="save-confirmation">
          Settings saved successfully!
        </div>
      </div>
    </template>
  </CollapsiblePanel>

  <!-- Direct content when embedded -->
  <div v-else>
    <div v-if="llmStore.isLoading" class="loading-state">
      <sl-spinner></sl-spinner>
      <p>Loading settings...</p>
    </div>

    <div v-else class="settings-form embedded">
      <div v-if="!isApiKeySet && provider === 'openai'" class="api-key-warning">
        <p>
          ⚠️ API key not set. Chat functionality will not work without an API
          key.
        </p>
      </div>

      <div class="form-group">
        <label for="provider-embedded">Provider</label>
        <select id="provider-embedded" v-model="provider">
          <option value="openai">OpenAI</option>
          <option value="mock">Mock (Development)</option>
        </select>
      </div>

      <div class="form-group" v-if="provider === 'openai'">
        <label for="api-key-embedded">API Key</label>
        <div class="api-key-input">
          <input
            :type="showApiKey ? 'text' : 'password'"
            id="api-key-embedded"
            v-model="apiKey"
            placeholder="Enter your API key"
          />
          <button
            type="button"
            class="toggle-visibility"
            @click="toggleApiKeyVisibility"
          >
            {{ showApiKey ? "Hide" : "Show" }}
          </button>
        </div>
      </div>

      <div class="form-group" v-if="provider === 'openai'">
        <label for="base-url-embedded">API Base URL</label>
        <input
          type="text"
          id="base-url-embedded"
          v-model="baseUrl"
          placeholder="https://api.openai.com/v1"
        />
      </div>

      <div class="form-group">
        <label for="model-embedded">Model</label>
        <select id="model-embedded" v-model="model">
          <option
            v-for="modelOption in availableModels"
            :key="modelOption.id"
            :value="modelOption.id"
          >
            {{ modelOption.name }}
          </option>
        </select>
      </div>

      <div class="embedded-actions">
        <div class="verify-connection" v-if="provider === 'openai'">
          <button
            type="button"
            class="verify-button"
            @click="verifyConnection"
            :disabled="!apiKey || llmStore.isVerifying || isSaving"
          >
            <span v-if="llmStore.isVerifying || isSaving">
              <sl-spinner class="verify-spinner"></sl-spinner>
              {{ isSaving ? "Saving..." : "Verifying..." }}
            </span>
            <span v-else>
              <sl-icon name="check-circle"></sl-icon>
              Verify
            </span>
          </button>
        </div>

        <div class="form-actions">
          <button
            type="button"
            class="save-button"
            @click="saveSettings"
            :disabled="isSaving"
          >
            {{ isSaving ? "Saving..." : "Save" }}
          </button>
        </div>
      </div>

      <div
        v-if="verificationMessage || llmStore.isVerifying"
        class="verification-message"
        :class="{
          success: llmStore.connectionStatus === 'success',
          error: llmStore.connectionStatus === 'error',
          info:
            llmStore.connectionStatus === 'none' &&
            (llmStore.isVerifying || isSaving)
        }"
      >
        <span v-if="llmStore.isVerifying && !verificationMessage">
          Connecting to {{ baseUrl }}...
        </span>
        <span v-else-if="isSaving && !verificationMessage">
          Saving settings...
        </span>
        <span v-else>
          {{ verificationMessage }}
        </span>
      </div>

      <div v-if="isSaved" class="save-confirmation">
        Settings saved successfully!
      </div>
    </div>
  </div>
</template>

<style scoped>
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sl-spacing-large);
  color: var(--sl-color-neutral-500);
  gap: var(--sl-spacing-medium);
}

.settings-form {
  padding: var(--sl-spacing-medium);
}

.settings-form.embedded {
  padding: var(--sl-spacing-small);
  background-color: var(--sl-color-neutral-50);
  border-radius: var(--sl-border-radius-medium);
  border: 1px solid var(--sl-color-neutral-200);
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.api-key-warning {
  margin-bottom: var(--sl-spacing-medium);
  padding: var(--sl-spacing-small);
  background-color: var(--sl-color-warning-100);
  color: var(--sl-color-warning-700);
  border-radius: var(--sl-border-radius-medium);
}

.form-group {
  margin-bottom: var(--sl-spacing-medium);
}

.embedded .form-group {
  margin-bottom: var(--sl-spacing-small);
  width: 100%;
  box-sizing: border-box;
}

.verify-connection {
  margin-bottom: var(--sl-spacing-medium);
}

.embedded .verify-connection {
  margin-bottom: 0;
}

.verify-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: var(--sl-color-success-600);
  color: white;
  border: none;
  border-radius: var(--sl-border-radius-medium);
  font-weight: var(--sl-font-weight-semibold);
  cursor: pointer;
}

.verify-button:hover:not(:disabled) {
  background-color: var(--sl-color-success-700);
}

.verify-button:disabled {
  background-color: var(--sl-color-neutral-300);
  cursor: not-allowed;
}

.verify-spinner {
  font-size: 1rem;
}

.verification-message {
  margin-top: var(--sl-spacing-small);
  padding: var(--sl-spacing-small);
  border-radius: var(--sl-border-radius-medium);
  font-size: var(--sl-font-size-small);
}

.verification-message.success {
  background-color: var(--sl-color-success-100);
  color: var(--sl-color-success-700);
}

.verification-message.error {
  background-color: var(--sl-color-danger-100);
  color: var(--sl-color-danger-700);
}

.verification-message.info {
  background-color: var(--sl-color-info-100);
  color: var(--sl-color-info-700);
}

.refresh-link {
  color: var(--sl-color-primary-600);
  cursor: pointer;
  text-decoration: underline;
}

.refresh-link:hover {
  color: var(--sl-color-primary-700);
}

label {
  display: block;
  margin-bottom: var(--sl-spacing-x-small);
  font-weight: var(--sl-font-weight-semibold);
}

.embedded label {
  font-size: var(--sl-font-size-small);
}

input,
select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--sl-color-neutral-300);
  border-radius: var(--sl-border-radius-medium);
  font-family: inherit;
  font-size: inherit;
  box-sizing: border-box;
}

.api-key-input {
  display: flex;
  gap: 0.5rem;
  width: 100%;
  box-sizing: border-box;
}

.api-key-input input {
  flex: 1;
  min-width: 0; /* Allow input to shrink below content size */
}

.toggle-visibility {
  padding: 0.5rem;
  background-color: var(--sl-color-neutral-100);
  border: 1px solid var(--sl-color-neutral-300);
  border-radius: var(--sl-border-radius-medium);
  cursor: pointer;
}

.help-text {
  margin-top: var(--sl-spacing-x-small);
  font-size: var(--sl-font-size-small);
  color: var(--sl-color-neutral-500);
}

.embedded-actions {
  display: flex;
  justify-content: space-between;
  gap: var(--sl-spacing-small);
  margin-bottom: var(--sl-spacing-small);
  width: 100%;
  box-sizing: border-box;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sl-spacing-small);
  margin-top: var(--sl-spacing-large);
}

.embedded .form-actions {
  margin-top: 0;
}

button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: var(--sl-border-radius-medium);
  font-weight: var(--sl-font-weight-semibold);
  cursor: pointer;
}

button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.save-button {
  background-color: var(--sl-color-primary-600);
  color: white;
}

.save-button:hover:not(:disabled) {
  background-color: var(--sl-color-primary-700);
}

.reset-button {
  background-color: var(--sl-color-neutral-200);
  color: var(--sl-color-neutral-700);
}

.reset-button:hover:not(:disabled) {
  background-color: var(--sl-color-neutral-300);
}

.save-confirmation {
  margin-top: var(--sl-spacing-medium);
  padding: var(--sl-spacing-small);
  background-color: var(--sl-color-success-100);
  color: var(--sl-color-success-700);
  border-radius: var(--sl-border-radius-medium);
  text-align: center;
}

.embedded .save-confirmation {
  margin-top: var(--sl-spacing-small);
  font-size: var(--sl-font-size-small);
}
</style>
