import Dexie from "dexie";

/**
 * Interface for LLM provider configuration
 */
export interface LlmProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  selectedModel?: string;
  provider?: "openai" | "mock";
  availableModels?: ModelInfo[];
}

/**
 * Interface for model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  created?: number;
}

/**
 * Interface for individual workbench setting
 */
export interface WorkbenchSetting {
  key: WorkbenchSettingKey;
  value: unknown;
  lastUpdated: Date;
}

/**
 * Enum for workbench setting keys
 */
export enum WorkbenchSettingKey {
  FILE_EXPLORER_WIDTH = "fileExplorerWidth",
  CHAT_PANEL_WIDTH = "chatPanelWidth",
  IS_FILE_EXPLORER_COLLAPSED = "isFileExplorerCollapsed",
  IS_CHAT_PANEL_COLLAPSED = "isChatPanelCollapsed",
  SELECTED_PROVIDER = "selectedProvider"
}

// Keep these for migration purposes
export enum LayoutSettingKey {
  FILE_EXPLORER_WIDTH = "fileExplorerWidth",
  CHAT_PANEL_WIDTH = "chatPanelWidth",
  IS_FILE_EXPLORER_COLLAPSED = "isFileExplorerCollapsed",
  IS_CHAT_PANEL_COLLAPSED = "isChatPanelCollapsed"
}

export interface LayoutSetting {
  key: LayoutSettingKey;
  value: unknown;
  lastUpdated: Date;
}

/**
 * Database schema for application settings
 */
export class SettingsDatabase extends Dexie {
  llmConfig!: Dexie.Table<LlmProviderConfig, string>;
  workbench!: Dexie.Table<WorkbenchSetting, WorkbenchSettingKey>;
  layout!: Dexie.Table<LayoutSetting, LayoutSettingKey>; // Keep for migration

  constructor() {
    super("piddie-settings");

    this.version(6).stores({
      llmConfig: "provider",
      layout: "key, lastUpdated"
    });

    this.version(7)
      .stores({
        llmConfig: "provider",
        workbench: "key, lastUpdated",
        layout: null // Mark for deletion after migration
      })
      .upgrade(async (tx) => {
        console.log("Migrating from layout to workbench table");

        // Get all layout settings
        const layoutSettings = await tx.table("layout").toArray();

        // Convert layout settings to workbench settings
        const workbenchSettings = layoutSettings.map((setting) => {
          // Map old keys to new keys
          let newKey: WorkbenchSettingKey;

          switch (setting.key) {
            case LayoutSettingKey.FILE_EXPLORER_WIDTH:
              newKey = WorkbenchSettingKey.FILE_EXPLORER_WIDTH;
              break;
            case LayoutSettingKey.CHAT_PANEL_WIDTH:
              newKey = WorkbenchSettingKey.CHAT_PANEL_WIDTH;
              break;
            case LayoutSettingKey.IS_FILE_EXPLORER_COLLAPSED:
              newKey = WorkbenchSettingKey.IS_FILE_EXPLORER_COLLAPSED;
              break;
            case LayoutSettingKey.IS_CHAT_PANEL_COLLAPSED:
              newKey = WorkbenchSettingKey.IS_CHAT_PANEL_COLLAPSED;
              break;
            default:
              newKey = setting.key as unknown as WorkbenchSettingKey;
          }

          return {
            key: newKey,
            value: setting.value,
            lastUpdated: setting.lastUpdated
          };
        });

        // Add default selected provider if it doesn't exist
        const hasSelectedProvider = workbenchSettings.some(
          (setting) => setting.key === WorkbenchSettingKey.SELECTED_PROVIDER
        );

        if (!hasSelectedProvider) {
          workbenchSettings.push({
            key: WorkbenchSettingKey.SELECTED_PROVIDER,
            value: "openai",
            lastUpdated: new Date()
          });
        }

        // Add workbench settings to the new table
        await tx.table("workbench").bulkAdd(workbenchSettings);

        console.log("Migration complete");
      });
  }
}

/**
 * Default LLM configuration
 */
export const DEFAULT_LLM_CONFIG: LlmProviderConfig = {
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || "",
  baseUrl: import.meta.env.VITE_OPENAI_BASE_URL || "https://api.openai.com/v1",
  defaultModel: import.meta.env.VITE_OPENAI_MODEL || "gpt-3.5-turbo",
  selectedModel: import.meta.env.VITE_OPENAI_MODEL || "gpt-3.5-turbo",
  provider: "openai",
  availableModels: []
};

/**
 * Default layout settings
 */
export const DEFAULT_LAYOUT_SETTINGS = {
  [LayoutSettingKey.FILE_EXPLORER_WIDTH]: 250,
  [LayoutSettingKey.CHAT_PANEL_WIDTH]: 300,
  [LayoutSettingKey.IS_FILE_EXPLORER_COLLAPSED]: false,
  [LayoutSettingKey.IS_CHAT_PANEL_COLLAPSED]: false
};

/**
 * Default workbench settings
 */
export const DEFAULT_WORKBENCH_SETTINGS = {
  [WorkbenchSettingKey.FILE_EXPLORER_WIDTH]: 250,
  [WorkbenchSettingKey.CHAT_PANEL_WIDTH]: 300,
  [WorkbenchSettingKey.IS_FILE_EXPLORER_COLLAPSED]: false,
  [WorkbenchSettingKey.IS_CHAT_PANEL_COLLAPSED]: false,
  [WorkbenchSettingKey.SELECTED_PROVIDER]: "openai"
};

/**
 * Settings manager for the application
 */
