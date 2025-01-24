import FS from "@isomorphic-git/lightning-fs";
import { FsPromisesAdapter, MinimalFsPromises } from "./FsPromisesAdapter";
import type {
  MKDirOptions,
  WriteFileOptions
} from "@isomorphic-git/lightning-fs";

/**
 * Browser implementation of the FileSystem interface using LightningFS.
 * This implementation uses LightningFS for browser-based file system operations.
 */
export class BrowserFileSystem extends FsPromisesAdapter {
  /**
   * Creates a new instance of BrowserFileSystem
   * @param options Configuration options for the file system
   */
  constructor(options: {
    /**
     * The name of the file system. This is used as a key for IndexedDB storage.
     */
    name: string;
    /**
     * The root directory for all operations
     */
    rootDir: string;
  }) {
    // Initialize LightningFS
    const fs = new FS(options.name);

    // Create a wrapper that adds missing methods
    const fsWrapper: MinimalFsPromises = {
      mkdir: (path: string, options?: { recursive?: boolean }) =>
        fs.promises.mkdir(path, { mode: 0o777, ...options } as MKDirOptions),
      stat: fs.promises.stat,
      readFile: (path: string, _encoding: "utf8") =>
        fs.promises.readFile(path, { encoding: "utf8" }) as Promise<string>,
      writeFile: (path: string, data: string, _encoding: "utf8") =>
        fs.promises.writeFile(path, data, {
          mode: 0o666,
          encoding: "utf8"
        } as WriteFileOptions),
      unlink: fs.promises.unlink,
      // Wrap readdir to return Dirent-like objects
      readdir: async (path: string) => {
        const entries = await fs.promises.readdir(path);
        const results = await Promise.all(
          entries.map(async (name) => {
            const stats = await fs.promises.stat(`${path}/${name}`);
            return {
              name,
              isDirectory: () => stats.isDirectory(),
              isFile: () => stats.isFile()
            };
          })
        );
        return results;
      },
      // Polyfill rm using unlink/rmdir
      rm: async (path: string, options?: { recursive?: boolean }) => {
        const stats = await fs.promises.stat(path);
        if (stats.isDirectory()) {
          if (options?.recursive) {
            const entries = await fs.promises.readdir(path);
            await Promise.all(
              entries.map((entry) => {
                const fullPath = `${path}/${entry}`;
                return stats.isDirectory()
                  ? fsWrapper.rm!(fullPath, options)
                  : fs.promises.unlink(fullPath);
              })
            );
          }
          await fs.promises.rmdir(path);
        } else {
          await fs.promises.unlink(path);
        }
      },
      // Polyfill access using stat
      access: async (path: string) => {
        await fs.promises.stat(path);
      }
    };

    super({
      rootDir: options.rootDir,
      fs: fsWrapper
    });
  }
}
