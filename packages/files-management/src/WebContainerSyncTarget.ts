import type { FileSystem } from "@piddie/shared-types";
import { SyncOperationError } from "@piddie/shared-types";
import { PollingSyncTarget } from "./PollingSyncTarget";
import { WebContainerFileSystem } from "./WebContainerFileSystem";

/**
 * Sync target implementation for WebContainer filesystem
 * Uses polling to detect changes since WebContainer doesn't provide native file watching
 */
export class WebContainerSyncTarget extends PollingSyncTarget {
  override readonly type = "webcontainer-fs";

  /**
   * Validates that the provided filesystem is a WebContainerFileSystem
   * @throws {SyncOperationError} if filesystem is not a WebContainerFileSystem
   */
  protected validateFileSystem(fileSystem: FileSystem): void {
    if (!(fileSystem instanceof WebContainerFileSystem)) {
      throw new SyncOperationError(
        "WebContainerSyncTarget requires WebContainerFileSystem",
        "INITIALIZATION_FAILED"
      );
    }
  }
}