export class SettingsManager {
  private db: SettingsDatabase;

  constructor(db?: SettingsDatabase) {
    this.db = db || new SettingsDatabase();
  }

  /**
   * Gets the LLM configuration
   * @returns The LLM configuration
   */
  async getLlmConfig(): Promise<LlmProviderConfig> {
    let config = await this.db.llmConfig.get({ provider: "openai" });

    if (!config) {
      // Create default LLM config if it doesn't exist
      config = { ...DEFAULT_LLM_CONFIG };
      await this.db.llmConfig.add(config);
    }

    return config;
  }

  /**
   * Gets a specific workbench setting
   * @param key The setting key to retrieve
   * @returns The workbench setting value
   */
  async getWorkbenchSetting(key: WorkbenchSettingKey): Promise<unknown> {
    console.log(`Getting workbench setting for key: ${key}`);

    // Try to find the setting
    const setting = await this.db.workbench.get(key);

    // If setting doesn't exist, create and return default
    if (!setting) {
      console.log(`No setting found for ${key}. Using default.`);
      const defaultValue = DEFAULT_WORKBENCH_SETTINGS[key];

      // Add the default setting to the database
      const defaultSetting: WorkbenchSetting = {
        key,
        value: defaultValue,
        lastUpdated: new Date()
      };

      await this.db.workbench.add(defaultSetting);

      return defaultValue;
    }

    console.log(`Retrieved setting for ${key}:`, setting.value);
    return setting.value;
  }

  /**
   * Updates a specific workbench setting
   * @param key The setting key to update
   * @param value The new value for the setting
   */
  async updateWorkbenchSetting(
    key: WorkbenchSettingKey,
    value: unknown
  ): Promise<void> {
    console.log(`Updating workbench setting for key: ${key}`, value);

    // Create the setting object with the key
    const setting: WorkbenchSetting = {
      key,
      value,
      lastUpdated: new Date()
    };

    // Update or add the setting
    await this.db.workbench.put(setting);
  }

  /**
   * Gets all workbench settings
   * @returns An object with all workbench settings
   */
  async getWorkbenchSettings(): Promise<Record<WorkbenchSettingKey, unknown>> {
    const settings: Partial<Record<WorkbenchSettingKey, unknown>> = {};

    for (const key of Object.values(WorkbenchSettingKey)) {
      settings[key] = await this.getWorkbenchSetting(key);
    }

    return settings as Record<WorkbenchSettingKey, unknown>;
  }

  /**
   * Updates multiple workbench settings
   * @param settings Partial workbench settings to update
   */
  async updateWorkbenchSettings(
    settings: Partial<Record<WorkbenchSettingKey, unknown>>
  ): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.updateWorkbenchSetting(key as WorkbenchSettingKey, value);
    }
  }

  /**
   * Gets the selected provider from workbench settings
   * @returns The selected provider
   */
  async getSelectedProvider(): Promise<"openai" | "mock"> {
    return this.getWorkbenchSetting(
      WorkbenchSettingKey.SELECTED_PROVIDER
    ) as Promise<"openai" | "mock">;
  }

  /**
   * Updates the selected provider in workbench settings
   * @param provider The provider to select
   */
  async updateSelectedProvider(provider: "openai" | "mock"): Promise<void> {
    await this.updateWorkbenchSetting(
      WorkbenchSettingKey.SELECTED_PROVIDER,
      provider
    );
  }

  /**
   * Updates the LLM configuration
   * @param config The new LLM configuration
   */
  async updateLlmConfig(
    config: Partial<LlmProviderConfig>
  ): Promise<LlmProviderConfig> {
    const existingConfig = await this.getLlmConfig();

    // Update the configuration
    const updatedConfig = {
      ...existingConfig,
      ...config
    };

    // Update or add the configuration
    await this.db.llmConfig.put(updatedConfig);

    return updatedConfig;
  }

  /**
   * Resets the LLM configuration to defaults
   */
  async resetLlmConfig(): Promise<LlmProviderConfig> {
    await this.db.llmConfig.clear();
    return this.updateLlmConfig(DEFAULT_LLM_CONFIG);
  }

  /**
   * Verifies the connection to the OpenAI API and retrieves available models
   * @param config The LLM configuration to verify
   * @returns The list of available models if successful
   */
  async verifyConnection(config: LlmProviderConfig): Promise<ModelInfo[]> {
    try {
      console.log(
        "Settings manager verifying connection with URL:",
        config.baseUrl
      );

      // Make a request to the OpenAI models endpoint
      const url = `${config.baseUrl}/models`;
      console.log("Making request to:", url);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to connect to API: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
        );
      }

      const data = await response.json();
      console.log("Received models data:", data);

      // Extract model information
      const models: ModelInfo[] = data.data
        .map((model: unknown) => ({
          id: (model as ModelInfo).id,
          name: (model as ModelInfo).id
            .replace(/^gpt-/, "GPT ")
            .replace(/-/g, " "),
          created: (model as ModelInfo).created
        }))
        .sort((a: ModelInfo, b: ModelInfo) => {
          // Sort by creation date (newest first)
          if (a.created && b.created) {
            return b.created - a.created;
          }
          return a.id.localeCompare(b.id);
        });

      console.log("Filtered and processed models:", models);

      // Update the configuration with the available models
      await this.updateLlmConfig({
        availableModels: models
      });

      return models;
    } catch (error) {
      console.error("Error verifying connection:", error);
      throw error;
    }
  }
}

// Create a singleton instance of the settings manager
const settingsManager = new SettingsManager();
export default settingsManager;
