import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import VueDevTools from "vite-plugin-vue-devtools";
import { viteStaticCopy } from "vite-plugin-static-copy";
import type { PackageJson } from "type-fest";
import pkg from "./package.json" with { type: "json" };

const iconsPath = "node_modules/@shoelace-style/shoelace/dist/assets/icons";

// Get all @piddie workspace dependencies
const dependencies = (pkg as PackageJson).dependencies ?? {};
const workspaceDeps = Object.keys(dependencies).filter(
  (dep) => dep.startsWith("@piddie/") && dependencies[dep] === "workspace:*"
);

// Create aliases for workspace packages and their style imports
const workspaceAliases = workspaceDeps.flatMap((dep) => {
  const basePath = `../../packages/${dep.replace("@piddie/", "")}`;
  return [
    {
      find: new RegExp(`^${dep}$`),
      replacement: fileURLToPath(
        new URL(
          `${basePath}/dist/index${
            dep.replace("@piddie/", "").includes("-ui") ? ".es.js" : ".js"
          }`,
          import.meta.url
        )
      )
    },
    {
      find: new RegExp(`^${dep}/style$`),
      replacement: fileURLToPath(
        new URL(`${basePath}/dist/style.css`, import.meta.url)
      )
    }
  ];
});

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
    alias: [
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url))
      },
      {
        find: /\/assets\/icons\/(.+)/,
        replacement: `${iconsPath}/$1`
      },
      // Add workspace package aliases
      ...workspaceAliases
    ]
  },
  optimizeDeps: {
    exclude: workspaceDeps
  },
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin"
    }
  }
});
