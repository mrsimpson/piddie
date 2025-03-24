import { defineConfig, UserConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import type { PackageJson } from "type-fest";

interface LibraryOptions {
  entry: string;
  pkg: PackageJson;
}

export function createLibConfig(options: LibraryOptions): UserConfig {
  const name = options.pkg.name?.split("/").pop()?.replace(/-/g, "") ?? "lib";

  return defineConfig({
    plugins: [
      vue({
        template: {
          compilerOptions: {
            // Tell Vue to ignore all components that start with 'sl-'
            isCustomElement: (tag: string) => tag.startsWith("sl-")
          }
        }
      }),
      dts({
        rollupTypes: true,
        tsconfigPath: "./tsconfig.app.json",
        include: ["src/**/*.ts", "src/**/*.vue"]
      })
    ],
    build: {
      sourcemap: true,
      lib: {
        entry: options.entry,
        name,
        fileName: () => "index.es.js",
        formats: ["es"]
      },
      outDir: "dist",
      cssCodeSplit: false,
      emptyOutDir: true,
      rollupOptions: {
        external: [
          "vue",
          "pinia",
          "vue-router",
          "@shoelace-style/shoelace",
          /^@piddie\/.*/
        ],
        output: {
          assetFileNames: (assetInfo) => {
            if (
              (assetInfo.name && assetInfo.name.endsWith(".css")) ||
              (assetInfo.names &&
                assetInfo.names.some((name) => name.endsWith(".css")))
            ) {
              return "style.css";
            }
            return "assets/[name][extname]";
          }
        }
      }
    }
  });
}
