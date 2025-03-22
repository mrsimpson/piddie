import { ref, reactive, onMounted } from "vue";
import { defineStore } from "pinia";
import { settingsManager } from "@piddie/settings";
import { WorkbenchSettingKey } from "@piddie/settings";

export const useLayoutStore = defineStore("layout", () => {
  // Reactive layout settings object
  const layout = reactive({
    fileExplorerWidth: 250,
    chatPanelWidth: 300,
    isFileExplorerCollapsed: false,
    isChatPanelCollapsed: false
  });

  const isLoading = ref(true);
  const error = ref<Error | null>(null);

  // Load settings from database on store initialization
  onMounted(async () => {
    try {
      console.log("Layout store: Starting to load settings");
      isLoading.value = true;

      // Load each setting individually
      layout.fileExplorerWidth = (await settingsManager.getWorkbenchSetting(
        WorkbenchSettingKey.FILE_EXPLORER_WIDTH
      )) as number;
      layout.chatPanelWidth = (await settingsManager.getWorkbenchSetting(
        WorkbenchSettingKey.CHAT_PANEL_WIDTH
      )) as number;
      layout.isFileExplorerCollapsed =
        (await settingsManager.getWorkbenchSetting(
          WorkbenchSettingKey.IS_FILE_EXPLORER_COLLAPSED
        )) as boolean;
      layout.isChatPanelCollapsed = (await settingsManager.getWorkbenchSetting(
        WorkbenchSettingKey.IS_CHAT_PANEL_COLLAPSED
      )) as boolean;

      console.log("Layout store: Loaded settings", layout);
    } catch (err) {
      console.error("Layout store: Error loading layout settings:", err);
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      isLoading.value = false;
      console.log(
        "Layout store: Finished loading settings, isLoading:",
        isLoading.value
      );
    }
  });

  /**
   * Updates the layout settings
   * @param settings Partial layout settings to update
   */
  async function updateLayoutSettings(settings: Partial<typeof layout>) {
    try {
      console.group("Layout Store: Update Layout Settings");
      console.log("Incoming settings to update:", settings);
      console.log("Current layout state before update:", { ...layout });

      // Update each setting individually
      if (settings.fileExplorerWidth !== undefined) {
        await settingsManager.updateWorkbenchSetting(
          WorkbenchSettingKey.FILE_EXPLORER_WIDTH,
          settings.fileExplorerWidth
        );
        layout.fileExplorerWidth = settings.fileExplorerWidth;
      }

      if (settings.chatPanelWidth !== undefined) {
        await settingsManager.updateWorkbenchSetting(
          WorkbenchSettingKey.CHAT_PANEL_WIDTH,
          settings.chatPanelWidth
        );
        layout.chatPanelWidth = settings.chatPanelWidth;
      }

      if (settings.isFileExplorerCollapsed !== undefined) {
        await settingsManager.updateWorkbenchSetting(
          WorkbenchSettingKey.IS_FILE_EXPLORER_COLLAPSED,
          settings.isFileExplorerCollapsed
        );
        layout.isFileExplorerCollapsed = settings.isFileExplorerCollapsed;
      }

      if (settings.isChatPanelCollapsed !== undefined) {
        await settingsManager.updateWorkbenchSetting(
          WorkbenchSettingKey.IS_CHAT_PANEL_COLLAPSED,
          settings.isChatPanelCollapsed
        );
        layout.isChatPanelCollapsed = settings.isChatPanelCollapsed;
      }

      console.log("Layout after update:", { ...layout });
      console.groupEnd();

      return true;
    } catch (err) {
      console.error("Layout store: Error updating layout settings:", err);
      error.value = err instanceof Error ? err : new Error(String(err));
      return false;
    }
  }

  return {
    layout,
    isLoading,
    error,
    updateLayoutSettings
  };
});
