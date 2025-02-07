import type { FileSystem } from "@piddie/shared-types";
import { SyncOperationError } from "@piddie/shared-types";
import { BrowserNativeFileSystem } from "./BrowserNativeFileSystem";
import { PollingSyncTarget } from "./PollingSyncTarget";

/**
 * Browser implementation of the SyncTarget interface using the Native File System API
 */
export class BrowserNativeSyncTarget extends PollingSyncTarget {
  override readonly type = "browser-native";

  protected validateFileSystem(fileSystem: FileSystem): void {
    if (!(fileSystem instanceof BrowserNativeFileSystem)) {
      throw new SyncOperationError(
        "Invalid file system type",
        "INITIALIZATION_FAILED"
      );
    }
  }
}
