import FS from "@isomorphic-git/lightning-fs";
import { FsPromisesAdapter, MinimalFsPromises } from "./FsPromisesAdapter";
import type {
  MKDirOptions,
  WriteFileOptions
} from "@isomorphic-git/lightning-fs";

/**
 * Browser-compatible path utilities
 */
const browserPath = {
  normalize(path: string): string {
    // Remove leading and trailing slashes, collapse multiple slashes
    return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  },

  dirname(path: string): string {
    const normalized = browserPath.normalize(path);
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return '/';
    return normalized.slice(0, lastSlash) || '/';
  },

  basename(path: string): string {
    const normalized = browserPath.normalize(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  },

  join(...parts: string[]): string {
    return '/' + parts
      .map(part => browserPath.normalize(part))
      .filter(Boolean)
      .join('/');
  }
};

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
      readFile: (path: string) =>
        fs.promises.readFile(path, { encoding: "utf8" }) as Promise<string>,
      writeFile: (path: string, data: string) =>
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


  /**
   * Normalize a path according to the browser file system rules
   */
  protected override normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  }

  /**
   * Get the directory name from a path
   */
  protected override getDirname(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return '/';
    return normalized.slice(0, lastSlash) || '/';
  }

  /**
   * Get the base name from a path
   */
  protected override getBasename(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  }

  /**
   * Join path segments according to browser file system rules
   */
  protected override joinPaths(...paths: string[]): string {
    return '/' + paths
      .map(part => this.normalizePath(part))
      .filter(Boolean)
      .join('/');
  }
}
