import Dexie from "dexie";

/**
 * Interface for LLM provider configuration
 */
export interface LlmProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
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
 * Interface for individual layout setting
 */
export interface LayoutSetting {
  key: LayoutSettingKey;
  value: any;
  lastUpdated: Date;
}

/**
 * Enum for layout setting keys
 */
export enum LayoutSettingKey {
  FILE_EXPLORER_WIDTH = "fileExplorerWidth",
  CHAT_PANEL_WIDTH = "chatPanelWidth",
  IS_FILE_EXPLORER_COLLAPSED = "isFileExplorerCollapsed",
  IS_CHAT_PANEL_COLLAPSED = "isChatPanelCollapsed"
}

/**
 * Database schema for application settings
 */
export class SettingsDatabase extends Dexie {
  llmConfig!: Dexie.Table<LlmProviderConfig, string>;
  layout!: Dexie.Table<LayoutSetting, LayoutSettingKey>;

  constructor() {
    super("piddie-settings");

    this.version(6).stores({
      llmConfig: "provider",
      layout: "key, lastUpdated"
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
   * Gets a specific layout setting
   * @param key The setting key to retrieve
   * @returns The layout setting value
   */
  async getLayoutSetting(key: LayoutSettingKey): Promise<any> {
    console.log(`Getting layout setting for key: ${key}`);

    // Try to find the setting
    const setting = await this.db.layout.get(key);

    // If setting doesn't exist, create and return default
    if (!setting) {
      console.log(`No setting found for ${key}. Using default.`);
      const defaultValue = DEFAULT_LAYOUT_SETTINGS[key];

      // Add the default setting to the database
      const defaultSetting: LayoutSetting = {
        key,
        value: defaultValue,
        lastUpdated: new Date()
      };

      await this.db.layout.add(defaultSetting);

      return defaultValue;
    }

    console.log(`Retrieved setting for ${key}:`, setting.value);
    return setting.value;
  }

  /**
   * Updates a specific layout setting
   * @param key The setting key to update
   * @param value The new value for the setting
   */
  async updateLayoutSetting(key: LayoutSettingKey, value: any): Promise<void> {
    console.log(`Updating layout setting for key: ${key}`, value);

    // Create the setting object with the key
    const setting: LayoutSetting = {
      key,
      value,
      lastUpdated: new Date()
    };

    // Update or add the setting
    await this.db.layout.put(setting);
  }

  /**
   * Gets all layout settings
   * @returns An object with all layout settings
   */
  async getLayoutSettings(): Promise<Record<LayoutSettingKey, any>> {
    const settings: Partial<Record<LayoutSettingKey, any>> = {};

    for (const key of Object.values(LayoutSettingKey)) {
      settings[key] = await this.getLayoutSetting(key);
    }

    return settings as Record<LayoutSettingKey, any>;
  }

  /**
   * Updates multiple layout settings
   * @param settings Partial layout settings to update
   */
  async updateLayoutSettings(
    settings: Partial<Record<LayoutSettingKey, any>>
  ): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.updateLayoutSetting(key as LayoutSettingKey, value);
    }
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
        .map((model: any) => ({
          id: model.id,
          name: model.id.replace(/^gpt-/, "GPT ").replace(/-/g, " "),
          created: model.created
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
