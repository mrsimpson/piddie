<script setup lang="ts">
import { ref, onMounted, computed, watch, defineProps } from "vue";
import { useLlmStore } from "../stores/llm";
import { CollapsiblePanel } from "@piddie/common-ui-vue";
import { LlmProviderFactory } from "@piddie/llm-integration";
import type { ProviderType } from "@piddie/shared-types";
import type { LlmProviderConfig } from "@piddie/settings";

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
const provider = ref<ProviderType>("litellm");
const isSaved = ref(false);
const showApiKey = ref(false);
const isSaving = ref(false);
const verificationMessage = ref("");

// Computed properties
const currentAdapter = computed(() => {
  return LlmProviderFactory.getAdapter(provider.value);
});

const isApiKeySet = computed(() => !!apiKey.value);
const hasAvailableModels = computed(() => llmStore.availableModels.length > 0);
const availableModels = computed(() => {
  // For mock provider, always use the default models from the adapter
  if (provider.value === "mock") {
    return LlmProviderFactory.getAdapter("mock").getDefaultModels();
  }

  // For other providers, use models from the store if available
  if (hasAvailableModels.value) {
    return [...llmStore.availableModels];
  }

  // If no models are available from the API, use defaults from the adapter
  return currentAdapter.value.getDefaultModels();
});

const requiresApiKey = computed(() => {
  return currentAdapter.value.requiresApiKey();
});

const baseUrlHelpText = computed(() => {
  return currentAdapter.value.getBaseUrlHelpText();
});

const defaultBaseUrl = computed(() => {
  return currentAdapter.value.getDefaultBaseUrl();
});

const providerOptions = computed(() => {
  return LlmProviderFactory.getProviderTypes().map((type) => ({
    value: type,
    label: LlmProviderFactory.getProviderDisplayName(type)
  }));
});

// Watch for changes in the store config
watch(
  () => llmStore.config,
  (newConfig) => {
    apiKey.value = newConfig.apiKey;
    baseUrl.value = newConfig.baseUrl;
    provider.value = newConfig.provider || "litellm";
    model.value = newConfig.selectedModel || newConfig.defaultModel;
  },
  { deep: true }
);

