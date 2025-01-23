import type { FileSystemManager } from "./file-system";
import type { SyncManager } from "./files-sync";

/**
 * Comprehensive file management service
 */
export interface FileManagementService {
  /**
   * File system management interface
   */
  fileSystem: FileSystemManager;

  /**
   * Synchronization management interface
   */
  syncManager: SyncManager;
}
