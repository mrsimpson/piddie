import type { FileSystem } from "@piddie/shared-types";
import { SyncOperationError } from "@piddie/shared-types";
import { BrowserFileSystem } from "./BrowserFileSystem";
import { PollingSyncTarget } from "./PollingSyncTarget";

/**
 * Browser implementation of the SyncTarget interface
 */
export class BrowserSyncTarget extends PollingSyncTarget {
  override readonly type = "browser-fs";

  protected validateFileSystem(fileSystem: FileSystem): void {
    if (!(fileSystem instanceof BrowserFileSystem)) {
      throw new SyncOperationError(
        "Invalid file system type",
        "INITIALIZATION_FAILED"
      );
    }
  }
}