// Watch for provider changes to update model selection and base URL
watch(
  () => provider.value,
  async (newProvider) => {
    const adapter = LlmProviderFactory.getAdapter(newProvider);

    // Load the stored config for this provider from the database
    const storedConfig = await llmStore.getStoredProviderConfig(newProvider);

    // Preserve the current API key when switching providers
    const currentApiKey = apiKey.value;

    // Update base URL to the stored value or default
    baseUrl.value = storedConfig?.baseUrl || adapter.getDefaultBaseUrl();

    // Update model to the stored value or default
    model.value =
      storedConfig?.selectedModel ||
      storedConfig?.defaultModel ||
      adapter.getDefaultModel();

    // Save the updated configuration to the store
    await llmStore.updateConfig({
      provider: newProvider,
      baseUrl: baseUrl.value,
      selectedModel: model.value,
      defaultModel: model.value,
      apiKey: currentApiKey // Preserve the API key
    });

    // Automatically verify connection when switching providers to load available models
    // Skip verification if API key is required but not set (except for mock provider)
    if (
      newProvider === "mock" ||
      !adapter.requiresApiKey() ||
      (adapter.requiresApiKey() && currentApiKey)
    ) {
      verifyConnection();
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
onMounted(async () => {
  await llmStore.initializeStore();
  apiKey.value = llmStore.config.apiKey;
  baseUrl.value = llmStore.config.baseUrl;
  provider.value = llmStore.config.provider || "litellm";

  // Get the selected model for the current provider
  model.value = llmStore.config.selectedModel || llmStore.config.defaultModel;
});

// Function to save settings
async function saveSettings() {
  isSaving.value = true;

  try {
    // Log the configuration being saved
    console.log("Saving LLM settings:", {
      apiKey: apiKey.value ? `${apiKey.value.substring(0, 5)}...` : "none",
      baseUrl: baseUrl.value,
      defaultModel: model.value,
      selectedModel: model.value,
      provider: provider.value
    });

    // Save the settings to the store
    await llmStore.updateConfig({
      apiKey: apiKey.value,
      baseUrl: baseUrl.value,
      defaultModel: model.value,
      selectedModel: model.value,
      provider: provider.value
    });

    // After saving, verify the connection if provider is not mock and API key is set
    if (provider.value !== "mock" && apiKey.value) {
      await verifyConnection();
    }

    // Show saved message
    isSaved.value = true;
    setTimeout(() => {
      isSaved.value = false;
    }, 3000);
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

    // For mock provider, update the models through the store
    const mockAdapter = LlmProviderFactory.getAdapter("mock");
    const mockModels = mockAdapter.getDefaultModels();

    // Update the store with the mock models
    await llmStore.updateConfig({
      availableModels: mockModels,
      provider: provider.value,
      baseUrl: baseUrl.value,
      selectedModel: model.value,
      defaultModel: model.value,
      apiKey: apiKey.value // Include the API key
    });

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
      provider: provider.value
    });

    // Now verify with the saved config
    await llmStore.verifyConnection();

    // After verification, ensure the model is still set correctly
    if (llmStore.availableModels.length > 0) {
      // Find if the current model exists in the available models
      const modelExists = llmStore.availableModels.some(
        (m) => m.id === model.value
      );

      // If not, select the first available model
      if (!modelExists) {
        model.value = llmStore.availableModels[0].id;

        // Update the store with the new model
        await llmStore.updateConfig({
          selectedModel: model.value,
          defaultModel: model.value,
          apiKey: apiKey.value // Include the API key
        });
      }
    }
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
        <div v-if="requiresApiKey && !isApiKeySet" class="api-key-warning">
          <p>
            ⚠️ API key not set. Chat functionality will not work without an API
            key.
          </p>
        </div>

        <div class="form-group">
          <label for="provider">Provider</label>
          <select id="provider" v-model="provider">
            <option
              v-for="option in providerOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <p class="help-text">
            {{ currentAdapter.getDescription() }}
          </p>
        </div>

        <div class="form-group" v-if="requiresApiKey">
          <label for="api-key">API Key</label>
          <div class="api-key-input">
            <input
              :type="showApiKey ? 'text' : 'password'"
              id="api-key"
              v-model="apiKey"
              :placeholder="currentAdapter.getApiKeyPlaceholder()"
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

        <div class="form-group" v-if="provider !== 'mock'">
          <label for="base-url">API Base URL</label>
          <input
            type="text"
            id="base-url"
            v-model="baseUrl"
            :placeholder="defaultBaseUrl"
          />
          <p class="help-text">
            {{ baseUrlHelpText }}
          </p>
        </div>

        <div class="verify-connection">
          <button
            type="button"
            class="verify-button"
            @click="verifyConnection"
            :disabled="
              (requiresApiKey && !apiKey) ||
              llmStore.isVerifying ||
              isSaving ||
              provider === 'mock'
            "
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
          <p class="help-text" v-if="hasAvailableModels && provider !== 'mock'">
            Models retrieved from API.
            <span class="refresh-link" @click="verifyConnection">Refresh</span>
          </p>
          <p class="help-text" v-else-if="provider !== 'mock'">
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
      <div v-if="requiresApiKey && !isApiKeySet" class="api-key-warning">
        <p>
          ⚠️ API key not set. Chat functionality will not work without an API
          key.
        </p>
      </div>

      <div class="form-group">
        <label for="provider-embedded">Provider</label>
        <select id="provider-embedded" v-model="provider">
          <option
            v-for="option in providerOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </div>

      <div class="form-group" v-if="requiresApiKey">
        <label for="api-key-embedded">API Key</label>
        <div class="api-key-input">
          <input
            :type="showApiKey ? 'text' : 'password'"
            id="api-key-embedded"
            v-model="apiKey"
            :placeholder="currentAdapter.getApiKeyPlaceholder()"
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

      <div class="form-group" v-if="provider !== 'mock'">
        <label for="base-url-embedded">API Base URL</label>
        <input
          type="text"
          id="base-url-embedded"
          v-model="baseUrl"
          :placeholder="defaultBaseUrl"
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
        <div class="verify-connection">
          <button
            type="button"
            class="verify-button"
            @click="verifyConnection"
            :disabled="
              (requiresApiKey && !apiKey) ||
              llmStore.isVerifying ||
              isSaving ||
              provider === 'mock'
            "
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
