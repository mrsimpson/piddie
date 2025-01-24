import { promises as fs } from "fs";
import { FsPromisesAdapter, MinimalFsPromises } from "./FsPromisesAdapter";

/**
 * Node.js implementation of the FileSystem interface using fs.promises
 */
export class NodeFileSystem extends FsPromisesAdapter {
  constructor(rootDir: string) {
    const fsWrapper: MinimalFsPromises = {
      mkdir: fs.mkdir,
      readdir: fs.readdir,
      stat: fs.stat,
      readFile: (path, _encoding) => fs.readFile(path, "utf-8"),
      writeFile: (path, data, _encoding) => fs.writeFile(path, data, "utf-8"),
      rm: fs.rm,
      unlink: fs.unlink,
      access: fs.access
    };

    super({ rootDir, fs: fsWrapper });
  }
}
