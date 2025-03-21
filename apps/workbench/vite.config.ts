import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import VueDevTools from "vite-plugin-vue-devtools";
import { viteStaticCopy } from "vite-plugin-static-copy";

const iconsPath = "node_modules/@shoelace-style/shoelace/dist/assets/icons";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Tell Vue to ignore all components that start with 'sl-'
          isCustomElement: (tag) => tag.startsWith("sl-")
        }
      }
    }),
    viteStaticCopy({
      targets: [
        {
          src: iconsPath,
          dest: "assets"
        }
      ]
    }),
    VueDevTools()
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@piddie/project-management": fileURLToPath(
        new URL("../project-management/src/index.ts", import.meta.url)
      ),
      "@piddie/files-management": fileURLToPath(
        new URL("../files-management/src/index.ts", import.meta.url)
      ),
      "@piddie/shared-types": fileURLToPath(
        new URL("../shared-types/src/index.ts", import.meta.url)
      )
    }
  },
  optimizeDeps: {
    include: [
      "@piddie/project-management",
      "@piddie/files-management",
      "@piddie/shared-types"
    ]
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /packages/]
    }
  }
});
