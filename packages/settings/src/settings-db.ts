import Dexie from "dexie";
import type { ProviderType } from "@piddie/shared-types";

/**
 * Interface for LLM provider configuration
 */
export interface LlmProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  selectedModel?: string;
  provider?: ProviderType;
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
  RUNTIME_PANEL_WIDTH = "runtimePanelWidth",
  IS_RUNTIME_PANEL_COLLAPSED = "isRuntimePanelCollapsed",
  SELECTED_PROVIDER = "selectedProvider",
  LLM_CONFIG = "llmConfig"
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
            value: "litellm",
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
  apiKey: import.meta.env.VITE_LITELLM_API_KEY ?? "",
  baseUrl: import.meta.env.VITE_LITELLM_BASE_URL ?? "http://localhost:4000/v1",
  defaultModel: import.meta.env.VITE_LITELLM_MODEL ?? "",
  selectedModel: import.meta.env.VITE_LITELLM_MODEL ?? "",
  provider: "litellm",
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
  [WorkbenchSettingKey.RUNTIME_PANEL_WIDTH]: 500,
  [WorkbenchSettingKey.IS_RUNTIME_PANEL_COLLAPSED]: false,
  [WorkbenchSettingKey.SELECTED_PROVIDER]: "litellm",
  [WorkbenchSettingKey.LLM_CONFIG]: DEFAULT_LLM_CONFIG
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
    try {
      const llmConfig = await this.getWorkbenchSetting(
        WorkbenchSettingKey.LLM_CONFIG
      );

      if (!llmConfig) {
        return DEFAULT_LLM_CONFIG;
      }

      // Ensure we have a valid configuration by merging with defaults
      return {
        ...DEFAULT_LLM_CONFIG,
        ...(llmConfig as LlmProviderConfig)
      };
    } catch (error) {
      console.error("Error getting LLM config:", error);
      return DEFAULT_LLM_CONFIG;
    }
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
   * Makes an object serializable for IndexedDB by removing non-serializable properties
   * @param obj The object to make serializable
   * @returns A serializable copy of the object
   */
  private makeSerializable<T>(obj: T): T {
    // Convert to JSON and back to remove non-serializable properties
    return JSON.parse(JSON.stringify(obj));
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
      value: this.makeSerializable(value),
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
  async getSelectedProvider(): Promise<ProviderType> {
    const config = await this.getLlmConfig();
    return config.provider || "litellm";
  }

  /**
   * Updates the selected provider in workbench settings
   * @param provider The provider to select
   */
  async updateSelectedProvider(provider: ProviderType): Promise<void> {
    await this.updateLlmConfig({ provider });
  }

  /**
   * Updates the LLM configuration
   * @param config The LLM configuration to update
   * @returns The updated LLM configuration
   */
  async updateLlmConfig(
    config: Partial<LlmProviderConfig>
  ): Promise<LlmProviderConfig> {
    const currentConfig = await this.getLlmConfig();

    // Create a serializable copy of the configuration
    const updatedLlmConfig = this.makeSerializable({
      ...currentConfig,
      ...config
    });

    await this.updateWorkbenchSetting(
      WorkbenchSettingKey.LLM_CONFIG,
      updatedLlmConfig
    );

    return updatedLlmConfig;
  }

  /**
   * Resets the LLM configuration to defaults
   */
  async resetLlmConfig(): Promise<LlmProviderConfig> {
    await this.db.llmConfig.clear();
    return this.updateLlmConfig(DEFAULT_LLM_CONFIG);
  }
}

// Create a singleton instance of the settings manager
export const settingsManager = new SettingsManager();
