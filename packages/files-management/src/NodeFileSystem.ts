import type {
  FileSystem,
  FileSystemState,
  FileSystemStateType,
} from "@piddie/shared-types";
import { promises as fs } from "fs";
import { FsPromisesAdapter, MinimalFsPromises } from "./FsPromisesAdapter";

/**
 * Node.js implementation of the FileSystem interface using fs.promises
 */
export class NodeFileSystem extends FsPromisesAdapter implements FileSystem {
  protected override currentState: FileSystemStateType = "uninitialized";
  protected override lockState: FileSystemState["lockState"] = {
    isLocked: false
  };
  protected override pendingOperations = 0;
  declare protected lastOperation?: FileSystemState["lastOperation"];

  constructor(rootDir: string) {
    const fsWrapper: MinimalFsPromises = {
      mkdir: fs.mkdir,
      readdir: fs.readdir,
      stat: fs.stat,
      readFile: (path) => fs.readFile(path, "utf-8"),
      writeFile: (path, data) => fs.writeFile(path, data, "utf-8"),
      rm: fs.rm,
      unlink: fs.unlink,
      access: fs.access
    };

    super({ rootDir, fs: fsWrapper });
  }
}
