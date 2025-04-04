import CollapsiblePanel from "./components/CollapsiblePanel.vue";
import ThemeToggle from "./components/ThemeToggle.vue";
import EditableText from "./components/EditableText.vue";
import ConfirmationDialog from "./components/ConfirmationDialog.vue";
import ResizablePanel from "./components/ResizablePanel.vue";
import { useThemeStore } from "./stores";
import { handleUIError } from "./utils/error-handling";

// Export it from the package
export {
  CollapsiblePanel,
  ThemeToggle,
  EditableText,
  ConfirmationDialog,
  ResizablePanel,
  handleUIError,
  useThemeStore
};
