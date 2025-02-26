import Dexie from "dexie";

/**
 * Interface for LLM provider configuration
 */
export interface LlmProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
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
 * Interface for panel width settings
 */
export interface PanelWidthSettings {
  fileExplorerWidth: number;
  chatPanelWidth: number;
  isFileExplorerCollapsed: boolean;
  isChatPanelCollapsed: boolean;
}

/**
 * Interface for application settings
 */
export interface AppSettings {
  id: string;
  llmConfig: LlmProviderConfig;
  panelWidths: PanelWidthSettings;
  lastUpdated: Date;
}

/**
 * Database schema for application settings
 */
export class SettingsDatabase extends Dexie {
  settings!: Dexie.Table<AppSettings, string>;

  constructor() {
    super("piddie-settings");

    this.version(1).stores({
      settings: "id, lastUpdated"
    });
  }
}

/**
 * Default settings ID
 */
export const DEFAULT_SETTINGS_ID = "app-settings";

/**
 * Default LLM configuration
 */
export const DEFAULT_LLM_CONFIG: LlmProviderConfig = {
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || "",
  baseUrl: import.meta.env.VITE_OPENAI_BASE_URL || "https://api.openai.com/v1",
  defaultModel: import.meta.env.VITE_OPENAI_MODEL || "gpt-3.5-turbo",
  availableModels: []
};

/**
 * Default panel width settings
 */
export const DEFAULT_PANEL_WIDTHS: PanelWidthSettings = {
  fileExplorerWidth: 250,
  chatPanelWidth: 300,
  isFileExplorerCollapsed: false,
  isChatPanelCollapsed: false
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
   * Gets the application settings
   * @returns The application settings
   */
  async getSettings(): Promise<AppSettings> {
    let settings = await this.db.settings.get(DEFAULT_SETTINGS_ID);

    if (!settings) {
      // Create default settings if they don't exist
      settings = {
        id: DEFAULT_SETTINGS_ID,
        llmConfig: DEFAULT_LLM_CONFIG,
        panelWidths: DEFAULT_PANEL_WIDTHS,
        lastUpdated: new Date()
      };

      await this.db.settings.add(settings);
    } else if (!settings.panelWidths) {
      // Add panel widths if they don't exist in existing settings
      settings.panelWidths = DEFAULT_PANEL_WIDTHS;
      await this.db.settings.update(DEFAULT_SETTINGS_ID, {
        panelWidths: DEFAULT_PANEL_WIDTHS
      });
    }

    return settings;
  }

  /**
   * Updates the LLM configuration
   * @param config The new LLM configuration
   */
  async updateLlmConfig(
    config: Partial<LlmProviderConfig>
  ): Promise<LlmProviderConfig> {
    const settings = await this.getSettings();

    // Update the configuration
    const updatedConfig = {
      ...settings.llmConfig,
      ...config
    };

    // Update the settings
    await this.db.settings.update(DEFAULT_SETTINGS_ID, {
      llmConfig: updatedConfig,
      lastUpdated: new Date()
    });

    return updatedConfig;
  }

  /**
   * Resets the LLM configuration to defaults
   */
  async resetLlmConfig(): Promise<LlmProviderConfig> {
    const settings = await this.getSettings();

    // Update the settings
    await this.db.settings.update(DEFAULT_SETTINGS_ID, {
      llmConfig: DEFAULT_LLM_CONFIG,
      lastUpdated: new Date()
    });

    return DEFAULT_LLM_CONFIG;
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

  /**
   * Updates the panel width settings
   * @param widths The new panel width settings
   */
  async updatePanelWidths(
    widths: Partial<PanelWidthSettings>
  ): Promise<PanelWidthSettings> {
    const settings = await this.getSettings();

    // Update the panel widths
    const updatedWidths = {
      ...settings.panelWidths,
      ...widths
    };

    // Update the settings
    await this.db.settings.update(DEFAULT_SETTINGS_ID, {
      panelWidths: updatedWidths,
      lastUpdated: new Date()
    });

    return updatedWidths;
  }
}

// Create a singleton instance of the settings manager
const settingsManager = new SettingsManager();
export default settingsManager;
