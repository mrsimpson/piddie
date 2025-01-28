// Import Shoelace theme and utilities
import '@shoelace-style/shoelace/dist/themes/light.css';
import { setBasePath } from '@shoelace-style/shoelace';

// Import components
import FileExplorer from './components/FileExplorer.vue';
import FileSystemView from './components/FileSystemView.vue';

// Set the base path to the local assets directory
setBasePath('/assets');

export { FileExplorer, FileSystemView };

// Export types
export type { FileViewModel, FileSystemPanelConfig } from './types/file-explorer'; 