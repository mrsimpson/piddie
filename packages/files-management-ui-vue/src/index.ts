import FileExplorerPanel from "./components/FileExplorerPanel.vue";
import FileExplorerToolbar from "./components/FileExplorerToolbar.vue";
import FileSystem from "./components/FileSystem.vue";
import FileSystemExplorer from "./components/FileSystemExplorer.vue";
import SyncTargetSelector from "./components/SyncTargetSelector.vue";
import SyncTargetStatus from "./components/SyncTargetStatus.vue";
import { useFileSystemStore } from "./stores/file-system";

// Export the components and store
export {
  FileExplorerPanel,
  FileExplorerToolbar,
  FileSystem,
  FileSystemExplorer,
  SyncTargetSelector,
  SyncTargetStatus,
  useFileSystemStore
};
